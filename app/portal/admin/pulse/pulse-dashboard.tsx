'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './pulse.module.css';

type Player = { playerKey:string; playerName:string; lastDate:string|null; acRatio:number|null; acuteWorkload:number|null; chronicWorkload:number|null; oneDayWorkload:number|null; totalThrowCount:number|null; highEffortThrowCount:number|null; eventCount28d:number };
type Workload = { date:string; acRatio:number|null; acuteWorkload:number|null; chronicWorkload:number|null; oneDayWorkload:number|null; totalThrowCount:number|null; highEffortThrowCount:number|null };
type EventRow = { id:string; datetime:string; tag:string|null; highEffort:boolean; armSlot:number|null; armSpeed:number|null; shoulderRotation:number|null; torque:number|null; ballVelocity:number|null; ballWeight:number|null; ballWeightUnit:string|null; simulated:boolean };
type DailyEvent = { date:string; throws:number; highEffortThrows:number; armSpeed:number|null; maxArmSpeed:number|null; torque:number|null; maxTorque:number|null; armSlot:number|null; shoulderRotation:number|null };
type SyncStatus = { lastRequestedAt:string|null; lastCompletedAt:string|null; status:'idle'|'queued'|'success'|'failed'; cooldownUntil:string|null };
type Data = { schoolCode:string; players:Player[]; selectedPlayerKey:string; workload:Workload[]; events:EventRow[]; dailyEvents:DailyEvent[]; uploads:Array<{id:string;fileName:string;kind:string;rowCount:number;insertedRows:number;minDate:string;maxDate:string;createdAt:string}>; sync:SyncStatus; summary:{throws7:number;throws28:number;avgTorque7:number|null;avgArmSpeed7:number|null;avgStress7:number|null;avgStress28:number|null} };

const fmt = (value:number|null, digits=2) => value == null ? '—' : value.toFixed(digits).replace(/\.00$/, '');
const dateLabel = (value:string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const fullDate = (value:string) => new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
const arizonaDateTime = (value:string) => new Date(value).toLocaleString(undefined,{timeZone:'America/Phoenix',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const localIsoDate = (offsetDays=0) => {
  const date=new Date();
  date.setDate(date.getDate()+offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};

async function imageUrlToDataUrl(url:string):Promise<string> {
  const response=await fetch(url);
  if(!response.ok)throw new Error('Unable to load the report logo.');
  const blob=await response.blob();
  return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));
    reader.onerror=()=>reject(reader.error??new Error('Unable to read the report logo.'));
    reader.readAsDataURL(blob);
  });
}

function withTimeout<T>(promise:Promise<T>,milliseconds:number,message:string):Promise<T> {
  return new Promise((resolve,reject)=>{
    const timer=window.setTimeout(()=>reject(new Error(message)),milliseconds);
    promise.then(value=>{window.clearTimeout(timer);resolve(value)},error=>{window.clearTimeout(timer);reject(error)});
  });
}

function statusClass(ratio:number|null) {
  if (ratio == null) return styles.neutral;
  if (ratio >= .8 && ratio <= 1.3) return styles.good;
  if ((ratio >= .6 && ratio < .8) || (ratio > 1.3 && ratio <= 1.5)) return styles.warn;
  return styles.danger;
}

function LineChart({ rows, lines, bars }:{ rows:Array<Record<string,unknown>>; lines:Array<{key:string;label:string;color:string}>; bars?:{key:string;color:string;label:string} }) {
  const [hoveredIndex,setHoveredIndex]=useState<number|null>(null);
  const ordered = [...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const lineValues = ordered.flatMap(row=>lines.map(line=>Number(row[line.key])).filter(Number.isFinite));
  const rawMax = lineValues.length ? Math.max(...lineValues) : 1;
  const rawMin = lineValues.length ? Math.min(...lineValues) : 0;
  const padding = Math.max((rawMax-rawMin)*.12, Math.abs(rawMax)*.04, .1);
  const max = rawMax+padding, min = rawMin-padding, span = max-min || 1;
  const barValues = bars ? ordered.map(row=>Number(row[bars.key])).filter(Number.isFinite) : [];
  const barMax = Math.max(...barValues,1)*1.08;
  const x = (i:number) => ordered.length <= 1 ? 50 : 6 + i*90/(ordered.length-1);
  const y = (v:number) => Math.max(12,Math.min(88,88-((v-min)/span)*76));
  const barY = (v:number) => Math.max(12,Math.min(88,88-(Math.max(0,v)/barMax)*76));
  const barWidth = Math.max(.65,Math.min(3.2,70/Math.max(ordered.length,1)));
  const yTicks=Array.from({length:7},(_,index)=>max-(span*index)/6);
  const barTicks=Array.from({length:7},(_,index)=>barMax-(barMax*index)/6);
  const dateTickCount=Math.min(7,ordered.length);
  const dateIndices=dateTickCount===1?[0]:Array.from({length:dateTickCount},(_,index)=>Math.round((index*(ordered.length-1))/(dateTickCount-1)));
  const hovered=hoveredIndex==null?null:ordered[hoveredIndex];
  const hoverX=hoveredIndex==null?50:x(hoveredIndex);
  const hoverTransform=hoverX>78?'translateX(-100%)':hoverX<22?'translateX(0)':'translateX(-50%)';
  const showValue=(value:unknown)=>Number.isFinite(Number(value))?Number(value).toFixed(2).replace(/\.00$/,''):'—';
  return <div className={styles.chart} onMouseLeave={()=>setHoveredIndex(null)}>
    <div className={styles.chartPlot} data-pulse-chart-plot>
      <div className={styles.yAxis} data-pulse-y-axis="left" aria-hidden="true">{yTicks.map((value,index)=><span key={index} style={{top:`${12+(index*76)/6}%`}}>{showValue(value)}</span>)}</div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Interactive PULSE chart">
      {Array.from({length:7},(_,index)=>12+(index*76)/6).map(n=><line key={n} x1="4" y1={n} x2="97" y2={n} className={styles.grid}/>) }
      {bars && ordered.map((row,i)=>{const value=Number(row[bars.key]); if(!Number.isFinite(value)) return null; const top=barY(value); return <rect key={i} x={x(i)-barWidth/2} y={top} width={barWidth} height={88-top} rx=".35" fill={bars.color} opacity=".58"/>})}
      {hoveredIndex!=null&&<line x1={hoverX} y1="12" x2={hoverX} y2="88" className={styles.hoverGuide}/>}
      {lines.map(line=>{const points=ordered.map((row,i)=>({x:x(i),y:y(Number(row[line.key])),ok:Number.isFinite(Number(row[line.key]))})).filter(p=>p.ok); return <g key={line.key}><polyline points={points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>{points.map((point,index)=><ellipse key={index} cx={point.x} cy={point.y} rx=".38" ry="1.7" fill={line.color}/>)}</g>})}
      {ordered.map((row,index)=>{const width=Math.max(1.2,90/Math.max(ordered.length,1));return <rect key={`hit-${String(row.date)}-${index}`} x={x(index)-width/2} y="8" width={width} height="84" fill="transparent" tabIndex={0} aria-label={`${dateLabel(String(row.date))} chart values`} onMouseEnter={()=>setHoveredIndex(index)} onFocus={()=>setHoveredIndex(index)}/>})}
      </svg>
      {bars&&<div className={styles.yAxisRight} data-pulse-y-axis="right" aria-hidden="true">{barTicks.map((value,index)=><span key={index} style={{top:`${12+(index*76)/6}%`}}>{showValue(value)}</span>)}</div>}
      {hovered&&<div className={styles.chartTooltip} data-pulse-chart-tooltip style={{left:`${hoverX}%`,transform:hoverTransform}}><strong>{new Date(`${String(hovered.date)}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</strong>{lines.map(line=><span key={line.key}><i style={{background:line.color}}/>{line.label}<b>{showValue(hovered[line.key])}</b></span>)}{bars&&<span><i style={{background:bars.color}}/>{bars.label}<b>{showValue(hovered[bars.key])}</b></span>}</div>}
    </div>
    <div className={styles.chartDates}>{dateIndices.length?dateIndices.map(index=><span key={index}>{dateLabel(String(ordered[index].date))}</span>):<span>No data</span>}</div>
    <div className={styles.legend}>{lines.map(line=><span key={line.key}><i style={{background:line.color}}/> {line.label}</span>)}{bars&&<span><i style={{background:bars.color}}/> {bars.label}</span>}</div>
  </div>;
}

export default function PulseDashboard({ schoolCode,schoolLogoSrc,schoolLogoAlt }:{schoolCode:string;schoolLogoSrc:string|null;schoolLogoAlt:string}) {
  const [data,setData]=useState<Data|null>(null); const [error,setError]=useState(''); const [loading,setLoading]=useState(true);
  const [player,setPlayer]=useState(''); const [query,setQuery]=useState(''); const [tab,setTab]=useState<'workload'|'events'>('workload');
  const [start,setStart]=useState(()=>localIsoDate(-27)); const [end,setEnd]=useState(()=>localIsoDate()); const [sort,setSort]=useState('desc');
  const [sidebarOpen,setSidebarOpen]=useState(true);
  const [exporting,setExporting]=useState(false);
  const [syncing,setSyncing]=useState(false); const [clock,setClock]=useState(()=>Date.now());
  const [files,setFiles]=useState<File[]>([]); const [uploading,setUploading]=useState(false); const [notice,setNotice]=useState(''); const inputRef=useRef<HTMLInputElement>(null);
  const exportRef=useRef<HTMLDivElement>(null);
  const [eventPage,setEventPage]=useState(0); const PAGE=100;
  const load=useCallback(async (key=player)=>{setLoading(true);setError('');try{const qs=new URLSearchParams();if(key)qs.set('player',key);if(start)qs.set('start',start);if(end)qs.set('end',end);qs.set('sort',sort);const response=await fetch(`/api/admin/pulse?${qs}`,{cache:'no-store'});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to load PULSE.');setData(payload);setPlayer(payload.selectedPlayerKey||'');}catch(e){setError(e instanceof Error?e.message:'Unable to load PULSE.');}finally{setLoading(false)}},[player,start,end,sort]);
  useEffect(()=>{void load();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{setEventPage(0)},[player,start,end,sort]);
  useEffect(()=>{
    if(data?.sync.status!=='queued'||!data.sync.cooldownUntil||new Date(data.sync.cooldownUntil).getTime()<=Date.now())return;
    const timer=window.setInterval(()=>void load(),15000);
    return ()=>window.clearInterval(timer);
  },[data?.sync.cooldownUntil,data?.sync.status,load]);
  useEffect(()=>{
    if(!data?.sync.cooldownUntil||new Date(data.sync.cooldownUntil).getTime()<=Date.now())return;
    const timer=window.setInterval(()=>setClock(Date.now()),1000);
    return ()=>window.clearInterval(timer);
  },[data?.sync.cooldownUntil]);
  const filtered=useMemo(()=>data?.players.filter(p=>p.playerName.toLowerCase().includes(query.toLowerCase()))??[],[data,query]);
  const selected=data?.players.find(p=>p.playerKey===data.selectedPlayerKey);
  const choose=(key:string)=>{setPlayer(key);void load(key)};
  async function exportPdf(){
    const node=exportRef.current;
    if(!node||!data||!selected||exporting)return;
    setExporting(true);setError('');
    try{
      const [{default:html2canvas},{jsPDF},pearlLogo]=await Promise.all([import('html2canvas'),import('jspdf'),imageUrlToDataUrl('/pearl-lockup-transparent.png')]);
      await Promise.race([
        Promise.all(Array.from(node.querySelectorAll('img')).map(async image=>{if(image.complete)return;try{await image.decode()}catch{}})),
        new Promise(resolve=>window.setTimeout(resolve,2500)),
      ]);
      const nodeRect=node.getBoundingClientRect();
      const pearlRect=node.querySelector<HTMLElement>('[data-pulse-export-pearl]')?.getBoundingClientRect()??null;
      const captureWidth=Math.ceil(Math.max(node.scrollWidth,nodeRect.width));
      const captureHeight=Math.ceil(Math.max(node.scrollHeight,nodeRect.height));
      const canvas=await withTimeout(html2canvas(node,{
        backgroundColor:'#07182d',
        // 1.25x is already ~210 DPI once this tall one-page report is fitted
        // to landscape letter. Higher values add memory/CPU without visible
        // print benefit and can stall PDF export on iPads and older laptops.
        scale:1.25,
        useCORS:true,
        logging:false,
        imageTimeout:3000,
        removeContainer:true,
        width:captureWidth,
        height:captureHeight,
        windowWidth:Math.max(1600,captureWidth),
        windowHeight:Math.max(window.innerHeight,captureHeight+40),
        scrollX:0,
        scrollY:0,
        onclone:(documentClone)=>{
          const clonedRoot=documentClone.querySelector<HTMLElement>('[data-pulse-export-root]');
          if(clonedRoot){
            clonedRoot.style.position='absolute';
            clonedRoot.style.inset='0 auto auto 0';
            clonedRoot.style.width=`${captureWidth}px`;
            clonedRoot.style.height=`${captureHeight}px`;
            clonedRoot.style.minHeight='0';
            clonedRoot.style.overflow='visible';
          }
          const clonedPearl=documentClone.querySelector<HTMLElement>('[data-pulse-export-pearl]');
          if(clonedPearl)clonedPearl.style.visibility='hidden';
        },
      }),45000,'The report took too long to render. Please try exporting again.');
      const pdf=new jsPDF({orientation:'landscape',unit:'pt',format:'letter'});
      const pageWidth=pdf.internal.pageSize.getWidth(); const pageHeight=pdf.internal.pageSize.getHeight(); const margin=16;
      pdf.setFillColor(7,24,45);pdf.rect(0,0,pageWidth,pageHeight,'F');
      const scale=Math.min((pageWidth-margin*2)/canvas.width,(pageHeight-margin*2)/canvas.height);
      const width=canvas.width*scale; const height=canvas.height*scale;
      const offsetX=(pageWidth-width)/2; const offsetY=(pageHeight-height)/2;
      pdf.addImage(canvas.toDataURL('image/jpeg',.94),'JPEG',offsetX,offsetY,width,height,undefined,'FAST');
      if(pearlRect){
        const domScale=width/captureWidth;
        pdf.addImage(
          pearlLogo,
          'PNG',
          offsetX+(pearlRect.left-nodeRect.left)*domScale,
          offsetY+(pearlRect.top-nodeRect.top)*domScale,
          pearlRect.width*domScale,
          pearlRect.height*domScale,
          undefined,
          'FAST'
        );
      }
      const safeName=selected.playerName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      pdf.save(`pulse-${safeName||'athlete'}-${start||'all'}-${end||'all'}.pdf`);
    }catch(e){setError(e instanceof Error?e.message:'Unable to export PULSE PDF.')}finally{setExporting(false)}
  }
  async function upload(){if(!files.length)return;setUploading(true);setError('');setNotice('');try{const form=new FormData();files.forEach(file=>form.append('files',file));const response=await fetch('/api/admin/pulse',{method:'POST',body:form});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Upload failed.');const inserted=payload.results.reduce((sum:number,row:{insertedRows:number})=>sum+row.insertedRows,0);setNotice(`${payload.results.length} file${payload.results.length===1?'':'s'} processed · ${inserted.toLocaleString()} rows added or refreshed.`);setFiles([]);if(inputRef.current)inputRef.current.value='';await load();}catch(e){setError(e instanceof Error?e.message:'Upload failed.')}finally{setUploading(false)}}
  async function syncNewData(){
    if(syncing)return;
    setSyncing(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/admin/pulse/sync',{method:'POST'});
      const payload=await response.json();
      if(payload.sync)setData(current=>current?{...current,sync:payload.sync}:current);
      if(!response.ok)throw new Error(payload.error||'Unable to start PULSE sync.');
      setNotice('PULSE sync started. New data usually appears within a few minutes.');
    }catch(e){setError(e instanceof Error?e.message:'Unable to start PULSE sync.')}finally{setSyncing(false)}
  }
  const cooldownSeconds=data?.sync.cooldownUntil?Math.max(0,Math.ceil((new Date(data.sync.cooldownUntil).getTime()-clock)/1000)):0;
  const syncQueued=data?.sync.status==='queued';
  const syncDisabled=syncing||cooldownSeconds>0;
  const eventSlice=data?.events.slice(eventPage*PAGE,(eventPage+1)*PAGE)??[];
  return <main className={styles.shell}>
    <header className={styles.hero}><div><p className={styles.eyebrow}>ARM CARE INTELLIGENCE · {schoolCode}</p><h1>PULSE</h1><p>Daily throwing workload and arm-action metrics in one coaching view.</p></div>{schoolCode==='ARIZONA'?<div className={styles.syncBox}><button type="button" className={styles.syncButton} disabled={syncDisabled} onClick={()=>void syncNewData()}>{syncing||(syncQueued&&cooldownSeconds>0)?'Syncing…':cooldownSeconds>0?`Available in ${Math.ceil(cooldownSeconds/60)} min`:'Sync New Data'}</button><small>{data?.sync.lastCompletedAt?`Last successful sync: ${arizonaDateTime(data.sync.lastCompletedAt)}`:'No automated sync has completed yet.'}</small><span>Requests are limited to once every 10 minutes.</span></div>:<div className={styles.uploadBox}><input ref={inputRef} type="file" accept=".csv,text/csv" multiple onChange={e=>setFiles(Array.from(e.target.files??[]))}/><button type="button" onClick={()=>inputRef.current?.click()}>Upload CSVs</button><button type="button" className={styles.importButton} disabled={!files.length||uploading} onClick={upload}>{uploading?'Importing…':`Import${files.length?` ${files.length}`:''}`}</button><small>{files.length?files.map(f=>f.name).join(' · '):'Workload and events exports can be uploaded together.'}</small></div>}</header>
    {notice&&<div className={styles.success}>{notice}</div>}{error&&<div className={styles.error}>{error}</div>}
    <div className={styles.tabs}><button className={tab==='workload'?styles.activeTab:''} onClick={()=>setTab('workload')}>Workload</button><button className={tab==='events'?styles.activeTab:''} onClick={()=>setTab('events')}>Arm Metrics</button></div>
    <section className={styles.filters}>
      <label><span>Search athletes</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="First or last name"/></label>
      <label><span>Start date</span><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label><span>End date</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
      <label className={styles.sortField}><span>Sort</span><select className={styles.sortSelect} style={{height:46,minHeight:46,padding:'12px',boxSizing:'border-box'}} value={sort} onChange={e=>setSort(e.target.value)}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></label>
      <button onClick={()=>void load()}>Apply dates</button>
    </section>
    {loading&&!data?<div className={styles.empty}>Loading PULSE…</div>:!data?.players.length?<div className={styles.empty}><strong>No PULSE data yet.</strong><span>{schoolCode==='ARIZONA'?'Use Sync New Data above to retrieve the latest PULSE exports.':'Upload one or more workload/events CSV exports above.'}</span></div>:
    <div className={`${styles.workspace}${sidebarOpen?'':` ${styles.sidebarHidden}`}`}>
      {sidebarOpen?<aside className={styles.roster}>
        <div className={styles.rosterHead}><span>Athlete</span><span>A:C Ratio</span><span>Acute WL</span><span>Chronic WL</span><span>Throw Count</span><span>1-Day WL</span></div>
        {filtered.map(p=><button key={p.playerKey} className={p.playerKey===data.selectedPlayerKey?styles.selectedPlayer:''} onClick={()=>choose(p.playerKey)}>
          <span className={styles.playerCell}><i className={statusClass(p.acRatio)}/><b>{p.playerName}</b><small>{p.lastDate?`Updated ${dateLabel(p.lastDate)}`:'Events only'}</small></span>
          <strong className={statusClass(p.acRatio)}>{fmt(p.acRatio)}</strong>
          <span className={`${styles.diagnosticValue} ${styles.acuteValue}`}>{fmt(p.acuteWorkload)}</span>
          <span className={`${styles.diagnosticValue} ${styles.chronicValue}`}>{fmt(p.chronicWorkload)}</span>
          <span className={styles.throwCount}>{fmt(p.totalThrowCount,0)}</span>
          <span className={`${styles.diagnosticValue} ${styles.oneDayValue}`}>{fmt(p.oneDayWorkload)}</span>
        </button>)}
      </aside>:null}
      <article className={styles.profile}>
        <button
          type="button"
          className={styles.sidebarToggle}
          onClick={()=>setSidebarOpen(value=>!value)}
          aria-label={sidebarOpen?'Hide athlete sidebar':'Show athlete sidebar'}
          title={sidebarOpen?'Hide athlete sidebar':'Show athlete sidebar'}
        >
          {sidebarOpen?'‹':'›'}
        </button>
        <div className={styles.profileTitle}><div><p>ATHLETE PROFILE</p><h2>{selected?.playerName}</h2></div><button type="button" className={styles.exportButton} onClick={()=>void exportPdf()} disabled={exporting}>{exporting?'Exporting…':'Export PDF'}</button></div>
        <div className={styles.cards}><div><small>7-DAY AVG. THROWS / DAY</small><strong>{fmt(data.summary.throws7,1)}</strong></div><div><small>7-DAY AVG. STRESS</small><strong>{fmt(data.summary.avgStress7)}</strong></div><div><small>28-DAY AVG. THROWS / DAY</small><strong>{fmt(data.summary.throws28,1)}</strong></div><div><small>28-DAY AVG. STRESS</small><strong>{fmt(data.summary.avgStress28)}</strong></div></div>
        {tab==='workload'?<>
          <section className={styles.panel}><h3>A:C Ratio and Daily Workload</h3><LineChart rows={data.workload as unknown as Array<Record<string,unknown>>} bars={{key:'oneDayWorkload',label:'1-day workload',color:'#22b8e6'}} lines={[{key:'acRatio',label:'A:C ratio',color:'#ff9f1c'}]}/></section>
          <section className={styles.panel}><h3>Chronic Workload</h3><LineChart rows={data.workload as unknown as Array<Record<string,unknown>>} lines={[{key:'chronicWorkload',label:'Chronic workload',color:'#17c3b2'},{key:'acuteWorkload',label:'Acute workload',color:'#8d79ff'}]}/></section>
          <div className={styles.dataTable}><table><thead><tr><th>Date</th><th>A:C Ratio</th><th>Acute</th><th>Chronic</th><th>1-Day</th><th>Throws</th><th>High Effort</th></tr></thead><tbody>{data.workload.map(row=><tr key={row.date}><td>{new Date(`${row.date}T12:00:00`).toLocaleDateString()}</td><td><b className={statusClass(row.acRatio)}>{fmt(row.acRatio)}</b></td><td>{fmt(row.acuteWorkload)}</td><td>{fmt(row.chronicWorkload)}</td><td>{fmt(row.oneDayWorkload)}</td><td>{fmt(row.totalThrowCount,0)}</td><td>{fmt(row.highEffortThrowCount,0)}</td></tr>)}</tbody></table></div>
        </>:<>
          <div className={styles.metricCards}><div><small>AVG ARM SPEED · 7D</small><strong>{fmt(data.summary.avgArmSpeed7)} <i>mph</i></strong></div><div><small>AVG TORQUE · 7D</small><strong>{fmt(data.summary.avgTorque7)} <i>Nm</i></strong></div></div>
          <section className={styles.panel}><h3>Arm Speed and Torque</h3><LineChart rows={data.dailyEvents as unknown as Array<Record<string,unknown>>} lines={[{key:'armSpeed',label:'Avg arm speed',color:'#22b8e6'},{key:'torque',label:'Avg torque',color:'#ff5a7a'}]}/></section>
          <section className={styles.panel}><h3>Arm Slot and Shoulder Rotation</h3><LineChart rows={data.dailyEvents as unknown as Array<Record<string,unknown>>} lines={[{key:'armSlot',label:'Arm slot',color:'#f4bd4f'},{key:'shoulderRotation',label:'Shoulder rotation',color:'#8d79ff'}]}/></section>
          <div className={styles.dataTable}><table><thead><tr><th>Date & time</th><th>Tag</th><th>Arm speed</th><th>Torque</th><th>Arm slot</th><th>Shoulder rotation</th><th>Ball</th><th>Effort</th></tr></thead><tbody>{eventSlice.map(row=><tr key={row.id}><td>{fullDate(row.datetime)}</td><td>{row.tag||'—'}</td><td>{fmt(row.armSpeed)}</td><td>{fmt(row.torque)}</td><td>{fmt(row.armSlot)}°</td><td>{fmt(row.shoulderRotation)}°</td><td>{row.ballWeight==null?'—':`${fmt(row.ballWeight)} ${row.ballWeightUnit||''}`}</td><td>{row.highEffort?'High':'Normal'}{row.simulated?' · Sim':''}</td></tr>)}</tbody></table><div className={styles.pager}><span>{data.events.length?`${eventPage*PAGE+1}–${Math.min((eventPage+1)*PAGE,data.events.length)} of ${data.events.length.toLocaleString()}`:'No events'}</span><button disabled={eventPage===0} onClick={()=>setEventPage(v=>v-1)}>Previous</button><button disabled={(eventPage+1)*PAGE>=data.events.length} onClick={()=>setEventPage(v=>v+1)}>Next</button></div></div>
        </>}
      </article>
    </div>}
    {data&&selected?<div ref={exportRef} className={styles.exportSheet} data-pulse-export-root aria-hidden="true">
      <header className={styles.exportHeader}>
        <div className={styles.exportLogoBox}>{schoolLogoSrc?<Image src={schoolLogoSrc} alt={schoolLogoAlt} width={76} height={76} unoptimized/>:<strong>{schoolCode}</strong>}</div>
        <div><p>PULSE PERFORMANCE REPORT</p><h2>{selected.playerName}</h2><span>{start||'All dates'} — {end||'Present'} · {tab==='workload'?'Workload':'Arm Metrics'}</span></div>
        <div className={styles.exportPearl} data-pulse-export-pearl><Image src="/pearl-lockup-transparent.png" alt="Pearl Player Development" width={170} height={44} unoptimized/></div>
      </header>
      <div className={styles.exportCards}>
        {tab==='workload'?<>
          <div><small>7-DAY AVG. THROWS / DAY</small><strong>{fmt(data.summary.throws7,1)}</strong></div><div><small>7-DAY AVG. STRESS</small><strong>{fmt(data.summary.avgStress7)}</strong></div><div><small>28-DAY AVG. THROWS / DAY</small><strong>{fmt(data.summary.throws28,1)}</strong></div><div><small>28-DAY AVG. STRESS</small><strong>{fmt(data.summary.avgStress28)}</strong></div>
        </>:<>
          <div><small>AVG ARM SPEED · 7D</small><strong>{fmt(data.summary.avgArmSpeed7)} mph</strong></div><div><small>AVG TORQUE · 7D</small><strong>{fmt(data.summary.avgTorque7)} Nm</strong></div><div><small>EVENTS · 28D</small><strong>{selected.eventCount28d}</strong></div><div><small>HIGH EFFORT THROWS</small><strong>{fmt(selected.highEffortThrowCount,0)}</strong></div>
        </>}
      </div>
      <div className={styles.exportCharts}>
        {tab==='workload'?<>
          <section className={styles.panel}><h3>A:C Ratio and Daily Workload</h3><LineChart rows={data.workload as unknown as Array<Record<string,unknown>>} bars={{key:'oneDayWorkload',label:'1-day workload',color:'#22b8e6'}} lines={[{key:'acRatio',label:'A:C ratio',color:'#ff9f1c'}]}/></section>
          <section className={styles.panel}><h3>Chronic Workload</h3><LineChart rows={data.workload as unknown as Array<Record<string,unknown>>} lines={[{key:'chronicWorkload',label:'Chronic workload',color:'#17c3b2'},{key:'acuteWorkload',label:'Acute workload',color:'#8d79ff'}]}/></section>
        </>:<>
          <section className={styles.panel}><h3>Arm Speed and Torque</h3><LineChart rows={data.dailyEvents as unknown as Array<Record<string,unknown>>} lines={[{key:'armSpeed',label:'Avg arm speed',color:'#22b8e6'},{key:'torque',label:'Avg torque',color:'#ff5a7a'}]}/></section>
          <section className={styles.panel}><h3>Arm Slot and Shoulder Rotation</h3><LineChart rows={data.dailyEvents as unknown as Array<Record<string,unknown>>} lines={[{key:'armSlot',label:'Arm slot',color:'#f4bd4f'},{key:'shoulderRotation',label:'Shoulder rotation',color:'#8d79ff'}]}/></section>
        </>}
      </div>
      <section className={styles.exportData}>
        <div className={styles.exportDataTitle}><h3>Data by Date</h3><span>{tab==='workload'?data.workload.length:data.dailyEvents.length} dates</span></div>
        {tab==='workload'?<table><thead><tr><th>Date</th><th>A:C Ratio</th><th>Acute WL</th><th>Chronic WL</th><th>1-Day WL</th><th>Throws</th><th>High Effort</th></tr></thead><tbody>{data.workload.length?data.workload.map(row=><tr key={row.date}><td>{new Date(`${row.date}T12:00:00`).toLocaleDateString()}</td><td>{fmt(row.acRatio)}</td><td>{fmt(row.acuteWorkload)}</td><td>{fmt(row.chronicWorkload)}</td><td>{fmt(row.oneDayWorkload)}</td><td>{fmt(row.totalThrowCount,0)}</td><td>{fmt(row.highEffortThrowCount,0)}</td></tr>):<tr><td colSpan={7}>No workload data in this date range.</td></tr>}</tbody></table>:<table><thead><tr><th>Date</th><th>Throws</th><th>High Effort</th><th>Avg Arm Speed</th><th>Max Arm Speed</th><th>Avg Torque</th><th>Max Torque</th><th>Arm Slot</th><th>Shoulder Rotation</th></tr></thead><tbody>{data.dailyEvents.length?data.dailyEvents.map(row=><tr key={row.date}><td>{new Date(`${row.date}T12:00:00`).toLocaleDateString()}</td><td>{fmt(row.throws,0)}</td><td>{fmt(row.highEffortThrows,0)}</td><td>{fmt(row.armSpeed)}</td><td>{fmt(row.maxArmSpeed)}</td><td>{fmt(row.torque)}</td><td>{fmt(row.maxTorque)}</td><td>{fmt(row.armSlot)}°</td><td>{fmt(row.shoulderRotation)}°</td></tr>):<tr><td colSpan={9}>No arm-metric data in this date range.</td></tr>}</tbody></table>}
      </section>
      <footer className={styles.exportFooter}>Generated from PULSE · {new Date().toLocaleDateString()}</footer>
    </div>:null}
  </main>;
}
