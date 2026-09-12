'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type SessionType={id:number;name:string;description:string;durationMinutes:number;defaultCapacity:number;location:string;active:boolean};
type Person={id:number;name:string};
type Slot={id:number;sessionTypeId:number;sessionTypeName:string;description:string;coachUserId:number;coachName:string;startsAt:string;endsAt:string;capacity:number;location:string;status:'open'|'closed'|'cancelled';bookedCount:number;myBookingId:number|null;attendees:Array<{bookingId:number;playerId:number;playerName:string}>};
type Payload={role:'staff'|'player';sessionTypes:SessionType[];slots:Slot[];staff:Person[];players:Person[];error?:string};

const PHOENIX='America/Phoenix';
const dateKey=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:PHOENIX,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const addDays=(ymd:string,amount:number)=>{const date=new Date(`${ymd}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10);};
const today=()=>dateKey(new Date());
const dayLabel=(ymd:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(new Date(`${ymd}T12:00:00Z`));
const timeLabel=(iso:string)=>new Intl.DateTimeFormat('en-US',{timeZone:PHOENIX,hour:'numeric',minute:'2-digit'}).format(new Date(iso));
const fullDate=(ymd:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric'}).format(new Date(`${ymd}T12:00:00Z`));
const WEEKDAYS=[{id:0,label:'Sun'},{id:1,label:'Mon'},{id:2,label:'Tue'},{id:3,label:'Wed'},{id:4,label:'Thu'},{id:5,label:'Fri'},{id:6,label:'Sat'}];

async function request(body:Record<string,unknown>){
  const response=await fetch('/api/scheduling',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const payload=await response.json().catch(()=>({})) as {error?:string;created?:number};
  if(!response.ok)throw new Error(payload.error||'Scheduling request failed.'); return payload;
}

export default function SchedulingSuite({role,logoSrc,logoAlt,schoolName}:{role:'admin'|'coach'|'player';logoSrc:string;logoAlt:string;schoolName:string}){
  const [mode,setMode]=useState<'book'|'manage'>('book');
  const [selectedDate,setSelectedDate]=useState(today);
  const [rangeStart,setRangeStart]=useState(today);
  const [payload,setPayload]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true); const [working,setWorking]=useState(false);
  const [message,setMessage]=useState(''); const [typeFilter,setTypeFilter]=useState(0);
  const [playerChoice,setPlayerChoice]=useState(0);
  const [typeDraft,setTypeDraft]=useState<{id?:number;name:string;description:string;durationMinutes:number;defaultCapacity:number;location:string}>({name:'',description:'',durationMinutes:60,defaultCapacity:4,location:'PCU Facility'});
  const [availability,setAvailability]=useState({sessionTypeId:0,coachUserId:0,startDate:today(),endDate:addDays(today(),28),weekdays:[1,2,3,4,5],startTime:'15:00',endTime:'19:00',intervalMinutes:60,capacity:4,location:''});
  const isStaff=role!=='player'; const rangeEnd=addDays(rangeStart,41);
  const load=useCallback(async()=>{
    setLoading(true);setMessage('');
    try{const response=await fetch(`/api/scheduling?startDate=${rangeStart}&endDate=${rangeEnd}`,{cache:'no-store'});const next=await response.json() as Payload;
      if(!response.ok)throw new Error(next.error||'Unable to load scheduling.');setPayload(next);
      setAvailability(current=>({...current,sessionTypeId:current.sessionTypeId||next.sessionTypes.find(item=>item.active)?.id||0,
        coachUserId:current.coachUserId||next.staff[0]?.id||0,capacity:current.sessionTypeId?current.capacity:next.sessionTypes.find(item=>item.active)?.defaultCapacity||4}));
      setPlayerChoice(current=>current||next.players[0]?.id||0);
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to load scheduling.');}finally{setLoading(false);}
  },[rangeEnd,rangeStart]);
  useEffect(()=>{void load();},[load]);

  const days=useMemo(()=>Array.from({length:14},(_,index)=>addDays(rangeStart,index)),[rangeStart]);
  const slots=useMemo(()=>(payload?.slots??[]).filter(slot=>dateKey(new Date(slot.startsAt))===selectedDate&&(!typeFilter||slot.sessionTypeId===typeFilter)),[payload?.slots,selectedDate,typeFilter]);
  const run=async(body:Record<string,unknown>,success:string)=>{setWorking(true);setMessage('');try{const result=await request(body);setMessage(typeof result.created==='number'?`${success} ${result.created} new time${result.created===1?'':'s'} added.`:success);await load();}catch(error){setMessage(error instanceof Error?error.message:'Request failed.');}finally{setWorking(false);}};
  const toggleWeekday=(id:number)=>setAvailability(current=>({...current,weekdays:current.weekdays.includes(id)?current.weekdays.filter(value=>value!==id):[...current.weekdays,id]}));

  return <section className="booking-shell">
    <header className="booking-hero">
      <img className="booking-hero-logo" src={logoSrc} alt={logoAlt} />
      <div><p className="booking-kicker">{schoolName.toUpperCase()} SESSION BOOKING</p><h1>Booking</h1><p>Reserve a session, see who is coaching, and keep the week moving.</p></div>
    </header>
    {isStaff?<nav className="booking-tabs" aria-label="Scheduling views"><button className={mode==='book'?'is-active':''} onClick={()=>setMode('book')}>Calendar & bookings</button><button className={mode==='manage'?'is-active':''} onClick={()=>setMode('manage')}>Availability setup</button></nav>:null}
    {message?<div className="booking-message" role="status">{message}</div>:null}
    {mode==='manage'&&isStaff?<div className="booking-manage-grid">
      <article className="booking-panel"><div className="booking-panel-heading"><span>01</span><div><h2>Session types</h2><p>Create the services players can reserve.</p></div></div>
        <div className="booking-form-stack"><label>Session name<input value={typeDraft.name} onChange={event=>setTypeDraft({...typeDraft,name:event.target.value})} placeholder="Small Group Bullpen"/></label>
          <label>Description<textarea value={typeDraft.description} onChange={event=>setTypeDraft({...typeDraft,description:event.target.value})} placeholder="What players should expect"/></label>
          <div className="booking-form-row"><label>Minutes<input type="number" min="10" step="5" value={typeDraft.durationMinutes} onChange={event=>setTypeDraft({...typeDraft,durationMinutes:Number(event.target.value)})}/></label><label>Default capacity<input type="number" min="1" value={typeDraft.defaultCapacity} onChange={event=>setTypeDraft({...typeDraft,defaultCapacity:Number(event.target.value)})}/></label></div>
          <label>Location<input value={typeDraft.location} onChange={event=>setTypeDraft({...typeDraft,location:event.target.value})}/></label>
          <div className="booking-form-actions"><button className="booking-primary" disabled={working||!typeDraft.name.trim()} onClick={()=>void run({action:'save_type',...typeDraft},typeDraft.id?'Session type updated.':'Session type created.')}>{typeDraft.id?'Save changes':'Add session type'}</button>{typeDraft.id?<button className="booking-secondary" onClick={()=>setTypeDraft({name:'',description:'',durationMinutes:60,defaultCapacity:4,location:'PCU Facility'})}>Cancel edit</button>:null}</div>
        </div>
        <div className="booking-type-list">{payload?.sessionTypes.map(type=><button type="button" key={type.id} onClick={()=>setTypeDraft({id:type.id,name:type.name,description:type.description,durationMinutes:type.durationMinutes,defaultCapacity:type.defaultCapacity,location:type.location})}><span><strong>{type.name}</strong><small>{type.durationMinutes} min · {type.defaultCapacity} spots</small></span><em>{type.location} · Edit</em></button>)}</div>
      </article>
      <article className="booking-panel booking-panel--accent"><div className="booking-panel-heading"><span>02</span><div><h2>Build availability</h2><p>Turn a weekly window into individual bookable times.</p></div></div>
        <div className="booking-form-stack"><div className="booking-form-row"><label>Session<select value={availability.sessionTypeId} onChange={event=>{const id=Number(event.target.value);const type=payload?.sessionTypes.find(item=>item.id===id);setAvailability({...availability,sessionTypeId:id,capacity:type?.defaultCapacity??availability.capacity,location:type?.location??availability.location,intervalMinutes:type?.durationMinutes??availability.intervalMinutes});}}>{payload?.sessionTypes.filter(item=>item.active).map(type=><option key={type.id} value={type.id}>{type.name}</option>)}</select></label><label>Coach<select value={availability.coachUserId} onChange={event=>setAvailability({...availability,coachUserId:Number(event.target.value)})}>{payload?.staff.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div>
          <div className="booking-form-row"><label>From<input type="date" value={availability.startDate} onChange={event=>setAvailability({...availability,startDate:event.target.value})}/></label><label>Through<input type="date" value={availability.endDate} onChange={event=>setAvailability({...availability,endDate:event.target.value})}/></label></div>
          <fieldset><legend>Days offered</legend><div className="booking-weekdays">{WEEKDAYS.map(day=><button type="button" key={day.id} className={availability.weekdays.includes(day.id)?'is-selected':''} onClick={()=>toggleWeekday(day.id)}>{day.label}</button>)}</div></fieldset>
          <div className="booking-form-row"><label>First time<input type="time" value={availability.startTime} onChange={event=>setAvailability({...availability,startTime:event.target.value})}/></label><label>End window<input type="time" value={availability.endTime} onChange={event=>setAvailability({...availability,endTime:event.target.value})}/></label></div>
          <div className="booking-form-row"><label>Start every (min)<input type="number" min="10" step="5" value={availability.intervalMinutes} onChange={event=>setAvailability({...availability,intervalMinutes:Number(event.target.value)})}/></label><label>Capacity each time<input type="number" min="1" value={availability.capacity} onChange={event=>setAvailability({...availability,capacity:Number(event.target.value)})}/></label></div>
          <label>Location override<input value={availability.location} onChange={event=>setAvailability({...availability,location:event.target.value})} placeholder="Use session default"/></label>
          <button className="booking-primary" disabled={working} onClick={()=>{const type=payload?.sessionTypes.find(item=>item.id===availability.sessionTypeId);void run({action:'create_slots',...availability,durationMinutes:type?.durationMinutes??60},'Availability published.');}}>Publish availability</button>
        </div>
      </article>
    </div>:<>
      <div className="booking-toolbar"><button className="booking-arrow" aria-label="Previous two weeks" onClick={()=>{const next=addDays(rangeStart,-14);setRangeStart(next);setSelectedDate(next);}}>←</button><div className="booking-days">{days.map(day=><button key={day} className={selectedDate===day?'is-selected':''} onClick={()=>setSelectedDate(day)}><small>{dayLabel(day).split(' ')[0]}</small><strong>{Number(day.slice(-2))}</strong><span>{dayLabel(day).split(' ')[1]}</span></button>)}</div><button className="booking-arrow" aria-label="Next two weeks" onClick={()=>{const next=addDays(rangeStart,14);setRangeStart(next);setSelectedDate(next);}}>→</button></div>
      <div className="booking-calendar-head"><div><p>AVAILABLE SESSIONS</p><h2>{fullDate(selectedDate)}</h2></div><select aria-label="Filter by session type" value={typeFilter} onChange={event=>setTypeFilter(Number(event.target.value))}><option value={0}>All session types</option>{payload?.sessionTypes.filter(item=>item.active).map(type=><option key={type.id} value={type.id}>{type.name}</option>)}</select></div>
      {isStaff?<div className="booking-staff-book"><label>Book on behalf of <select value={playerChoice} onChange={event=>setPlayerChoice(Number(event.target.value))}>{payload?.players.map(player=><option key={player.id} value={player.id}>{player.name}</option>)}</select></label></div>:null}
      {loading?<div className="booking-empty">Loading available times…</div>:slots.length===0?<div className="booking-empty"><strong>No sessions posted.</strong><span>{isStaff?'Use Availability setup to open this day.':'Check another day for available training times.'}</span></div>:<div className="booking-slot-list">{slots.map(slot=>{const remaining=Math.max(0,slot.capacity-slot.bookedCount);const full=remaining===0;return <article className={`booking-slot ${slot.status!=='open'?'is-closed':''}`} key={slot.id}><time><strong>{timeLabel(slot.startsAt)}</strong><span>{timeLabel(slot.endsAt)}</span></time><div className="booking-slot-main"><div><p>{slot.sessionTypeName}</p><h3>{slot.description||'Player development session'}</h3></div><div className="booking-slot-meta"><span>{slot.coachName}</span><span>{slot.location||'PCU Facility'}</span><span className={full?'is-full':''}>{full?'Full':`${remaining} of ${slot.capacity} spots left`}</span></div>{isStaff&&slot.attendees.length?<div className="booking-attendees">{slot.attendees.map(attendee=><button title="Cancel this booking" key={attendee.bookingId} onClick={()=>{if(window.confirm(`Cancel ${attendee.playerName}'s booking?`))void run({action:'cancel_booking',bookingId:attendee.bookingId},'Booking cancelled.');}}>{attendee.playerName} ×</button>)}</div>:null}</div><div className="booking-slot-action">{slot.myBookingId?<button className="booking-secondary" disabled={working} onClick={()=>{if(window.confirm('Cancel this booking?'))void run({action:'cancel_booking',bookingId:slot.myBookingId},'Booking cancelled.');}}>Cancel</button>:slot.status==='open'&&!full?<button className="booking-primary" disabled={working||(isStaff&&!playerChoice)} onClick={()=>void run({action:'book',slotId:slot.id,...(isStaff?{playerId:playerChoice}:{})},'Session booked.')}>{isStaff?'Add player':'Book'}</button>:<span>{slot.status==='open'?'Full':slot.status}</span>}{isStaff?<button className="booking-link" disabled={working} onClick={()=>void run({action:'slot_status',slotId:slot.id,status:slot.status==='open'?'closed':'open'},slot.status==='open'?'Time closed.':'Time reopened.')}>{slot.status==='open'?'Close time':'Reopen'}</button>:null}</div></article>;})}</div>}
    </>}
  </section>;
}
