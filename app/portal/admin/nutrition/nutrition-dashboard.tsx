'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NutritionAdherenceRow, NutritionLogRow, NutritionTargetRow } from '../../../../lib/training-db';
import styles from './nutrition-dashboard.module.css';

type ViewTab = 'roster' | 'calories' | 'macros';
type DailyNutrition = { date: string; calories: number; protein: number; carbs: number; fat: number };

const shortDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const whole = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : Math.round(value).toLocaleString();

function PlayerSelect({ rows, value, onChange }: { rows: NutritionAdherenceRow[]; value: number; onChange: (value: number) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement | null>(null);
  const selected = rows.find((row) => row.playerId === value);
  const filtered = rows.filter((row) => row.playerName.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return <div className={styles.playerPicker} ref={root}>
    <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
      <span className={styles.playerMonogram}>{selected?.playerName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('') || '—'}</span>
      <span><small>Viewing Athlete</small><b>{selected?.playerName || 'Select a player'}</b></span><i>⌄</i>
    </button>
    {open ? <div className={styles.playerMenu}>
      <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players…" />
      <div>{filtered.map((row) => <button type="button" key={row.playerId} className={row.playerId === value ? styles.selectedOption : ''} onClick={() => { onChange(row.playerId); setOpen(false); setQuery(''); }}><span>{row.playerName}</span>{row.playerId === value ? <b>✓</b> : null}</button>)}{!filtered.length ? <p>No players found.</p> : null}</div>
    </div> : null}
  </div>;
}

function EmptyChart({ message }: { message: string }) {
  return <div className={styles.emptyChart}><span>⌁</span><b>{message}</b><small>Try a wider date range or choose another athlete.</small></div>;
}

function CalorieChart({ points, target }: { points: DailyNutrition[]; target: number | null }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (!points.length) return <EmptyChart message="No calorie logs in this date range." />;
  const width = 920, height = 330, pad = { left: 62, right: 22, top: 28, bottom: 48 };
  const values = [...points.map((point) => point.calories), ...(target ? [target] : [])];
  const max = Math.max(500, ...values) * 1.12;
  const x = (index: number) => pad.left + (index / Math.max(1, points.length - 1)) * (width - pad.left - pad.right);
  const y = (value: number) => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(point.calories).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(points.length - 1)} ${height - pad.bottom} L ${x(0)} ${height - pad.bottom} Z`;
  const ticks = [0, .25, .5, .75, 1].map((ratio) => Math.round(max * ratio));
  return <div className={styles.chartShell} onMouseLeave={() => setHovered(null)}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Calories logged by day">
      <defs><linearGradient id="calorie-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e5bb7a" stopOpacity=".35"/><stop offset="1" stopColor="#e5bb7a" stopOpacity="0"/></linearGradient></defs>
      {ticks.map((tick) => <g key={tick}><line x1={pad.left} x2={width-pad.right} y1={y(tick)} y2={y(tick)} className={styles.gridLine}/><text x={pad.left-10} y={y(tick)+4} textAnchor="end" className={styles.axisText}>{tick.toLocaleString()}</text></g>)}
      <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height-pad.bottom} className={styles.axisLine}/><line x1={pad.left} x2={width-pad.right} y1={height-pad.bottom} y2={height-pad.bottom} className={styles.axisLine}/>
      {target ? <g><line x1={pad.left} x2={width-pad.right} y1={y(target)} y2={y(target)} className={styles.targetLine}/><text x={width-pad.right} y={y(target)-8} textAnchor="end" className={styles.targetText}>TARGET {target.toLocaleString()}</text></g> : null}
      <path d={area} fill="url(#calorie-area)"/><path d={line} fill="none" className={styles.calorieLine}/>
      {points.map((point, index) => <g key={point.date} onMouseEnter={() => setHovered(index)}><circle cx={x(index)} cy={y(point.calories)} r="12" fill="transparent"/><circle cx={x(index)} cy={y(point.calories)} r={hovered === index ? 6 : 4} className={styles.calorieDot}/></g>)}
      <text x={pad.left} y={height-18} className={styles.axisText}>{shortDate(points[0].date)}</text><text x={width-pad.right} y={height-18} textAnchor="end" className={styles.axisText}>{shortDate(points.at(-1)!.date)}</text>
      <text x="16" y={height/2} textAnchor="middle" transform={`rotate(-90 16 ${height/2})`} className={styles.axisTitle}>Calories</text><text x={width/2} y={height-4} textAnchor="middle" className={styles.axisTitle}>Date</text>
    </svg>
    {hovered != null ? <div className={styles.chartTooltip} style={{ left: `${(x(hovered)/width)*100}%`, top: `${(y(points[hovered].calories)/height)*100}%` }}><b>{points[hovered].calories.toLocaleString()} cal</b><span>{shortDate(points[hovered].date)}</span></div> : null}
  </div>;
}

const MACROS = [
  { key: 'protein' as const, label: 'Protein', color: '#ef6a78' },
  { key: 'carbs' as const, label: 'Carbohydrates', color: '#e5bb7a' },
  { key: 'fat' as const, label: 'Fat', color: '#58c7ad' },
];

function MacroChart({ points }: { points: DailyNutrition[] }) {
  const [hovered, setHovered] = useState<{ index: number; key: 'protein'|'carbs'|'fat' } | null>(null);
  if (!points.length) return <EmptyChart message="No macro logs in this date range." />;
  const width=920,height=350,pad={left:58,right:20,top:32,bottom:54};
  const max=Math.max(25,...points.flatMap((point)=>[point.protein,point.carbs,point.fat]))*1.15;
  const plotWidth=width-pad.left-pad.right, groupWidth=plotWidth/points.length, barWidth=Math.min(18,Math.max(5,(groupWidth-8)/3));
  const y=(value:number)=>height-pad.bottom-(value/max)*(height-pad.top-pad.bottom);
  const ticks=[0,.25,.5,.75,1].map((ratio)=>Math.round(max*ratio));
  return <div className={styles.chartShell} onMouseLeave={()=>setHovered(null)}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily protein carbohydrates and fat">
    {ticks.map((tick)=><g key={tick}><line x1={pad.left} x2={width-pad.right} y1={y(tick)} y2={y(tick)} className={styles.gridLine}/><text x={pad.left-9} y={y(tick)+4} textAnchor="end" className={styles.axisText}>{tick}g</text></g>)}
    <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height-pad.bottom} className={styles.axisLine}/><line x1={pad.left} x2={width-pad.right} y1={height-pad.bottom} y2={height-pad.bottom} className={styles.axisLine}/>
    {points.map((point,index)=>{const center=pad.left+groupWidth*index+groupWidth/2;return <g key={point.date}>{MACROS.map((macro,macroIndex)=>{const value=point[macro.key],x=center+(macroIndex-1)*(barWidth+2)-barWidth/2;return <rect key={macro.key} x={x} y={y(value)} width={barWidth} height={height-pad.bottom-y(value)} rx="3" fill={macro.color} opacity={hovered&&!(hovered.index===index&&hovered.key===macro.key)?.42:1} onMouseEnter={()=>setHovered({index,key:macro.key})}/>;})}{(points.length<=14||index%Math.ceil(points.length/10)===0)?<text x={center} y={height-30} textAnchor="middle" className={styles.axisText}>{shortDate(point.date)}</text>:null}</g>;})}
    <text x="15" y={height/2} textAnchor="middle" transform={`rotate(-90 15 ${height/2})`} className={styles.axisTitle}>Grams</text><text x={width/2} y={height-5} textAnchor="middle" className={styles.axisTitle}>Date</text>
  </svg>{hovered?<div className={styles.chartTooltip} style={{left:`${((pad.left+groupWidth*hovered.index+groupWidth/2)/width)*100}%`,top:`${(y(points[hovered.index][hovered.key])/height)*100}%`}}><b>{Math.round(points[hovered.index][hovered.key])}g {MACROS.find((macro)=>macro.key===hovered.key)?.label}</b><span>{shortDate(points[hovered.index].date)}</span></div>:null}</div>;
}

export default function NutritionDashboard({ initialRows, initialStartDate, initialEndDate }: { initialRows: NutritionAdherenceRow[]; initialStartDate: string; initialEndDate: string }) {
  const [tab,setTab]=useState<ViewTab>('roster');
  const [playerId,setPlayerId]=useState(initialRows[0]?.playerId??0);
  const [logs,setLogs]=useState<NutritionLogRow[]>([]);
  const [target,setTarget]=useState<NutritionTargetRow|null>(null);
  const [loading,setLoading]=useState(Boolean(initialRows[0]?.playerId));
  const [error,setError]=useState('');
  const player=initialRows.find((row)=>row.playerId===playerId)??initialRows[0];
  useEffect(()=>{
    if(!playerId)return;
    const controller=new AbortController();
    Promise.all([
      fetch(`/api/player/nutrition/logs?playerId=${playerId}&startDate=${initialStartDate}&endDate=${initialEndDate}`,{cache:'no-store',signal:controller.signal}),
      fetch(`/api/player/nutrition/target?playerId=${playerId}`,{cache:'no-store',signal:controller.signal}),
    ]).then(async([logsResponse,targetResponse])=>{
      const logsPayload=await logsResponse.json().catch(()=>({})) as {logs?:NutritionLogRow[];error?:string};
      const targetPayload=await targetResponse.json().catch(()=>({})) as {target?:NutritionTargetRow|null;error?:string};
      if(!logsResponse.ok)throw new Error(logsPayload.error||'Could not load nutrition logs.');
      if(!targetResponse.ok)throw new Error(targetPayload.error||'Could not load nutrition targets.');
      setLogs(logsPayload.logs??[]);setTarget(targetPayload.target??null);
    }).catch((reason)=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Could not load nutrition data.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[initialEndDate,initialStartDate,playerId]);

  const daily=useMemo(()=>{
    const byDate=new Map<string,DailyNutrition>();
    for(const log of logs){const current=byDate.get(log.logDate)??{date:log.logDate,calories:0,protein:0,carbs:0,fat:0};current.calories+=log.calories??0;current.protein+=log.proteinG??0;current.carbs+=log.carbsG??0;current.fat+=log.fatG??0;byDate.set(log.logDate,current);}
    return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  },[logs]);
  const averages=useMemo(()=>{if(!daily.length)return {calories:null,protein:null,carbs:null,fat:null};const sum=(key:keyof Omit<DailyNutrition,'date'>)=>daily.reduce((total,row)=>total+row[key],0)/daily.length;return {calories:sum('calories'),protein:sum('protein'),carbs:sum('carbs'),fat:sum('fat')};},[daily]);
  const macroCalories=[(averages.protein??0)*4,(averages.carbs??0)*4,(averages.fat??0)*9];
  const macroTotal=macroCalories.reduce((sum,value)=>sum+value,0);
  const donut=macroTotal?`conic-gradient(${MACROS[0].color} 0 ${(macroCalories[0]/macroTotal)*100}%,${MACROS[1].color} ${(macroCalories[0]/macroTotal)*100}% ${((macroCalories[0]+macroCalories[1])/macroTotal)*100}%,${MACROS[2].color} ${((macroCalories[0]+macroCalories[1])/macroTotal)*100}% 100%)`:'rgba(255,255,255,.08)';
  const selectPlayer=(id:number)=>{setLoading(true);setError('');setPlayerId(id);};
  const openPlayer=(id:number)=>{selectPlayer(id);setTab('calories');};

  return <main className={styles.workspace}>
    <header className={styles.hero}><div><p>PERFORMANCE NUTRITION</p><h1>Nutrition Command Center</h1><span>See who is logging, how intake tracks against targets, and what each athlete&apos;s fuel profile looks like over time.</span></div><aside><b>{initialRows.length}</b><span>Active Athletes</span><b>{initialRows.reduce((sum,row)=>sum+row.daysLogged,0)}</b><span>Days Logged</span></aside></header>
    <nav className={styles.tabs} aria-label="Nutrition dashboard views">{([['roster','Roster Overview'],['calories','Calorie Trends'],['macros','Macro Breakdown']] as const).map(([key,label])=><button type="button" key={key} className={tab===key?styles.activeTab:''} onClick={()=>setTab(key)}>{label}</button>)}</nav>
    <section className={styles.controlDeck}>
      {tab!=='roster'?<PlayerSelect rows={initialRows} value={playerId} onChange={selectPlayer}/>:<div><small>ROSTER SCOPE</small><b>{initialRows.length} active athletes</b></div>}
      <form action="/portal/admin/nutrition" className={styles.dateControls}><label><span>From</span><input type="date" name="startDate" defaultValue={initialStartDate}/></label><label><span>Through</span><input type="date" name="endDate" defaultValue={initialEndDate}/></label><button type="submit">Apply Range</button></form>
    </section>
    {tab==='roster'?<section className={styles.rosterPanel}><header><div><p>TEAM ACCOUNTABILITY</p><h2>Roster Nutrition</h2></div><span>{initialStartDate} — {initialEndDate}</span></header><div className={styles.rosterTable}><table><thead><tr><th>Athlete</th><th>Logging Consistency</th><th>Average Calories</th><th>Daily Target</th><th/></tr></thead><tbody>{initialRows.map((row)=>{const rate=row.daysInRange?row.daysLogged/row.daysInRange:0;const targetDelta=row.avgCalories!=null&&row.targetCalories?((row.avgCalories-row.targetCalories)/row.targetCalories)*100:null;return <tr key={row.playerId}><td><b>{row.playerName}</b></td><td><div className={styles.adherence}><span><i style={{width:`${Math.min(100,rate*100)}%`}}/></span><small>{row.daysLogged} of {row.daysInRange} days</small></div></td><td><strong>{whole(row.avgCalories)}</strong><small>cal / logged day</small></td><td><strong>{whole(row.targetCalories)}</strong>{targetDelta!=null?<small className={Math.abs(targetDelta)<=10?styles.onTarget:styles.offTarget}>{targetDelta>0?'+':''}{targetDelta.toFixed(0)}% avg</small>:<small>No target set</small>}</td><td><button type="button" onClick={()=>openPlayer(row.playerId)}>View Trends →</button></td></tr>;})}</tbody></table>{!initialRows.length?<EmptyChart message="No active athletes found."/>:null}</div></section>:null}
    {tab!=='roster'?<>{error?<div className={styles.error}>{error}</div>:null}{loading?<div className={styles.loading}><span/>Loading {player?.playerName}&apos;s nutrition data…</div>:tab==='calories'?<section className={styles.analyticsPanel}><header><div><p>DAILY ENERGY INTAKE</p><h2>{player?.playerName}</h2><span>{daily.length} logged days · {initialStartDate} to {initialEndDate}</span></div><div className={styles.kpis}><article><small>Daily Average</small><b>{whole(averages.calories)}</b><span>calories</span></article><article><small>Daily Target</small><b>{whole(target?.calories)}</b><span>calories</span></article><article><small>Target Difference</small><b>{averages.calories!=null&&target?.calories?`${averages.calories-target.calories>0?'+':''}${Math.round(averages.calories-target.calories)}`:'—'}</b><span>calories / day</span></article></div></header><CalorieChart points={daily} target={target?.calories??null}/></section>:<section className={styles.analyticsPanel}><header><div><p>MACRONUTRIENT PROFILE</p><h2>{player?.playerName}</h2><span>Daily averages and logged intake by date</span></div><div className={styles.macroSummary}><div className={styles.donut} style={{background:donut}}><span><b>{whole(averages.calories)}</b><small>avg cal</small></span></div>{MACROS.map((macro,index)=>{const value=averages[macro.key];const targetValue=target?.[`${macro.key}G` as 'proteinG'|'carbsG'|'fatG'];return <article key={macro.key}><i style={{background:macro.color}}/><span><small>{macro.label}</small><b>{whole(value)}g</b><em>{targetValue?`${whole(targetValue)}g target`:macroTotal?`${Math.round((macroCalories[index]/macroTotal)*100)}% of macro calories`:'No target'}</em></span></article>;})}</div></header><MacroChart points={daily}/></section>}</>:null}
  </main>;
}
