import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/auth';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { resolveSchoolScopedOrganizationId } from '../../../lib/programming-scope';
import { createNotificationsForUsers } from '../../../lib/training-db';
import { sendPushNotificationToUsers } from '../../../lib/push-notifications';
import { bookSessionSlot, cancelSessionBooking, createBookingSlots, ensureDefaultSessionTypes, listBookingPlayers,
  listBookingSessionTypes, listBookingSlots, listBookingStaff, saveBookingSessionType, updateBookingSlotStatus } from '../../../lib/booking-db';

function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value);}
function cleanInt(value:unknown,min:number,max:number,fallback:number){const parsed=Number(value);return Number.isFinite(parsed)?Math.min(max,Math.max(min,Math.round(parsed))):fallback;}
function formatWhen(iso:string){return new Intl.DateTimeFormat('en-US',{timeZone:'America/Phoenix',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(iso));}

async function access(request:Request){
  const session=getSessionFromRequest(request,await cookies());
  if(!session) return {error:NextResponse.json({error:'Unauthorized'},{status:401})};
  const schoolCode=resolveDashboardSchoolCode({
    userId:Number(session.userId??0),email:session.email,name:session.name,
    role:session.role==='player'?'player':session.role==='coach'?'coach':'admin',
    organizationId:Number(session.organizationId??0),playerId:Number(session.playerId??0)||null,
    dashboardSchoolCode:session.dashboardSchoolCode,appUrl:session.appUrl,apps:session.apps,
  }).toUpperCase();
  if(schoolCode!=='PCU'&&schoolCode!=='GUND') return {error:NextResponse.json({error:'Scheduling is not enabled for this school.'},{status:403})};
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
  await ensureDefaultSessionTypes(auth.organizationId,auth.userId,auth.schoolCode==='GUND'?'Gunderson Baseball':'PCU Facility');
  const [sessionTypes,slots,staff,players]=await Promise.all([
    listBookingSessionTypes(auth.organizationId,auth.staff),
    listBookingSlots({organizationId:auth.organizationId,startDate,endDate,userId:auth.userId,playerId:Number(auth.session.playerId??0)||null,staff:auth.staff}),
    auth.staff?listBookingStaff(auth.organizationId):Promise.resolve([]),
    auth.staff?listBookingPlayers(auth.organizationId):Promise.resolve([]),
  ]);
  return NextResponse.json({role:auth.staff?'staff':'player',sessionTypes,slots,staff,players,timeZone:'America/Phoenix'});
}

export async function POST(request:Request){
  const auth=await access(request); if('error'in auth)return auth.error;
  const body=await request.json().catch(()=>({})) as Record<string,unknown>; const action=String(body.action??'');
  try{
    if(action==='save_type'){
      if(!auth.staff)return NextResponse.json({error:'Staff access required.'},{status:403});
      const name=String(body.name??'').trim(); if(!name)return NextResponse.json({error:'Session name is required.'},{status:400});
      const id=await saveBookingSessionType({organizationId:auth.organizationId,userId:auth.userId,id:Number(body.id??0)||undefined,name,
        description:String(body.description??''),durationMinutes:cleanInt(body.durationMinutes,10,480,60),defaultCapacity:cleanInt(body.defaultCapacity,1,100,1),
        location:String(body.location??''),active:body.active!==false});
      return NextResponse.json({ok:true,id});
    }
    if(action==='create_slots'){
      if(!auth.staff)return NextResponse.json({error:'Staff access required.'},{status:403});
      const sessionTypeId=Number(body.sessionTypeId??0),coachUserId=Number(body.coachUserId??0);
      const startDate=String(body.startDate??''),endDate=String(body.endDate??''),startTime=String(body.startTime??''),endTime=String(body.endTime??'');
      const weekdays=Array.isArray(body.weekdays)?new Set(body.weekdays.map(Number)):new Set<number>();
      if(!sessionTypeId||!coachUserId||!validDate(startDate)||!validDate(endDate)||!/^\d{2}:\d{2}$/.test(startTime)||!/^\d{2}:\d{2}$/.test(endTime)||!weekdays.size)
        return NextResponse.json({error:'Complete the session, coach, dates, days, and times.'},{status:400});
      const from=new Date(`${startDate}T12:00:00Z`),to=new Date(`${endDate}T12:00:00Z`);
      if(to<from||(to.getTime()-from.getTime())/86400000>93)return NextResponse.json({error:'Availability may cover up to 93 days.'},{status:400});
      const duration=cleanInt(body.durationMinutes,10,480,60),interval=cleanInt(body.intervalMinutes,10,480,duration);
      const starts:Array<{startsAt:string;endsAt:string}>=[];
      for(let day=new Date(from);day<=to;day.setUTCDate(day.getUTCDate()+1)){
        if(!weekdays.has(day.getUTCDay()))continue; const date=day.toISOString().slice(0,10);
        const startMinutes=Number(startTime.slice(0,2))*60+Number(startTime.slice(3)),endMinutes=Number(endTime.slice(0,2))*60+Number(endTime.slice(3));
        for(let minute=startMinutes;minute+duration<=endMinutes;minute+=interval){
          const hh=String(Math.floor(minute/60)).padStart(2,'0'),mm=String(minute%60).padStart(2,'0');
          const begins=new Date(`${date}T${hh}:${mm}:00-07:00`),ends=new Date(begins.getTime()+duration*60000);
          if(begins.getTime()>Date.now())starts.push({startsAt:begins.toISOString(),endsAt:ends.toISOString()});
          if(starts.length>500)return NextResponse.json({error:'This creates more than 500 slots. Shorten the date range.'},{status:400});
        }
      }
      const created=await createBookingSlots({organizationId:auth.organizationId,userId:auth.userId,sessionTypeId,coachUserId,starts,
        capacity:cleanInt(body.capacity,1,100,1),location:String(body.location??'')});
      return NextResponse.json({ok:true,created});
    }
    if(action==='book'){
      const playerId=auth.staff?Number(body.playerId??0):Number(auth.session.playerId??0);
      if(!playerId)return NextResponse.json({error:'This account is not linked to a player profile.'},{status:400});
      const result=await bookSessionSlot({organizationId:auth.organizationId,slotId:Number(body.slotId??0),playerId,bookedByUserId:auth.userId});
      const recipients=Array.from(new Set([result.playerUserId,result.coachUserId].filter((id):id is number=>Boolean(id&&id!==auth.userId))));
      await createNotificationsForUsers({recipientUserIds:recipients,eventType:'session_booked',title:'Session booked',
        detail:`${result.playerName} booked ${result.sessionName} for ${formatWhen(result.startsAt)}.`,path:'/portal/dashboard?suite=scheduling',actorUserId:auth.userId,actorName:auth.session.name,actorRole:auth.session.role,playerId,playerName:result.playerName}).catch(()=>{});
      void sendPushNotificationToUsers({userIds:recipients,title:'Session booked',body:`${result.sessionName} · ${formatWhen(result.startsAt)}`,data:{type:'session_booked',bookingId:result.bookingId}});
      return NextResponse.json({ok:true,bookingId:result.bookingId});
    }
    if(action==='cancel_booking'){
      const result=await cancelSessionBooking({organizationId:auth.organizationId,bookingId:Number(body.bookingId??0),userId:auth.userId,playerId:Number(auth.session.playerId??0)||null,staff:auth.staff});
      const recipients=Array.from(new Set([result.playerUserId,result.coachUserId].filter((id):id is number=>Boolean(id&&id!==auth.userId))));
      await createNotificationsForUsers({recipientUserIds:recipients,eventType:'session_cancelled',title:'Session cancelled',detail:`${result.playerName} cancelled ${result.sessionName} for ${formatWhen(result.startsAt)}.`,path:'/portal/dashboard?suite=scheduling',actorUserId:auth.userId,actorName:auth.session.name,actorRole:auth.session.role,playerId:result.playerId,playerName:result.playerName}).catch(()=>{});
      void sendPushNotificationToUsers({userIds:recipients,title:'Session cancelled',body:`${result.sessionName} · ${formatWhen(result.startsAt)}`,data:{type:'session_cancelled',bookingId:result.bookingId}});
      return NextResponse.json({ok:true});
    }
    if(action==='slot_status'){
      if(!auth.staff)return NextResponse.json({error:'Staff access required.'},{status:403});
      const status=['open','closed','cancelled'].includes(String(body.status))?String(body.status) as 'open'|'closed'|'cancelled':'closed';
      await updateBookingSlotStatus({organizationId:auth.organizationId,slotId:Number(body.slotId??0),status}); return NextResponse.json({ok:true});
    }
    return NextResponse.json({error:'Unknown scheduling action.'},{status:400});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Scheduling request failed.'},{status:400});}
}
