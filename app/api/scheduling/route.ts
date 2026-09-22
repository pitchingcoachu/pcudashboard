import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { resolveSchoolScopedOrganizationId } from '../../../lib/programming-scope';
import { createNotificationsForUsers } from '../../../lib/training-db';
import { sendPushNotificationToUsers } from '../../../lib/push-notifications';
import { bookRecurringWeekly, bookSessionSlot, cancelSessionBooking, createBookingSlots, deleteBookingDateOverride, editBookingSlotGroup, getMinBookingLeadHours,
  listBookingDateOverrides, listBookingPlayers, listBookingSlots, rescheduleSessionBooking, saveBookingDateOverride,
  setMinBookingLeadHours, updateBookingSlotStatus, type BookingOverrideScope, type SessionTypeValue } from '../../../lib/booking-db';

function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value);}
function validTime(value:string){return /^\d{2}:\d{2}$/.test(value);}
function cleanInt(value:unknown,min:number,max:number,fallback:number){const parsed=Number(value);return Number.isFinite(parsed)?Math.min(max,Math.max(min,Math.round(parsed))):fallback;}
function formatWhen(iso:string){return new Intl.DateTimeFormat('en-US',{timeZone:'America/Phoenix',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(iso));}
function sessionTypeLabel(type:SessionTypeValue){return type==='bullpen'?'Bullpen':'Regular Training';}
function slotStartsForDay(date:string,startTime:string,endTime:string,interval:number):Array<{startsAt:string;endsAt:string}>{
  const starts:Array<{startsAt:string;endsAt:string}>=[];
  const startMinutes=Number(startTime.slice(0,2))*60+Number(startTime.slice(3)),endMinutes=Number(endTime.slice(0,2))*60+Number(endTime.slice(3));
  for(let minute=startMinutes;minute<=endMinutes;minute+=interval){
    const hh=String(Math.floor(minute/60)).padStart(2,'0'),mm=String(minute%60).padStart(2,'0');
    const begins=new Date(`${date}T${hh}:${mm}:00-07:00`);
    if(begins.getTime()>Date.now())starts.push({startsAt:begins.toISOString(),endsAt:begins.toISOString()});
  }
  return starts;
}

async function access(request:Request){
  const session=getSessionFromRequest(request,await cookies());
  if(!session) return {error:NextResponse.json({error:'Unauthorized'},{status:401})};
  const schoolCode=resolveDashboardSchoolCode({
    userId:Number(session.userId??0),email:session.email,name:session.name,
    role:session.role==='player'?'player':session.role==='coach'?'coach':'admin',
    organizationId:Number(session.organizationId??0),playerId:Number(session.playerId??0)||null,
    dashboardSchoolCode:session.dashboardSchoolCode,appUrl:session.appUrl,apps:session.apps,
  }).toUpperCase();
  if(schoolCode!=='PCU') return {error:NextResponse.json({error:'Scheduling is not enabled for this school.'},{status:403})};
  const organizationId=resolveSchoolScopedOrganizationId(session);
  const userId=Number(session.userId??0);
  if(!organizationId||!userId) return {error:NextResponse.json({error:'Organization access required.'},{status:403})};
  return {session,organizationId,userId,schoolCode,staff:session.role==='admin'||session.role==='coach'};
}

export async function GET(request:Request){
  const auth=await access(request); if('error'in auth)return auth.error;
  const url=new URL(request.url); const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const startDate=validDate(url.searchParams.get('startDate')??'')?url.searchParams.get('startDate')!:today;
  const endDate=validDate(url.searchParams.get('endDate')??'')?url.searchParams.get('endDate')!:startDate;
  const includePlayers=url.searchParams.get('includePlayers')!=='0';
  const includeSettings=url.searchParams.get('includeSettings')!=='0';
  const includeOverrides=url.searchParams.get('includeOverrides')!=='0';
  try{
    const [slots,players,minBookingLeadHours,dateOverrides]=await Promise.all([
      listBookingSlots({organizationId:auth.organizationId,startDate,endDate,playerId:Number(auth.session.playerId??0)||null,staff:auth.staff}),
      auth.staff&&includePlayers?listBookingPlayers(auth.organizationId):Promise.resolve([]),
      includeSettings?getMinBookingLeadHours(auth.organizationId):Promise.resolve(0),
      includeOverrides?listBookingDateOverrides({organizationId:auth.organizationId,startDate:auth.staff?today:startDate,endDate:auth.staff?'9999-12-31':endDate}):Promise.resolve([]),
    ]);
    return NextResponse.json({role:auth.staff?'staff':'player',slots,players,timeZone:'America/Phoenix',minBookingLeadHours,dateOverrides});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to load scheduling data.'},{status:500});}
}

export async function POST(request:Request){
  const auth=await access(request); if('error'in auth)return auth.error;
  const body=await request.json().catch(()=>({})) as Record<string,unknown>; const action=String(body.action??'');
  try{
    if(action==='create_slots'){
      if(!auth.staff)return NextResponse.json({error:'Staff access required.'},{status:403});
      const sessionType=body.sessionType==='bullpen'?'bullpen':'regular';
      const capacity=cleanInt(body.capacity,1,100,sessionType==='bullpen'?2:4);
      const location=String(body.location??'');

      const startDate=String(body.startDate??''),endDate=String(body.endDate??''),startTime=String(body.startTime??''),endTime=String(body.endTime??'');
      const weekdays=Array.isArray(body.weekdays)?new Set(body.weekdays.map(Number)):new Set<number>();
      if(!validDate(startDate)||!validDate(endDate)||!validTime(startTime)||!validTime(endTime)||!weekdays.size)
        return NextResponse.json({error:'Complete the dates, days, and times.'},{status:400});
      const from=new Date(`${startDate}T12:00:00Z`),to=new Date(`${endDate}T12:00:00Z`);
      if(to<from||(to.getTime()-from.getTime())/86400000>93)return NextResponse.json({error:'Availability may cover up to 93 days.'},{status:400});
      const interval=cleanInt(body.intervalMinutes,10,480,sessionType==='bullpen'?20:30);
      if(sessionType==='regular'&&interval!==30)
        return NextResponse.json({error:'Regular Training availability must use a 30-minute interval.'},{status:400});
      const starts:Array<{startsAt:string;endsAt:string}>=[];
      for(let day=new Date(from);day<=to;day.setUTCDate(day.getUTCDate()+1)){
        if(!weekdays.has(day.getUTCDay()))continue; const date=day.toISOString().slice(0,10);
        const startMinutes=Number(startTime.slice(0,2))*60+Number(startTime.slice(3)),endMinutes=Number(endTime.slice(0,2))*60+Number(endTime.slice(3));
        for(let minute=startMinutes;minute<=endMinutes;minute+=interval){
          const hh=String(Math.floor(minute/60)).padStart(2,'0'),mm=String(minute%60).padStart(2,'0');
          const begins=new Date(`${date}T${hh}:${mm}:00-07:00`);
          if(begins.getTime()>Date.now())starts.push({startsAt:begins.toISOString(),endsAt:begins.toISOString()});
          if(starts.length>500)return NextResponse.json({error:'This creates more than 500 slots. Shorten the date range.'},{status:400});
        }
      }
      const created=await createBookingSlots({organizationId:auth.organizationId,userId:auth.userId,sessionType,starts,capacity,location});
      return NextResponse.json({ok:true,created});
    }
    if(action==='edit_slot_group'){
      if(!auth.staff)return NextResponse.json({error:'Staff access required.'},{status:403});
      const slotIds=Array.isArray(body.slotIds)?body.slotIds.map(Number).filter(id=>Number.isFinite(id)&&id>0):[];
      const capacity=cleanInt(body.capacity,1,100,4);
      const location=String(body.location??'');
      const date=String(body.date??''),startTime=String(body.startTime??''),endTime=String(body.endTime??'');
      const interval=cleanInt(body.intervalMinutes,10,480,30);
      if(!slotIds.length)return NextResponse.json({error:'Select a published time to edit.'},{status:400});
      if(!validDate(date)||!validTime(startTime)||!validTime(endTime))
        return NextResponse.json({error:'Complete the day and times.'},{status:400});
      const starts=slotStartsForDay(date,startTime,endTime,interval);
      if(!starts.length)return NextResponse.json({error:'That time range has already passed.'},{status:400});
      const created=await editBookingSlotGroup({organizationId:auth.organizationId,slotIds,starts,capacity,location});
      return NextResponse.json({ok:true,created});
    }
    if(action==='book'){
      const playerId=auth.staff?Number(body.playerId??0):Number(auth.session.playerId??0);
      if(!playerId)return NextResponse.json({error:'This account is not linked to a player profile.'},{status:400});
      const result=await bookSessionSlot({organizationId:auth.organizationId,slotId:Number(body.slotId??0),playerId,bookedByUserId:auth.userId,override:auth.staff});
      const recipients=Array.from(new Set([result.playerUserId].filter((id):id is number=>Boolean(id&&id!==auth.userId))));
      await createNotificationsForUsers({recipientUserIds:recipients,eventType:'session_booked',title:'Session booked',
        detail:`${result.playerName} booked ${sessionTypeLabel(result.sessionType)} for ${formatWhen(result.startsAt)}.`,path:'/portal/dashboard?suite=scheduling',actorUserId:auth.userId,actorName:auth.session.name,actorRole:auth.session.role,playerId,playerName:result.playerName}).catch(()=>{});
      void sendPushNotificationToUsers({userIds:recipients,title:'Session booked',body:`${sessionTypeLabel(result.sessionType)} · ${formatWhen(result.startsAt)}`,data:{type:'session_booked',bookingId:result.bookingId}});
      return NextResponse.json({ok:true,bookingId:result.bookingId});
    }
    if(action==='reschedule'){
      const result=await rescheduleSessionBooking({organizationId:auth.organizationId,bookingId:Number(body.bookingId??0),newSlotId:Number(body.newSlotId??0),userId:auth.userId,playerId:Number(auth.session.playerId??0)||null,staff:auth.staff,override:auth.staff});
      const recipients=Array.from(new Set([result.playerUserId].filter((id):id is number=>Boolean(id&&id!==auth.userId))));
      await createNotificationsForUsers({recipientUserIds:recipients,eventType:'session_rescheduled',title:'Session rescheduled',
        detail:`${result.playerName} moved ${sessionTypeLabel(result.oldSessionType)} from ${formatWhen(result.oldStartsAt)} to ${sessionTypeLabel(result.sessionType)} at ${formatWhen(result.startsAt)}.`,path:'/portal/dashboard?suite=scheduling',actorUserId:auth.userId,actorName:auth.session.name,actorRole:auth.session.role,playerId:Number(auth.session.playerId??0)||null,playerName:result.playerName}).catch(()=>{});
      void sendPushNotificationToUsers({userIds:recipients,title:'Session rescheduled',body:`Now ${sessionTypeLabel(result.sessionType)} · ${formatWhen(result.startsAt)}`,data:{type:'session_rescheduled',bookingId:result.bookingId}});
      return NextResponse.json({ok:true,bookingId:result.bookingId});
    }
    if(action==='book_recurring'){
      const playerId=auth.staff?Number(body.playerId??0):Number(auth.session.playerId??0);
      if(!playerId)return NextResponse.json({error:'This account is not linked to a player profile.'},{status:400});
      const weeks=cleanInt(body.weeks,2,12,4);
      const results=await bookRecurringWeekly({organizationId:auth.organizationId,playerId,bookedByUserId:auth.userId,firstSlotId:Number(body.slotId??0),weeks,override:auth.staff});
      const bookedCount=results.filter(item=>item.status==='booked').length;
      if(bookedCount>0){
        const player=(await listBookingPlayers(auth.organizationId)).find(person=>person.id===playerId);
        const recipients=Array.from(new Set([player?.userId??null].filter((id):id is number=>Boolean(id&&id!==auth.userId))));
        await createNotificationsForUsers({recipientUserIds:recipients,eventType:'session_booked',title:'Recurring sessions booked',
          detail:`${player?.name??'Player'} booked Regular Training for ${bookedCount} of ${weeks} week${weeks===1?'':'s'}.`,path:'/portal/dashboard?suite=scheduling',actorUserId:auth.userId,actorName:auth.session.name,actorRole:auth.session.role,playerId,playerName:player?.name??'Player'}).catch(()=>{});
        void sendPushNotificationToUsers({userIds:recipients,title:'Recurring sessions booked',body:`Booked ${bookedCount} of ${weeks} week${weeks===1?'':'s'}.`,data:{type:'session_booked'}});
      }
      return NextResponse.json({ok:true,results,bookedCount,weeks});
    }
    if(action==='cancel_booking'){
      const result=await cancelSessionBooking({organizationId:auth.organizationId,bookingId:Number(body.bookingId??0),userId:auth.userId,playerId:Number(auth.session.playerId??0)||null,staff:auth.staff});
      const recipients=Array.from(new Set([result.playerUserId].filter((id):id is number=>Boolean(id&&id!==auth.userId))));
      await createNotificationsForUsers({recipientUserIds:recipients,eventType:'session_cancelled',title:'Session cancelled',detail:`${result.playerName} cancelled ${sessionTypeLabel(result.sessionType)} for ${formatWhen(result.startsAt)}.`,path:'/portal/dashboard?suite=scheduling',actorUserId:auth.userId,actorName:auth.session.name,actorRole:auth.session.role,playerId:result.playerId,playerName:result.playerName}).catch(()=>{});
      void sendPushNotificationToUsers({userIds:recipients,title:'Session cancelled',body:`${sessionTypeLabel(result.sessionType)} · ${formatWhen(result.startsAt)}`,data:{type:'session_cancelled',bookingId:result.bookingId}});
      return NextResponse.json({ok:true});
    }
    if(action==='slot_status'){
      if(!auth.staff)return NextResponse.json({error:'Staff access required.'},{status:403});
      const status=['open','closed','cancelled'].includes(String(body.status))?String(body.status) as 'open'|'closed'|'cancelled':'closed';
      await updateBookingSlotStatus({organizationId:auth.organizationId,slotId:Number(body.slotId??0),status}); return NextResponse.json({ok:true});
    }
    if(action==='update_lead_hours'){
      if(!auth.staff)return NextResponse.json({error:'Staff access required.'},{status:403});
      const minBookingLeadHours=await setMinBookingLeadHours(auth.organizationId,Number(body.hours??0));
      return NextResponse.json({ok:true,minBookingLeadHours});
    }
    if(action==='save_date_override'){
      if(!auth.staff)return NextResponse.json({error:'Staff access required.'},{status:403});
      const date=String(body.date??'');
      if(!validDate(date))return NextResponse.json({error:'Choose a valid date.'},{status:400});
      const sessionType=(['all','regular','bullpen'].includes(String(body.sessionType))?String(body.sessionType):'all') as BookingOverrideScope;
      const overrideId=await saveBookingDateOverride({organizationId:auth.organizationId,userId:auth.userId,date,sessionType,reason:String(body.reason??'').slice(0,160)});
      return NextResponse.json({ok:true,overrideId});
    }
    if(action==='delete_date_override'){
      if(!auth.staff)return NextResponse.json({error:'Staff access required.'},{status:403});
      await deleteBookingDateOverride({organizationId:auth.organizationId,overrideId:Number(body.overrideId??0)});
      return NextResponse.json({ok:true});
    }
    return NextResponse.json({error:'Unknown scheduling action.'},{status:400});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Scheduling request failed.'},{status:400});}
}
