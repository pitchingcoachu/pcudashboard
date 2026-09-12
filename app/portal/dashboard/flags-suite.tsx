'use client';

import { useEffect,useMemo,useRef,useState } from 'react';
import { canonicalFlagMetric, dashboardMetricLabel, dashboardMetricOptions } from '../../../lib/dashboard-metric-catalog';
import { formatTableDisplayValue } from '../../../lib/table-sort';

type Rule={id:number;name:string;domain:'pitching'|'hitting';metric:string;pitchType?:string;pitchTypes:string[];direction:'increase'|'decrease'|'either';threshold:number;thresholdType:'absolute'|'percent';baselineDays:number;minimumSample:number;targetPlayer:string;sessionType:string;notificationsEnabled:boolean;cooldownHours:number;enabled:boolean};
type Result={ruleId:number;ruleName:string;domain:string;player:string;sessionDate:string;metric:string;pitchType:string;sessionAverage:number;baselineAverage:number|null;change:number|null;changePercent:number|null;sample:number;triggered:boolean};
type FilterOptions={players:string[];pitchTypes:string[];sessionTypes:string[]};
type MetricOptions=Record<'pitching'|'hitting',string[]>;
type MetricSort={ruleId:number;direction:'asc'|'desc'}|null;
const EMPTY:Omit<Rule,'id'>={name:'',domain:'pitching',metric:'Velo',pitchTypes:['All'],direction:'increase',threshold:2,thresholdType:'absolute',baselineDays:30,minimumSample:5,targetPlayer:'All',sessionType:'All',notificationsEnabled:false,cooldownHours:24,enabled:true};
const EMPTY_OPTIONS:FilterOptions={players:[],pitchTypes:[],sessionTypes:[]};
const PITCH_TYPE_ORDER=['Fastball','Sinker','Cutter','Slider','Sweeper','Curveball','ChangeUp','Splitter','Knuckleball'];
const label=dashboardMetricLabel;
const directionLabel=(value:Rule['direction'])=>value==='decrease'?'lower is better':'higher is better';
const unique=(values:unknown[]):string[]=>Array.from(new Set(values.map((value)=>String(value??'').trim()).filter((value)=>value&&value.toLowerCase()!=='all'))).sort((a,b)=>a.localeCompare(b));
const toFirstLast=(value:unknown):string=>{const raw=String(value??'').replace(/\s+/g,' ').trim();if(!raw.includes(','))return raw;const [last,...rest]=raw.split(',').map((part)=>part.trim()).filter(Boolean);return rest.length&&last?`${rest.join(' ')} ${last}`.trim():raw;};
const personKey=(value:unknown):string=>toFirstLast(value).toLowerCase().replace(/[^a-z0-9]+/g,'');
const uniquePlayers=(values:unknown[]):string[]=>Array.from(values.reduce<Map<string,string>>((names,value)=>{const display=toFirstLast(value);const key=display.toLowerCase().replace(/[^a-z0-9]+/g,'');if(key&&display.toLowerCase()!=='all'&&!names.has(key))names.set(key,display);return names;},new Map()).values()).sort((a,b)=>a.localeCompare(b));
const orderedPitchTypes=(values:unknown[]):string[]=>unique(values).sort((a,b)=>{const rank=(value:string)=>{const index=PITCH_TYPE_ORDER.findIndex((pitchType)=>pitchType.toLowerCase()===value.toLowerCase());return index<0?PITCH_TYPE_ORDER.length:index;};return rank(a)-rank(b)||a.localeCompare(b);});
const withCurrent=(values:string[],current:string):string[]=>current&&current!=='All'&&!values.includes(current)?[current,...values]:values;
const withCurrentMulti=(values:string[],current:string[]):string[]=>orderedPitchTypes([...values,...current.filter((value)=>value!=='All')]);

function optionsFromPayload(payload:Record<string,unknown>,domain:'pitching'|'hitting'):FilterOptions{
  const playerKey=domain==='pitching'?'pitchers':'hitters';
  return {players:uniquePlayers(Array.isArray(payload[playerKey])?payload[playerKey] as unknown[]:[]),pitchTypes:orderedPitchTypes(Array.isArray(payload.pitch_types)?payload.pitch_types:[]),sessionTypes:unique(Array.isArray(payload.session_types)?payload.session_types:[])};
}

function PitchTypeMultiSelect({options,values,onChange,disabled}:{options:string[];values:string[];onChange:(next:string[])=>void;disabled:boolean}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState('');
  const rootRef=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{const close=(event:MouseEvent)=>{if(rootRef.current&&!rootRef.current.contains(event.target as Node))setOpen(false);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[]);
  const selected=values.length?values:['All'];
  const triggerText=selected.includes('All')?'All':selected.length===1?selected[0]:`${selected.length} selected`;
  const filtered=['All',...options].filter((value)=>value.toLowerCase().includes(query.toLowerCase()));
  const toggle=(value:string)=>{if(value==='All'){onChange(['All']);return;}const current=selected.filter((entry)=>entry!=='All');const next=current.includes(value)?current.filter((entry)=>entry!==value):[...current,value];onChange(next.length?orderedPitchTypes(next):['All']);};
  return <div className="portal-search-select" ref={rootRef}><button type="button" className="portal-search-select-trigger" disabled={disabled} aria-expanded={open} onClick={()=>setOpen((current)=>!current)}>{disabled?'Loading…':triggerText}</button>{open?<div className="portal-search-select-menu"><input className="portal-search-select-input" placeholder="Type to filter..." value={query} onChange={(event)=>setQuery(event.target.value)} autoFocus/><div className="portal-search-select-options">{filtered.map((value)=>{const checked=selected.includes(value);return <button key={value} type="button" className="portal-search-select-option portal-search-select-option-multi" role="checkbox" aria-checked={checked} onClick={()=>toggle(value)}><span aria-hidden="true">{checked?'✓':''}</span><span>{value}</span></button>;})}</div></div>:null}</div>;
}

const formatMetricValue=(value:number,metric:string)=>formatTableDisplayValue(canonicalFlagMetric(metric),value);
const formatMetricChange=(value:number,metric:string)=>{
  const formatted=formatMetricValue(Math.abs(value),metric);
  return `${value>0?'+':value<0?'-':''}${formatted.replace(/^[-+]/,'')}`;
};
const formatSessionDate=(value:string)=>new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});

function FlagMetricCell({rule,result}:{rule:Rule;result?:Result}){
  if(!result)return <span className="flags-simple-empty">—</span>;
  const comparison=rule.thresholdType==='percent'?result.changePercent:result.change;
  const crossed=comparison!==null&&Math.abs(comparison)>=rule.threshold;
  const isPositive=(result.change??0)>0;
  const favorable=rule.direction==='decrease'?!isPositive:isPositive;
  const tone=!crossed?'neutral':favorable?'positive':'negative';
  return <div className={`flags-simple-value flags-simple-value-${tone}`}>
    <div><strong>{formatMetricValue(result.sessionAverage,rule.metric)}</strong>{result.change===null?null:<span>({result.change>0?'↑':result.change<0?'↓':'→'} {formatMetricChange(result.change,rule.metric)})</span>}</div>
    <small>Baseline {result.baselineAverage===null?'—':formatMetricValue(result.baselineAverage,rule.metric)}</small>
  </div>;
}

export default function FlagsSuite(){
  const [view,setView]=useState<'active'|'rules'>('active'),[rules,setRules]=useState<Rule[]>([]),[results,setResults]=useState<Result[]>([]),[filterOptions,setFilterOptions]=useState<Record<'pitching'|'hitting',FilterOptions>>({pitching:EMPTY_OPTIONS,hitting:EMPTY_OPTIONS}),[metricOptions,setMetricOptions]=useState<MetricOptions>({pitching:dashboardMetricOptions('pitching'),hitting:dashboardMetricOptions('hitting')}),[draft,setDraft]=useState<Omit<Rule,'id'>>(EMPTY),[editing,setEditing]=useState<number|null>(null),[metricSort,setMetricSort]=useState<MetricSort>(null),[loading,setLoading]=useState(true),[loadingOptions,setLoadingOptions]=useState(true),[message,setMessage]=useState('');
  const [draggingRuleId,setDraggingRuleId]=useState<number|null>(null),[savingOrder,setSavingOrder]=useState(false);
  async function loadRules(){const response=await fetch('/api/ai/flags/rules',{cache:'no-store'});const payload=await response.json();if(!response.ok)throw new Error(payload.error);setRules(payload.rules??[]);}
  async function evaluate(){setLoading(true);setMessage('');try{const response=await fetch('/api/ai/flags/evaluate',{cache:'no-store'});const payload=await response.json();if(!response.ok)throw new Error(payload.error);setResults(payload.results??[]);setRules(payload.rules??[]);}catch(error){setMessage(error instanceof Error?error.message:'Could not evaluate flags.');}finally{setLoading(false);}}
  useEffect(()=>{const loadOptions=async()=>{setLoadingOptions(true);try{const [pitchingResponse,hittingResponse,playersResponse,metricsResponse]=await Promise.all([fetch('/api/dashboard/pitching/filters',{cache:'no-store'}),fetch('/api/dashboard/hitting/filters',{cache:'no-store'}),fetch('/api/dashboard/player-plans/players',{cache:'no-store'}),fetch('/api/ai/flags/metrics',{cache:'no-store'})]);const [pitchingPayload,hittingPayload,playersPayload,metricsPayload]=await Promise.all([pitchingResponse.json().catch(()=>({})),hittingResponse.json().catch(()=>({})),playersResponse.json().catch(()=>({})),metricsResponse.json().catch(()=>({}))]) as [Record<string,unknown>,Record<string,unknown>,{players?:Array<{fullName?:string}>},{metrics?:Partial<MetricOptions>}];const organizationPlayers=uniquePlayers((playersPayload.players??[]).map((player)=>player.fullName));const pitching=optionsFromPayload(pitchingPayload,'pitching'),hitting=optionsFromPayload(hittingPayload,'hitting');setFilterOptions({pitching:{...pitching,players:organizationPlayers},hitting:{...hitting,players:organizationPlayers}});setMetricOptions({pitching:metricsPayload.metrics?.pitching?.length?metricsPayload.metrics.pitching:dashboardMetricOptions('pitching'),hitting:metricsPayload.metrics?.hitting?.length?metricsPayload.metrics.hitting:dashboardMetricOptions('hitting')});if(!playersResponse.ok)setMessage('Could not load organization player options.');else if(!pitchingResponse.ok&&!hittingResponse.ok)setMessage('Could not load dashboard filter options.');}catch(error){setMessage(error instanceof Error?error.message:'Could not load dashboard filter options.');}finally{setLoadingOptions(false);}};void evaluate();void loadOptions();},[]);
  async function save(){setMessage('');try{const response=await fetch('/api/ai/flags/rules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,id:editing})});const payload=await response.json().catch(()=>({})) as {id?:number;error?:string};if(!response.ok)throw new Error(payload.error||'Could not save rule.');setDraft(EMPTY);setEditing(null);await loadRules();setMessage('Flag rule saved.');}catch(error){setMessage(error instanceof Error?error.message:'Could not save rule.');}}
  async function remove(id:number){if(!confirm('Delete this flag rule?'))return;await fetch(`/api/ai/flags/rules?id=${id}`,{method:'DELETE'});await loadRules();}
  async function persistRuleOrder(nextRules:Rule[]){
    if(nextRules.every((rule,index)=>rule.id===rules[index]?.id))return;
    const previous=rules;
    setRules(nextRules);
    setSavingOrder(true);
    setMessage('');
    try{
      const response=await fetch('/api/ai/flags/rules',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ruleIds:nextRules.map((rule)=>rule.id)})});
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw new Error(payload.error||'Could not save rule order.');
    }catch(error){setRules(previous);setMessage(error instanceof Error?error.message:'Could not save rule order.');}
    finally{setSavingOrder(false);setDraggingRuleId(null);}
  }
  function moveRule(ruleId:number,targetIndex:number){
    if(savingOrder)return;
    const fromIndex=rules.findIndex((rule)=>rule.id===ruleId);
    if(fromIndex<0||targetIndex<0||targetIndex>=rules.length||fromIndex===targetIndex)return;
    const next=[...rules];
    const [moved]=next.splice(fromIndex,1);
    next.splice(targetIndex,0,moved);
    void persistRuleOrder(next);
  }
  function edit(rule:Rule){const {id,...rest}=rule;const pitchTypes=rest.pitchTypes?.length?rest.pitchTypes:[rest.pitchType??'All'];setEditing(id);setDraft({...rest,metric:canonicalFlagMetric(rest.metric),pitchTypes,direction:rest.direction==='either'?'increase':rest.direction,targetPlayer:toFirstLast(rest.targetPlayer)});setView('rules');}
  const options=filterOptions[draft.domain],pitchTypes=withCurrentMulti(options.pitchTypes,draft.pitchTypes),players=withCurrent(options.players,draft.targetPlayer),sessionTypes=withCurrent(options.sessionTypes,draft.sessionType),metricChoices=withCurrent(metricOptions[draft.domain],canonicalFlagMetric(draft.metric));
  const activeRules=useMemo(()=>rules.filter((rule)=>rule.enabled),[rules]);
  const activePlayers=useMemo(()=>uniquePlayers(results.map((result)=>result.player)),[results]);
  const resultMap=useMemo(()=>new Map(results.map((result)=>[`${result.ruleId}:${personKey(result.player)}`,result])),[results]);
  const latestDateByPlayer=useMemo(()=>{const dates=new Map<string,string>();for(const result of results){const key=personKey(result.player),current=dates.get(key)??'';if(result.sessionDate>current)dates.set(key,result.sessionDate);}return dates;},[results]);
  const sortedPlayers=useMemo(()=>{
    if(!metricSort)return activePlayers;
    const rule=activeRules.find((entry)=>entry.id===metricSort.ruleId);
    if(!rule)return activePlayers;
    const score=(player:string)=>{const result=resultMap.get(`${rule.id}:${personKey(player)}`);if(!result)return null;return rule.thresholdType==='percent'?result.changePercent:result.change;};
    return activePlayers.toSorted((a,b)=>{const aScore=score(a),bScore=score(b);if(aScore===null)return bScore===null?a.localeCompare(b):1;if(bScore===null)return -1;const difference=metricSort.direction==='desc'?bScore-aScore:aScore-bScore;return difference||a.localeCompare(b);});
  },[activePlayers,activeRules,metricSort,resultMap]);
  const cycleMetricSort=(ruleId:number)=>setMetricSort((current)=>({ruleId,direction:current?.ruleId===ruleId&&current.direction==='desc'?'asc':'desc'}));
  const cellText=(rule:Rule,result?:Result):string=>{
    if(!result)return '—';
    const current=formatMetricValue(result.sessionAverage,rule.metric);
    const baseline=result.baselineAverage===null?'—':formatMetricValue(result.baselineAverage,rule.metric);
    const change=result.change===null?'':` (${result.change>0?'+':result.change<0?'-':''}${formatMetricChange(result.change,rule.metric).replace(/^[-+]/,'')})`;
    return `${current}${change} / baseline ${baseline}`;
  };
  const exportRows=()=>[
    ['Player','Last session',...activeRules.map((rule)=>rule.name)],
    ...sortedPlayers.map((player)=>[player,formatSessionDate(latestDateByPlayer.get(personKey(player))??''),...activeRules.map((rule)=>cellText(rule,resultMap.get(`${rule.id}:${personKey(player)}`)))]),
  ];
  const exportCsv=()=>{
    const rows=exportRows();
    const csv=rows.map((row)=>row.map((cell)=>{const value=String(cell??'');return /[",\n]/.test(value)?`"${value.replace(/"/g,'""')}"`:value;}).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download=`active-flags-${new Date().toISOString().slice(0,10)}.csv`;link.click();
    URL.revokeObjectURL(url);
  };
  const exportPdf=async()=>{
    const {jsPDF}=await import('jspdf');
    const rows=exportRows();
    const pdf=new jsPDF({orientation:'landscape',unit:'pt',format:'letter'});
    const margin=28;
    const pageWidth=pdf.internal.pageSize.getWidth();
    const pageHeight=pdf.internal.pageSize.getHeight();
    const colCount=rows[0]?.length??0;
    const firstColWidth=110,secondColWidth=90;
    const remaining=Math.max(0,pageWidth-margin*2-firstColWidth-secondColWidth);
    const otherColWidth=colCount>2?remaining/(colCount-2):0;
    const colWidths=[firstColWidth,secondColWidth,...Array(Math.max(0,colCount-2)).fill(otherColWidth)];
    const rowHeight=20;
    let y=margin;
    pdf.setFont('helvetica','bold');
    pdf.setFontSize(14);
    pdf.text('Active Flags',margin,y);
    y+=18;
    pdf.setFontSize(9);
    pdf.setTextColor(110,110,110);
    pdf.text(new Date().toLocaleDateString(),margin,y);
    pdf.setTextColor(0,0,0);
    y+=14;
    const drawHeaderRow=()=>{
      pdf.setFont('helvetica','bold');
      pdf.setFontSize(8);
      let x=margin;
      pdf.setFillColor(230,230,230);
      pdf.rect(margin,y,pageWidth-margin*2,rowHeight,'F');
      rows[0].forEach((cell,index)=>{
        pdf.text(String(cell),x+4,y+rowHeight/2+3,{maxWidth:colWidths[index]-8});
        x+=colWidths[index];
      });
      y+=rowHeight;
    };
    drawHeaderRow();
    pdf.setFont('helvetica','normal');
    for(let rowIndex=1;rowIndex<rows.length;rowIndex++){
      if(y+rowHeight>pageHeight-margin){
        pdf.addPage();
        y=margin;
        drawHeaderRow();
        pdf.setFont('helvetica','normal');
      }
      let x=margin;
      if(rowIndex%2===0){pdf.setFillColor(248,248,248);pdf.rect(margin,y,pageWidth-margin*2,rowHeight,'F');}
      rows[rowIndex].forEach((cell,index)=>{
        pdf.setFontSize(index<2?9:7.5);
        pdf.text(String(cell),x+4,y+rowHeight/2+3,{maxWidth:colWidths[index]-8});
        x+=colWidths[index];
      });
      y+=rowHeight;
    }
    pdf.save(`active-flags-${new Date().toISOString().slice(0,10)}.pdf`);
  };
  return <div style={{display:'grid',gap:14}}><div style={{display:'flex',gap:8}}><button className={view==='active'?'btn btn-primary':'btn btn-ghost'} onClick={()=>setView('active')}>Active Flags</button><button className={view==='rules'?'btn btn-primary':'btn btn-ghost'} onClick={()=>setView('rules')}>Manage Rules</button></div>{message?<p className="auth-error" style={{margin:0}}>{message}</p>:null}
  {view==='active'?<section className="portal-panel" style={{padding:16}}><div className="portal-row-between"><div><h3 style={{margin:0}}>Active Flags</h3><p className="portal-muted-text" style={{margin:'4px 0 0'}}>Players with qualifying data inside each rule’s baseline date range. Select a metric heading to sort its changes.</p></div><div style={{display:'flex',gap:8}}><button className="btn btn-ghost" onClick={exportCsv} disabled={loading||activeRules.length===0||sortedPlayers.length===0}>Export CSV</button><button className="btn btn-ghost" onClick={()=>void exportPdf()} disabled={loading||activeRules.length===0||sortedPlayers.length===0}>Export PDF</button><button className="btn btn-ghost" onClick={()=>void evaluate()} disabled={loading}>{loading?'Updating…':'Refresh'}</button></div></div>{activeRules.length===0?<p className="portal-muted-text">Create or enable a rule in Manage Rules to add a metric column.</p>:activePlayers.length===0&&!loading?<p className="portal-muted-text">No players have qualifying data within the enabled rules’ baseline date ranges.</p>:<div className={`portal-table-wrap flags-simple-wrap${loading?' flags-simple-loading':''}`}><table className="portal-table flags-simple-table"><thead><tr><th>Player</th><th>Last session</th>{activeRules.map((rule)=>{const selected=metricSort?.ruleId===rule.id;return <th key={rule.id} className={selected?'flags-simple-column-sorted':undefined} aria-sort={selected?(metricSort.direction==='asc'?'ascending':'descending'):'none'}><button type="button" className="flags-simple-sort" title={`${label(rule.metric)} · ${(rule.pitchTypes?.length?rule.pitchTypes:[rule.pitchType??'All']).join(', ')} · ${rule.baselineDays}-day baseline. Click to sort.`} aria-label={`Sort ${rule.name} ${selected&&metricSort.direction==='desc'?'ascending':'descending'}`} onClick={()=>cycleMetricSort(rule.id)}><span>{rule.name}</span>{selected?<small>{metricSort.direction==='desc'?'↑':'↓'}</small>:null}</button></th>;})}</tr></thead><tbody>{sortedPlayers.map((player)=><tr key={personKey(player)}><td><strong>{player}</strong></td><td>{formatSessionDate(latestDateByPlayer.get(personKey(player))??'')}</td>{activeRules.map((rule)=><td key={rule.id}><FlagMetricCell rule={rule} result={resultMap.get(`${rule.id}:${personKey(player)}`)}/></td>)}</tr>)}</tbody></table></div>}</section>:
  <div className="flags-rules-layout" style={{display:'grid',gridTemplateColumns:'minmax(300px,0.8fr) minmax(360px,1.2fr)',gap:14}}><section className="portal-panel" style={{padding:16,display:'grid',gap:10}}><h3 style={{margin:0}}>{editing?'Edit Rule':'New Rule'}</h3><label>Rule name<input value={draft.name} onChange={(event)=>setDraft({...draft,name:event.target.value})} placeholder="Fastball velocity" /></label><div className="portal-form-grid"><label>Category<select value={draft.domain} onChange={(event)=>{const domain=event.target.value as Rule['domain'];setDraft({...draft,domain,metric:domain==='pitching'?'Velo':'EV',pitchTypes:['All'],targetPlayer:'All',sessionType:'All'});}}><option value="pitching">Pitching</option><option value="hitting">Hitting</option></select></label><label>Metric<select value={draft.metric} disabled={loadingOptions} onChange={(event)=>setDraft({...draft,metric:event.target.value})}>{metricChoices.map((metric)=><option key={metric} value={metric}>{label(metric)}</option>)}</select></label><label>Pitch type<PitchTypeMultiSelect options={pitchTypes} values={draft.pitchTypes} disabled={loadingOptions} onChange={(next)=>setDraft({...draft,pitchTypes:next})}/></label><label>Player<select value={draft.targetPlayer} disabled={loadingOptions} onChange={(event)=>setDraft({...draft,targetPlayer:event.target.value})}><option value="All">All</option>{players.map((value)=><option key={value} value={value}>{value}</option>)}</select></label><label>Desired direction<select value={draft.direction==='either'?'increase':draft.direction} onChange={(event)=>setDraft({...draft,direction:event.target.value as Rule['direction']})}><option value="increase">Higher is better</option><option value="decrease">Lower is better</option></select></label><label>Threshold type<select value={draft.thresholdType} onChange={(event)=>setDraft({...draft,thresholdType:event.target.value as Rule['thresholdType']})}><option value="absolute">Metric units</option><option value="percent">Percent</option></select></label><label>Color threshold<input type="number" min="0.01" step="0.1" value={draft.threshold} onChange={(event)=>setDraft({...draft,threshold:Number(event.target.value)})}/></label><label>Baseline days<input type="number" min="7" max="365" value={draft.baselineDays} onChange={(event)=>setDraft({...draft,baselineDays:Number(event.target.value)})}/></label><label>Minimum pitches/events<input type="number" min="1" value={draft.minimumSample} onChange={(event)=>setDraft({...draft,minimumSample:Number(event.target.value)})}/></label><label>Session type<select value={draft.sessionType} disabled={loadingOptions} onChange={(event)=>setDraft({...draft,sessionType:event.target.value})}><option value="All">All</option>{sessionTypes.map((value)=><option key={value} value={value}>{value}</option>)}</select></label><label>Cooldown hours<input type="number" min="1" value={draft.cooldownHours} onChange={(event)=>setDraft({...draft,cooldownHours:Number(event.target.value)})}/></label></div><label><input type="checkbox" checked={draft.notificationsEnabled} onChange={(event)=>setDraft({...draft,notificationsEnabled:event.target.checked})}/> Notify when change exceeds the color threshold</label><label><input type="checkbox" checked={draft.enabled} onChange={(event)=>setDraft({...draft,enabled:event.target.checked})}/> Show metric on Active Flags</label><div style={{display:'flex',gap:8}}><button className="btn btn-primary" onClick={()=>void save()}>{editing?'Save changes':'Create rule'}</button>{editing?<button className="btn btn-ghost" onClick={()=>{setEditing(null);setDraft(EMPTY);}}>Cancel</button>:null}</div></section>
  <section className="portal-panel" style={{padding:16}}><div className="portal-row-between"><div><h3 style={{margin:0}}>Rules</h3><p className="portal-muted-text flags-rule-order-hint">Drag rules to set the Active Flags column order.</p></div>{savingOrder?<span className="portal-muted-text">Saving order…</span>:null}</div>{rules.length===0?<p className="portal-muted-text">No rules yet.</p>:<div className="flags-rule-list">{rules.map((rule,index)=><div key={rule.id} className={`portal-row-between flags-rule-item${draggingRuleId===rule.id?' is-dragging':''}`} onDragOver={(event)=>{if(draggingRuleId!==null&&draggingRuleId!==rule.id)event.preventDefault();}} onDrop={(event)=>{event.preventDefault();if(draggingRuleId!==null)moveRule(draggingRuleId,index);}}><div className="flags-rule-item-main"><span className="flags-rule-drag-handle" draggable={!savingOrder} role="button" tabIndex={0} aria-label={`Reorder ${rule.name}. Use up and down arrow keys or drag.`} title="Drag to reorder" onDragStart={(event)=>{setDraggingRuleId(rule.id);event.dataTransfer.effectAllowed='move';}} onDragEnd={()=>setDraggingRuleId(null)} onKeyDown={(event)=>{if(event.key==='ArrowUp'){event.preventDefault();moveRule(rule.id,index-1);}else if(event.key==='ArrowDown'){event.preventDefault();moveRule(rule.id,index+1);}}}>⠿</span><div><strong>{rule.name}</strong><div className="portal-muted-text">{rule.domain} · {label(rule.metric)}{(rule.pitchTypes?.length?rule.pitchTypes:[rule.pitchType??'All']).includes('All')?'':` · ${(rule.pitchTypes?.length?rule.pitchTypes:[rule.pitchType]).join(', ')}`} · {directionLabel(rule.direction)} · ±{rule.threshold}{rule.thresholdType==='percent'?'%':''} color threshold · {rule.baselineDays}-day baseline · min {rule.minimumSample}</div></div></div><div style={{display:'flex',gap:6}}><button className="btn btn-ghost" onClick={()=>edit(rule)}>Edit</button><button className="btn btn-danger" onClick={()=>void remove(rule.id)}>Delete</button></div></div>)}</div>}</section></div>}
  </div>;
}
