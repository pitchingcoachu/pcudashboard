'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type SessionTypeValue='bullpen'|'regular';
type OverrideScope='all'|SessionTypeValue;
type Person={id:number;name:string};
type Slot={id:number;sessionType:SessionTypeValue;startsAt:string;capacity:number;location:string;status:'open'|'closed'|'cancelled';closedByOverride:boolean;bookedCount:number;myBookingId:number|null;attendees:Array<{bookingId:number;playerId:number;playerName:string}>};
type DateOverride={id:number;date:string;sessionType:OverrideScope;reason:string};
type Payload={role:'staff'|'player';slots:Slot[];players:Person[];minBookingLeadHours:number;dateOverrides:DateOverride[];error?:string};
type RecurringResult={startsAt:string;status:'booked'|'unavailable';reason?:string};

const PHOENIX='America/Phoenix';
const MAX_ADVANCE_DAYS=60;
const dateKey=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:PHOENIX,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const addDays=(ymd:string,amount:number)=>{const date=new Date(`${ymd}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10);};
const today=()=>dateKey(new Date());
const dayLabel=(ymd:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(new Date(`${ymd}T12:00:00Z`));
const timeLabel=(iso:string)=>new Intl.DateTimeFormat('en-US',{timeZone:PHOENIX,hour:'numeric',minute:'2-digit'}).format(new Date(iso));
const timeLabel24=(iso:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:PHOENIX,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
const fullDate=(ymd:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric'}).format(new Date(`${ymd}T12:00:00Z`));
const shortDate=(iso:string)=>new Intl.DateTimeFormat('en-US',{timeZone:PHOENIX,month:'short',day:'numeric'}).format(new Date(iso));
const WEEKDAYS=[{id:0,label:'Sun'},{id:1,label:'Mon'},{id:2,label:'Tue'},{id:3,label:'Wed'},{id:4,label:'Thu'},{id:5,label:'Fri'},{id:6,label:'Sat'}];
const sessionTypeLabel=(type:SessionTypeValue)=>type==='bullpen'?'Bullpen':'Regular Training';
const overrideScopeLabel=(scope:OverrideScope)=>scope==='all'?'All session types':sessionTypeLabel(scope);

async function request(body:Record<string,unknown>){
  const response=await fetch('/api/scheduling',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const payload=await response.json().catch(()=>({})) as {error?:string;created?:number;results?:RecurringResult[];bookedCount?:number;weeks?:number;minBookingLeadHours?:number};
  if(!response.ok)throw new Error(payload.error||'Scheduling request failed.'); return payload;
}

export default function SchedulingSuite({role,logoSrc,logoAlt,schoolName}:{role:'admin'|'coach'|'player';logoSrc:string;logoAlt:string;schoolName:string}){
  const [mode,setMode]=useState<'book'|'manage'|'calendar'>('book');
  const [selectedDate,setSelectedDate]=useState(today);
  const [rangeStart,setRangeStart]=useState(today);
  const [payload,setPayload]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true); const [working,setWorking]=useState(false);
  const [message,setMessage]=useState(''); const [typeFilter,setTypeFilter]=useState<'all'|SessionTypeValue>('all');
  const [playerChoice,setPlayerChoice]=useState(0);
  const [buildMode,setBuildMode]=useState<SessionTypeValue>('regular');
  const [regularDraft,setRegularDraft]=useState({startDate:today(),endDate:addDays(today(),28),weekdays:[1,2,3,4,5] as number[],startTime:'15:00',endTime:'19:00',intervalMinutes:30,capacity:4,location:''});
  const [bullpenDraft,setBullpenDraft]=useState({startDate:today(),endDate:addDays(today(),28),weekdays:[1,2,3,4,5] as number[],startTime:'15:00',endTime:'19:00',intervalMinutes:20,capacity:2,location:''});
  const draft=buildMode==='regular'?regularDraft:bullpenDraft;
  const setDraft=buildMode==='regular'?setRegularDraft:setBullpenDraft;
  const [rescheduling,setRescheduling]=useState<{bookingId:number;sessionType:SessionTypeValue}|null>(null);
  const [recurringWeeks,setRecurringWeeks]=useState<Record<number,number>>({});
  const [calendarView,setCalendarView]=useState<'day'|'week'|'month'>('week');
  const [calendarAnchor,setCalendarAnchor]=useState(today);
  const [leadHoursDraft,setLeadHoursDraft]=useState<number|null>(null);
  const [overrideDraft,setOverrideDraft]=useState<{date:string;sessionType:OverrideScope;reason:string}>({date:today(),sessionType:'all',reason:''});
  const [manageOverrides,setManageOverrides]=useState<DateOverride[]>([]);
  const isStaff=role!=='player';
  const maxDate=addDays(today(),MAX_ADVANCE_DAYS);
  const rangeEnd=isStaff?addDays(rangeStart,41):(addDays(rangeStart,13)>maxDate?maxDate:addDays(rangeStart,13));
  const load=useCallback(async()=>{
    setLoading(true);setMessage('');
    try{const response=await fetch(`/api/scheduling?startDate=${rangeStart}&endDate=${rangeEnd}`,{cache:'no-store'});const next=await response.json().catch(()=>({}))as Payload;
      if(!response.ok)throw new Error(next.error||'Unable to load scheduling.');setPayload(next);
      setPlayerChoice(current=>current||next.players[0]?.id||0);
      setLeadHoursDraft(current=>current??next.minBookingLeadHours);
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to load scheduling.');}finally{setLoading(false);}
  },[rangeEnd,rangeStart]);
  useEffect(()=>{void load();},[load]);

  const monthAnchorStart=`${calendarAnchor.slice(0,7)}-01`;
  const monthDayCount=new Date(Number(calendarAnchor.slice(0,4)),Number(calendarAnchor.slice(5,7)),0).getDate();
  const calendarRangeStart=calendarView==='month'?monthAnchorStart:calendarAnchor;
  const calendarRangeEnd=calendarView==='month'?addDays(monthAnchorStart,monthDayCount-1):calendarView==='week'?addDays(calendarAnchor,6):calendarAnchor;
  const [calendarPayload,setCalendarPayload]=useState<Payload|null>(null);
  const [calendarLoading,setCalendarLoading]=useState(false);
  const loadCalendar=useCallback(async()=>{
    if(!isStaff||mode!=='calendar')return;
    setCalendarLoading(true);
    try{const response=await fetch(`/api/scheduling?startDate=${calendarRangeStart}&endDate=${calendarRangeEnd}`,{cache:'no-store'});const next=await response.json().catch(()=>({}))as Payload;
      if(response.ok)setCalendarPayload(next);
    }catch{ /* ignore -- keep prior calendar data on transient failure */ }finally{setCalendarLoading(false);}
  },[isStaff,mode,calendarRangeStart,calendarRangeEnd]);
  useEffect(()=>{void loadCalendar();},[loadCalendar]);

  const [existingSlots,setExistingSlots]=useState<Slot[]>([]);
  const [existingLoading,setExistingLoading]=useState(false);
  const loadExisting=useCallback(async()=>{
    if(!isStaff||mode!=='manage'||!draft.startDate||!draft.endDate)return;
    setExistingLoading(true);
    try{const response=await fetch(`/api/scheduling?startDate=${draft.startDate}&endDate=${draft.endDate}`,{cache:'no-store'});const next=await response.json().catch(()=>({}))as Payload;
      if(response.ok){setExistingSlots(next.slots??[]);setManageOverrides(next.dateOverrides??[]);}
    }catch{ /* ignore -- keep prior summary on transient failure */ }finally{setExistingLoading(false);}
  },[isStaff,mode,draft.startDate,draft.endDate]);
  useEffect(()=>{void loadExisting();},[loadExisting]);
  const existingByDay=useMemo(()=>{
    const groups=new Map<string,Map<SessionTypeValue,{first:string;last:string;count:number;slotIds:number[];hasBookings:boolean;capacity:number;location:string}>>();
    for(const slot of existingSlots){
      if(slot.status==='cancelled')continue;
      const day=dateKey(new Date(slot.startsAt));
      const byType=groups.get(day)??new Map<SessionTypeValue,{first:string;last:string;count:number;slotIds:number[];hasBookings:boolean;capacity:number;location:string}>();
      const entry=byType.get(slot.sessionType);
      if(!entry)byType.set(slot.sessionType,{first:slot.startsAt,last:slot.startsAt,count:1,slotIds:[slot.id],hasBookings:slot.bookedCount>0,capacity:slot.capacity,location:slot.location});
      else{entry.count+=1;entry.slotIds.push(slot.id);if(slot.bookedCount>0)entry.hasBookings=true;if(slot.startsAt<entry.first)entry.first=slot.startsAt;if(slot.startsAt>entry.last)entry.last=slot.startsAt;}
      groups.set(day,byType);
    }
    return Array.from(groups.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([day,byType])=>({
      day,
      types:Array.from(byType.entries()).map(([sessionType,range])=>({sessionType,...range})),
    }));
  },[existingSlots]);
  const [editingGroup,setEditingGroup]=useState<{day:string;sessionType:SessionTypeValue;slotIds:number[]}|null>(null);
  const [editDraft,setEditDraft]=useState({startTime:'',endTime:'',intervalMinutes:30,capacity:4,location:''});
  const startEditGroup=(day:string,group:{sessionType:SessionTypeValue;first:string;last:string;slotIds:number[];capacity:number;location:string})=>{
    setEditingGroup({day,sessionType:group.sessionType,slotIds:group.slotIds});
    setEditDraft({startTime:timeLabel24(group.first),endTime:timeLabel24(group.last),intervalMinutes:group.sessionType==='regular'?30:20,capacity:group.capacity,location:group.location});
    setMessage('');
  };
  const cancelEditGroup=()=>setEditingGroup(null);
  const saveEditGroup=async()=>{
    if(!editingGroup)return;
    setWorking(true);setMessage('');
    try{
      const result=await request({action:'edit_slot_group',slotIds:editingGroup.slotIds,date:editingGroup.day,startTime:editDraft.startTime,endTime:editDraft.endTime,intervalMinutes:editDraft.intervalMinutes,capacity:editDraft.capacity,location:editDraft.location});
      setMessage(typeof result.created==='number'?`Availability updated. ${result.created} time${result.created===1?'':'s'} published.`:'Availability updated.');
      setEditingGroup(null);
      await Promise.all([load(),loadExisting(),loadCalendar()]);
    }catch(error){setMessage(error instanceof Error?error.message:'Request failed.');}
    finally{setWorking(false);}
  };

  const days=useMemo(()=>Array.from({length:14},(_,index)=>addDays(rangeStart,index)).filter(day=>isStaff||day<=maxDate),[rangeStart,isStaff,maxDate]);
  const slots=useMemo(()=>(payload?.slots??[]).filter(slot=>dateKey(new Date(slot.startsAt))===selectedDate&&(typeFilter==='all'||slot.sessionType===typeFilter)),[payload?.slots,selectedDate,typeFilter]);
  const run=async(body:Record<string,unknown>,success:string)=>{setWorking(true);setMessage('');try{const result=await request(body);setMessage(typeof result.created==='number'?`${success} ${result.created} new time${result.created===1?'':'s'} added.`:success);await Promise.all([load(),loadExisting(),loadCalendar()]);}catch(error){setMessage(error instanceof Error?error.message:'Request failed.');}finally{setWorking(false);}};
  const toggleWeekday=(id:number)=>setDraft(current=>({...current,weekdays:current.weekdays.includes(id)?current.weekdays.filter(value=>value!==id):[...current.weekdays,id]}));

  const startReschedule=(bookingId:number,sessionType:SessionTypeValue)=>{setRescheduling({bookingId,sessionType});setMessage(`Pick a new ${sessionTypeLabel(sessionType)} time below — tap "Move here" on any open slot.`);};
  const cancelReschedule=()=>{setRescheduling(null);setMessage('');};
  const runReschedule=async(newSlotId:number)=>{
    if(!rescheduling)return;
    setWorking(true);setMessage('');
    try{await request({action:'reschedule',bookingId:rescheduling.bookingId,newSlotId});setMessage('Session rescheduled.');setRescheduling(null);await load();}
    catch(error){setMessage(error instanceof Error?error.message:'Unable to reschedule.');}
    finally{setWorking(false);}
  };
  const runRecurring=async(slotId:number)=>{
    const weeks=recurringWeeks[slotId]||4;
    const playerId=isStaff?playerChoice:undefined;
    setWorking(true);setMessage('');
    try{
      const result=await request({action:'book_recurring',slotId,weeks,...(playerId?{playerId}:{})});
      const results=result.results??[];
      const unavailable=results.filter(item=>item.status==='unavailable');
      const summary=`Booked ${result.bookedCount??0} of ${result.weeks??weeks} week${(result.weeks??weeks)===1?'':'s'}.`;
      setMessage(unavailable.length?`${summary} ${unavailable.map(item=>`${shortDate(item.startsAt)} — ${item.reason??'unavailable'}`).join(' ')}`:summary);
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to book recurring sessions.');}
    finally{setWorking(false);}
  };
  const saveLeadHours=async()=>{
    if(leadHoursDraft===null)return;
    setWorking(true);setMessage('');
    try{const result=await request({action:'update_lead_hours',hours:leadHoursDraft});setLeadHoursDraft(Number(result.minBookingLeadHours??leadHoursDraft));setMessage('Booking lead time updated.');await load();}
    catch(error){setMessage(error instanceof Error?error.message:'Unable to update booking lead time.');}
    finally{setWorking(false);}
  };

  return <section className="booking-shell">
    <header className="booking-hero">
      <img className="booking-hero-logo" src={logoSrc} alt={logoAlt} />
      <div><p className="booking-kicker">{schoolName.toUpperCase()} SESSION BOOKING</p><h1>Book Your Next Session</h1><p>Reserve a time and keep the week moving.</p></div>
    </header>
    {isStaff?<nav className="booking-tabs" aria-label="Scheduling views"><button className={mode==='book'?'is-active':''} onClick={()=>setMode('book')}>Calendar & bookings</button><button className={mode==='manage'?'is-active':''} onClick={()=>setMode('manage')}>Availability setup</button><button className={mode==='calendar'?'is-active':''} onClick={()=>setMode('calendar')}>Calendar</button></nav>:null}
    {message?<div className="booking-message" role="status">{message}{rescheduling?<button type="button" className="booking-link" onClick={cancelReschedule}>Cancel reschedule</button>:null}</div>:null}
    {mode==='manage'&&isStaff?<div className="booking-manage-grid">
      <article className="booking-panel"><div className="booking-panel-heading"><span>00</span><div><h2>Booking window</h2><p>How close to a time someone can book it. Staff can always add a player to any open time, regardless of this setting.</p></div></div>
        <div className="booking-form-stack">
          <div className="booking-form-row"><label>Minimum lead time (hours)<input type="number" min="0" max="336" value={leadHoursDraft??0} onChange={event=>setLeadHoursDraft(Number(event.target.value))}/></label></div>
          <button className="booking-secondary" disabled={working||leadHoursDraft===null||leadHoursDraft===payload?.minBookingLeadHours} onClick={()=>void saveLeadHours()}>Save booking window</button>
        </div>
      </article>
      <article className="booking-panel"><div className="booking-panel-heading"><span>01</span><div><h2>Session type</h2><p>Choose which kind of time you are publishing.</p></div></div>
        <nav className="booking-tabs" aria-label="Availability type"><button className={buildMode==='regular'?'is-active':''} onClick={()=>setBuildMode('regular')}>Regular Training</button><button className={buildMode==='bullpen'?'is-active':''} onClick={()=>setBuildMode('bullpen')}>Bullpen</button></nav>
      </article>
      <article className="booking-panel booking-panel--accent"><div className="booking-panel-heading"><span>02</span><div><h2>Build availability</h2><p>Turn a weekly window into individual bookable times.</p></div></div>
        <div className="booking-form-stack">
          <div className="booking-form-row"><label>From<input type="date" value={draft.startDate} onChange={event=>setDraft({...draft,startDate:event.target.value})}/></label><label>Through<input type="date" value={draft.endDate} onChange={event=>setDraft({...draft,endDate:event.target.value})}/></label></div>
          <div className="booking-existing-summary">
            <p className="booking-existing-heading">Already published in this range{existingLoading?' — refreshing…':''}</p>
            {existingByDay.length===0?<p className="booking-empty-inline">Nothing published yet for these dates.</p>:<ul>{existingByDay.map(({day,types})=><li key={day}><strong>{dayLabel(day)}</strong>{types.map(group=><button type="button" key={group.sessionType} className="booking-existing-chip" disabled={working||group.hasBookings} title={group.hasBookings?'Cancel or reschedule the booking on this time before editing.':'Edit this published time'} onClick={()=>startEditGroup(day,group)}>{sessionTypeLabel(group.sessionType)} {timeLabel(group.first)}{group.count>1?`–${timeLabel(group.last)}`:''}</button>)}</li>)}</ul>}
            {editingGroup?<div className="booking-edit-group">
              <p className="booking-existing-heading">Editing {sessionTypeLabel(editingGroup.sessionType)} · {dayLabel(editingGroup.day)}</p>
              <div className="booking-form-row"><label>First time<input type="time" value={editDraft.startTime} onChange={event=>setEditDraft({...editDraft,startTime:event.target.value})}/></label><label>End window<input type="time" value={editDraft.endTime} onChange={event=>setEditDraft({...editDraft,endTime:event.target.value})}/></label></div>
              <div className="booking-form-row">
                <label>Start every (min){editingGroup.sessionType==='regular'?<small>Regular Training must use 30-minute intervals.</small>:null}
                  <input type="number" min={editingGroup.sessionType==='regular'?30:10} max={editingGroup.sessionType==='regular'?30:480} step="5" value={editDraft.intervalMinutes} disabled={editingGroup.sessionType==='regular'} onChange={event=>setEditDraft({...editDraft,intervalMinutes:Number(event.target.value)})}/>
                </label>
                <label>Capacity<input type="number" min="1" value={editDraft.capacity} onChange={event=>setEditDraft({...editDraft,capacity:Number(event.target.value)})}/></label>
              </div>
              <label>Location<input value={editDraft.location} onChange={event=>setEditDraft({...editDraft,location:event.target.value})} placeholder={`${schoolName} Facility`}/></label>
              <div className="booking-form-row">
                <button className="booking-primary" disabled={working} onClick={()=>void saveEditGroup()}>Save changes</button>
                <button className="booking-secondary" disabled={working} onClick={cancelEditGroup}>Cancel</button>
              </div>
            </div>:null}
          </div>
          <fieldset><legend>Days offered</legend><div className="booking-weekdays">{WEEKDAYS.map(day=><button type="button" key={day.id} className={draft.weekdays.includes(day.id)?'is-selected':''} onClick={()=>toggleWeekday(day.id)}>{day.label}</button>)}</div></fieldset>
          <div className="booking-form-row"><label>First time<input type="time" value={draft.startTime} onChange={event=>setDraft({...draft,startTime:event.target.value})}/></label><label>End window<input type="time" value={draft.endTime} onChange={event=>setDraft({...draft,endTime:event.target.value})}/></label></div>
          <div className="booking-form-row">
            <label>Start every (min){buildMode==='regular'?<small>Regular Training must use 30-minute intervals.</small>:null}
              <input type="number" min={buildMode==='regular'?30:10} max={buildMode==='regular'?30:480} step="5" value={draft.intervalMinutes} disabled={buildMode==='regular'} onChange={event=>setDraft({...draft,intervalMinutes:Number(event.target.value)})}/>
            </label>
            <label>Capacity {buildMode==='regular'?'per hour (shared by the :00 and :30 time)':'per mound time'}<input type="number" min="1" value={draft.capacity} onChange={event=>setDraft({...draft,capacity:Number(event.target.value)})}/></label>
          </div>
          <label>Location<input value={draft.location} onChange={event=>setDraft({...draft,location:event.target.value})} placeholder={`${schoolName} Facility`}/></label>
          <button className="booking-primary" disabled={working} onClick={()=>void run({action:'create_slots',sessionType:buildMode,...draft},'Availability published.')}>Publish availability</button>
        </div>
      </article>
      <article className="booking-panel booking-panel--override"><div className="booking-panel-heading"><span>03</span><div><h2>Date overrides</h2><p>Close a specific date without changing your normal availability schedule.</p></div></div>
        <div className="booking-form-stack">
          <div className="booking-form-row">
            <label>Closed date<input type="date" min={today()} value={overrideDraft.date} onChange={event=>setOverrideDraft({...overrideDraft,date:event.target.value})}/></label>
            <label>Applies to<select value={overrideDraft.sessionType} onChange={event=>setOverrideDraft({...overrideDraft,sessionType:event.target.value as OverrideScope})}><option value="all">All session types</option><option value="regular">Regular Training</option><option value="bullpen">Bullpen</option></select></label>
          </div>
          <label>Reason (optional)<input maxLength={160} value={overrideDraft.reason} onChange={event=>setOverrideDraft({...overrideDraft,reason:event.target.value})} placeholder="Holiday, facility closed, travel…"/></label>
          <p className="booking-override-note">Existing bookings are preserved. New bookings on this date will be blocked until you remove the override.</p>
          <button className="booking-primary" disabled={working||!overrideDraft.date} onClick={()=>void run({action:'save_date_override',...overrideDraft},'Date closed.')}>Close this date</button>
          <div className="booking-override-list">
            <p className="booking-existing-heading">Upcoming closures</p>
            {manageOverrides.length===0?<p className="booking-empty-inline">No upcoming date overrides.</p>:manageOverrides.map(override=><div key={override.id} className="booking-override-item"><span><strong>{dayLabel(override.date)}</strong><small>{overrideScopeLabel(override.sessionType)}{override.reason?` · ${override.reason}`:''}</small></span><button type="button" className="booking-link" disabled={working} onClick={()=>{if(window.confirm(`Remove the closure for ${dayLabel(override.date)}?`))void run({action:'delete_date_override',overrideId:override.id},'Date override removed.');}}>Remove</button></div>)}
          </div>
        </div>
      </article>
    </div>:mode==='calendar'&&isStaff?<div className="booking-calendar-panel">
      <div className="booking-calendar-controls">
        <nav className="booking-tabs" aria-label="Calendar view"><button className={calendarView==='day'?'is-active':''} onClick={()=>setCalendarView('day')}>Day</button><button className={calendarView==='week'?'is-active':''} onClick={()=>setCalendarView('week')}>Week</button><button className={calendarView==='month'?'is-active':''} onClick={()=>setCalendarView('month')}>Month</button></nav>
        <div className="booking-calendar-nav">
          <button className="booking-arrow" aria-label="Previous" onClick={()=>setCalendarAnchor(addDays(calendarAnchor,calendarView==='month'?-30:calendarView==='week'?-7:-1))}>←</button>
          <strong>{fullDate(calendarAnchor)}</strong>
          <button className="booking-arrow" aria-label="Next" onClick={()=>setCalendarAnchor(addDays(calendarAnchor,calendarView==='month'?30:calendarView==='week'?7:1))}>→</button>
        </div>
      </div>
      {calendarLoading&&!calendarPayload?<div className="booking-empty">Loading calendar…</div>:<CalendarView view={calendarView} anchor={calendarAnchor} slots={calendarPayload?.slots??[]}/>}
    </div>:<>
      <div className="booking-toolbar"><button className="booking-arrow" aria-label="Previous two weeks" onClick={()=>{const next=addDays(rangeStart,-14);setRangeStart(next);setSelectedDate(next);}}>←</button><div className="booking-days">{days.map(day=><button key={day} className={selectedDate===day?'is-selected':''} onClick={()=>setSelectedDate(day)}><small>{dayLabel(day).split(' ')[0]}</small><strong>{Number(day.slice(-2))}</strong><span>{dayLabel(day).split(' ')[1]}</span></button>)}</div><button className="booking-arrow" aria-label="Next two weeks" disabled={!isStaff&&addDays(rangeStart,14)>maxDate} onClick={()=>{const next=addDays(rangeStart,14);setRangeStart(next);setSelectedDate(next);}}>→</button></div>
      <div className="booking-calendar-head"><div><p>AVAILABLE SESSIONS</p><h2>{fullDate(selectedDate)}</h2></div><select aria-label="Filter by session type" value={typeFilter} onChange={event=>setTypeFilter(event.target.value as 'all'|SessionTypeValue)}><option value="all">All session types</option><option value="regular">Regular Training</option><option value="bullpen">Bullpen</option></select></div>
      {!isStaff?<p className="booking-bullpen-note">Booking opens up to {MAX_ADVANCE_DAYS} days in advance{payload&&payload.minBookingLeadHours>0?`, and must be made at least ${payload.minBookingLeadHours} hour${payload.minBookingLeadHours===1?'':'s'} before the session`:''}.</p>:null}
      {isStaff?<div className="booking-staff-book"><label>Book on behalf of <select value={playerChoice} onChange={event=>setPlayerChoice(Number(event.target.value))}>{payload?.players.map(player=><option key={player.id} value={player.id}>{player.name}</option>)}</select></label></div>:null}
      {loading?<div className="booking-empty">Loading available times…</div>:slots.length===0?<div className="booking-empty"><strong>No sessions posted.</strong><span>{isStaff?'Use Availability setup to open this day.':'Check another day for available training times.'}</span></div>:<div className="booking-slot-list">{slots.map(slot=>{
        const remaining=Math.max(0,slot.capacity-slot.bookedCount);const full=remaining===0;const isBullpen=slot.sessionType==='bullpen';
        const bookedMessage=isBullpen?`Bullpen booked for ${timeLabel(slot.startsAt)}. This is your mound start time — arrive roughly 1 hour early to warm up.`:'Session booked.';
        const reschedulingSameType=rescheduling!==null&&rescheduling.sessionType===slot.sessionType;
        return <article className={`booking-slot ${slot.status!=='open'?'is-closed':''}`} key={slot.id}>
          <time><strong>{timeLabel(slot.startsAt)}</strong></time>
          <div className="booking-slot-main">
            <div><p>{sessionTypeLabel(slot.sessionType)}</p>{isBullpen?<small className="booking-bullpen-note">Mound start time — arrive roughly 1 hour early</small>:null}</div>
            <div className="booking-slot-meta"><span>{slot.location||`${schoolName} Facility`}</span><span className={full?'is-full':''}>{full?'Full':`${remaining} of ${slot.capacity} spots left`}</span></div>
            {isStaff&&slot.attendees.length?<div className="booking-attendees">{slot.attendees.map(attendee=><button title="Cancel this booking" key={attendee.bookingId} onClick={()=>{if(window.confirm(`Cancel ${attendee.playerName}'s booking?`))void run({action:'cancel_booking',bookingId:attendee.bookingId},'Booking cancelled.');}}>{attendee.playerName} ×</button>)}</div>:null}
            {!isStaff&&!isBullpen&&!slot.myBookingId&&slot.status==='open'&&!full&&!rescheduling?<div className="booking-recurring-row"><label>Book weekly ×<input type="number" min="2" max="12" value={recurringWeeks[slot.id]??4} onChange={event=>setRecurringWeeks({...recurringWeeks,[slot.id]:Number(event.target.value)})}/></label><button type="button" className="booking-link" disabled={working} onClick={()=>void runRecurring(slot.id)}>Book recurring</button></div>:null}
          </div>
          <div className="booking-slot-action">
            {reschedulingSameType?
              (slot.myBookingId===rescheduling?.bookingId?<span>Current time</span>:slot.status==='open'&&!full?<button className="booking-primary" disabled={working} onClick={()=>void runReschedule(slot.id)}>Move here</button>:<span>{slot.status==='open'?'Full':slot.status}</span>)
            :rescheduling?<span className="booking-bullpen-note">Not {sessionTypeLabel(rescheduling.sessionType)}</span>
            :slot.myBookingId?<div className="booking-slot-action-group">
                <button className="booking-secondary" disabled={working} onClick={()=>{if(window.confirm('Cancel this booking?'))void run({action:'cancel_booking',bookingId:slot.myBookingId},'Booking cancelled.');}}>Cancel</button>
                <button className="booking-link" disabled={working} onClick={()=>startReschedule(slot.myBookingId!,slot.sessionType)}>Reschedule</button>
              </div>
            :slot.status==='open'&&!full?<button className="booking-primary" disabled={working||(isStaff&&!playerChoice)} onClick={()=>void run({action:'book',slotId:slot.id,...(isStaff?{playerId:playerChoice}:{})},bookedMessage)}>{isStaff?'Add player':'Book'}</button>
            :<span>{slot.status==='open'?'Full':slot.status}</span>}
            {isStaff?(slot.closedByOverride?<span className="booking-bullpen-note">Closed by date override</span>:<button className="booking-link" disabled={working} onClick={()=>void run({action:'slot_status',slotId:slot.id,status:slot.status==='open'?'closed':'open'},slot.status==='open'?'Time closed.':'Time reopened.')}>{slot.status==='open'?'Close time':'Reopen'}</button>):null}
          </div>
        </article>;
      })}</div>}
    </>}
  </section>;
}

function CalendarView({view,anchor,slots}:{view:'day'|'week'|'month';anchor:string;slots:Slot[]}){
  const booked=useMemo(()=>slots.filter(slot=>slot.attendees.length>0),[slots]);
  const byDay=useMemo(()=>{
    const map=new Map<string,Slot[]>();
    for(const slot of booked){const key=dateKey(new Date(slot.startsAt));const list=map.get(key)??[];list.push(slot);map.set(key,list);}
    for(const list of map.values())list.sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
    return map;
  },[booked]);

  if(view==='day'){
    const items=byDay.get(anchor)??[];
    return <div className="booking-slot-list">
      {items.length===0?<div className="booking-empty">No bookings this day.</div>:items.map(slot=>
        <article className="booking-slot is-closed" key={slot.id}>
          <time><strong>{timeLabel(slot.startsAt)}</strong></time>
          <div className="booking-slot-main"><div><p>{sessionTypeLabel(slot.sessionType)}</p></div>
            <div className="booking-slot-meta"><span>{slot.location||'Facility'}</span><span>{slot.attendees.length} of {slot.capacity}</span></div>
            <div className="booking-attendees">{slot.attendees.map(attendee=><span key={attendee.bookingId} className="booking-calendar-chip">{attendee.playerName}</span>)}</div>
          </div>
        </article>)}
    </div>;
  }

  if(view==='week'){
    const days=Array.from({length:7},(_,index)=>addDays(anchor,index));
    return <div className="booking-calendar-week">
      {days.map(day=><div className="booking-calendar-week-col" key={day}>
        <header><strong>{dayLabel(day)}</strong></header>
        <div className="booking-calendar-week-items">
          {(byDay.get(day)??[]).length===0?<span className="booking-calendar-empty">—</span>:(byDay.get(day)??[]).map(slot=>
            <div className="booking-calendar-item" key={slot.id}>
              <strong>{timeLabel(slot.startsAt)}</strong>
              <span>{sessionTypeLabel(slot.sessionType)}</span>
              <span>{slot.attendees.map(attendee=>attendee.playerName).join(', ')}</span>
            </div>)}
        </div>
      </div>)}
    </div>;
  }

  const monthStart=`${anchor.slice(0,7)}-01`;
  const firstWeekday=new Date(`${monthStart}T12:00:00Z`).getUTCDay();
  const daysInMonth=new Date(Number(anchor.slice(0,4)),Number(anchor.slice(5,7)),0).getDate();
  const cells=[...Array(firstWeekday).fill(null),...Array.from({length:daysInMonth},(_,index)=>addDays(monthStart,index))];
  return <div className="booking-calendar-month">
    {WEEKDAYS.map(day=><div className="booking-calendar-month-head" key={day.id}>{day.label}</div>)}
    {cells.map((day,index)=>{
      if(!day)return <div className="booking-calendar-month-cell is-empty" key={`empty-${index}`}/>;
      const items=byDay.get(day)??[];
      const regularCount=items.filter(slot=>slot.sessionType==='regular').reduce((sum,slot)=>sum+slot.attendees.length,0);
      const bullpenCount=items.filter(slot=>slot.sessionType==='bullpen').reduce((sum,slot)=>sum+slot.attendees.length,0);
      return <div className="booking-calendar-month-cell" key={day}>
        <strong>{Number(day.slice(-2))}</strong>
        {items.length===0?null:<div className="booking-calendar-month-summary">{regularCount>0?<span>{regularCount} Regular</span>:null}{bullpenCount>0?<span>{bullpenCount} Bullpen</span>:null}</div>}
      </div>;
    })}
  </div>;
}
