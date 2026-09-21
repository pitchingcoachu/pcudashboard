'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import ProfilePlanGoalsPanel from '../../player/profile-plan-goals-panel';
import type { BreakdownAnnotation } from '../../components/media-breakdown-viewer';
import { canonicalFlagMetric, parseBiomechanicsFlagMetric, parseForcePlateFlagMetric, parseOvrSprintFlagMetric } from '../../../../lib/dashboard-metric-catalog';
import { formatTableDisplayValue } from '../../../../lib/table-sort';
import styles from './coach-dashboard.module.css';

const MediaBreakdownViewer=dynamic(()=>import('../../components/media-breakdown-viewer'),{ssr:false});
const AthletePerformanceEmbed=dynamic(()=>import('./athlete-performance-embed'),{ssr:false,loading:()=> <div className={styles.performanceLoading}><span/> Preparing performance workspace…</div>});

type PlayerChoice = { playerId:number; fullName:string };
type Goal = { slotIndex:1|2|3; category:string|null; goalDescription:string|null; createdAt:string|null };
type DashboardPlayer = PlayerChoice & { goals:Goal[] };
type PersonalNote = { id:number; category:string; title:string; body:string; pinned:boolean; createdAt:string; updatedAt:string };
type PersonalMedia = { id:number; title:string; category:string; mediaType:'photo'|'video'|'pdf'; fileName:string; contentType:string; sizeBytes:number; breakdownAnnotations:BreakdownAnnotation[]; createdAt:string };
type PlayerNote = { id:number; playerId:number; playerName:string; domain:string; noteDate:string; category:string; noteText:string; pinned:boolean };
type Report = { id:number; playerId:number; playerName:string; title:string; category:string; fileName:string; createdAt:string };
type Trend = { playerId:number; playerName:string; questionnaireName:string; question:string; points:Array<{date:string;value:number}> };
type Workout = { playerId:number; playerName:string; itemId:number; name:string; section:string|null; targetCount:number|null; completedCount:number };
type Overview = {
  availablePlayers:PlayerChoice[]; selectedPlayerIds:number[]; players:DashboardPlayer[]; personalNotes:PersonalNote[];
  personalMedia:PersonalMedia[]; mediaCategories:string[]; playerNotes:PlayerNote[]; reports:Report[]; questionnaireTrends:Trend[]; workouts:Workout[];
};
type FlagRule = { id:number; name:string; domain:'pitching'|'hitting'|'force_plates'|'ovr_sprint'|'biomechanics'; metric:string; direction:'increase'|'decrease'|'either'; threshold:number; thresholdType:'absolute'|'percent'; baselineDays:number; enabled:boolean };
type FlagResult = { ruleId:number; ruleName:string; domain:string; player:string; sessionDate:string; metric:string; sessionAverage:number; baselineAverage:number|null; change:number|null; changePercent:number|null; sample:number; triggered:boolean };

const EMPTY:Overview = { availablePlayers:[],selectedPlayerIds:[],players:[],personalNotes:[],personalMedia:[],mediaCategories:[],playerNotes:[],reports:[],questionnaireTrends:[],workouts:[] };
const DEFAULT_MEDIA_CATEGORIES=['General','Ideas','Education','Drills','Documents'];
const DEFAULT_PLAYER_NOTE_CATEGORIES=['Player Plan','Weight Room','Nutrition','Mental Training','Grips'];

function todayIsoDate():string {
  const now=new Date();
  return new Date(now.getTime()-now.getTimezoneOffset()*60_000).toISOString().slice(0,10);
}

function formatDate(value:string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}

function meaningfulNoteLabel(value:string):boolean {
  return Boolean(value.trim())&&value.trim().toLowerCase()!=='general';
}

function inferMediaContentType(file:File):string {
  if(file.type.trim())return file.type.trim().toLowerCase();
  const extension=file.name.split('.').pop()?.toLowerCase()??'';
  const types:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',heic:'image/heic',heif:'image/heif',avif:'image/avif',mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',qt:'video/quicktime',webm:'video/webm',avi:'video/x-msvideo',mkv:'video/x-matroska',pdf:'application/pdf'};
  return types[extension]??'application/octet-stream';
}

function goalText(goal:Goal):string {
  const raw=String(goal.goalDescription??'').trim();
  if(!raw)return '';
  try{const parsed=JSON.parse(raw) as {schema?:string;objectiveText?:string;executionStat?:string;targetValue?:number|string;comparator?:string};if(parsed.schema==='pcu_goal_v2'){const objective=String(parsed.objectiveText??'').trim();const target=parsed.targetValue!==undefined&&parsed.targetValue!==null&&String(parsed.targetValue)!==''?`${parsed.comparator==='Less Than'?'≤':'≥'} ${parsed.targetValue}`:'';return [objective,target].filter(Boolean).join(' · ')||String(parsed.executionStat??'Goal');}}catch{}
  return raw;
}

const personKey=(value:unknown):string=>String(value??'').replace(/\s+/g,' ').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
const formatFlagDate=(value:string)=>value?new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'—';
const formatFlagValue=(value:number,metric:string)=>{
  if(parseForcePlateFlagMetric(metric))return value.toFixed(1);
  const sprint=parseOvrSprintFlagMetric(metric);
  if(sprint)return sprint.metric==='speedMph'?`${value.toFixed(2)} mph`:`${value.toFixed(3)} s`;
  if(parseBiomechanicsFlagMetric(metric))return value.toFixed(1);
  return formatTableDisplayValue(canonicalFlagMetric(metric),value);
};
const formatFlagChange=(value:number,metric:string)=>`${value>0?'+':value<0?'-':''}${formatFlagValue(Math.abs(value),metric).replace(/^[-+]/,'')}`;

function DashboardFlagMetricCell({ rule,result }: { rule:FlagRule; result?:FlagResult }) {
  if(!result)return <span className="flags-simple-empty">—</span>;
  const tone=dashboardFlagTone(rule,result);
  return <div className={`flags-simple-value flags-simple-value-${tone}`}><div><strong>{formatFlagValue(result.sessionAverage,rule.metric)}</strong>{result.change===null?null:<span>({result.change>0?'↑':result.change<0?'↓':'→'} {formatFlagChange(result.change,rule.metric)})</span>}</div><small>Baseline {result.baselineAverage===null?'—':formatFlagValue(result.baselineAverage,rule.metric)}</small></div>;
}

function dashboardFlagTone(rule:FlagRule,result?:FlagResult):'positive'|'negative'|'neutral' {
  if(!result||result.change===null||result.change===0)return 'neutral';
  const comparison=rule.thresholdType==='percent'?result.changePercent:result.change;
  if(comparison===null||Math.abs(comparison)<rule.threshold)return 'neutral';
  const isPositive=result.change>0;
  const favorable=rule.direction==='decrease'?!isPositive:isPositive;
  return favorable?'positive':'negative';
}

function Sparkline({ points }: { points:Trend['points'] }) {
  const gradientId=useId().replace(/:/g,'');
  const [hovered,setHovered]=useState<(Trend['points'][number]&{x:number;y:number})|null>(null);
  const width=320,height=142,pad={left:42,right:12,top:12,bottom:30};
  const values=points.map((p)=>p.value), min=Math.min(...values), max=Math.max(...values), span=max-min||1;
  const coords=points.map((point,index)=>({ x:pad.left+(index/Math.max(1,points.length-1))*(width-pad.left-pad.right), y:height-pad.bottom-((point.value-min)/span)*(height-pad.top-pad.bottom), ...point }));
  const line=coords.map((point,index)=>`${index?'L':'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area=`${line} L${coords.at(-1)?.x ?? pad.left},${height-pad.bottom} L${coords[0]?.x ?? pad.left},${height-pad.bottom} Z`;
  const yTicks=[max,min+span/2,min];
  const shortDate=(value:string)=>formatDate(value).replace(/, \d{4}$/,'');
  return <div className={styles.chartWrap} onMouseLeave={()=>setHovered(null)}>
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.spark} role="img" aria-label="Questionnaire response trend">
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".35"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
      {yTicks.map((tick,index)=>{const y=pad.top+(index/2)*(height-pad.top-pad.bottom);return <g key={`${tick}-${index}`}><line x1={pad.left} y1={y} x2={width-pad.right} y2={y} className={styles.gridLine}/><text x={pad.left-6} y={y+3} textAnchor="end" className={styles.axisTick}>{Number(tick.toFixed(1))}</text></g>;})}
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height-pad.bottom} className={styles.axisLine}/><line x1={pad.left} y1={height-pad.bottom} x2={width-pad.right} y2={height-pad.bottom} className={styles.axisLine}/>
      <path d={area} fill={`url(#${gradientId})`}/><path d={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>
      {coords.map((point)=><g key={`${point.date}-${point.x}`} onMouseEnter={()=>setHovered(point)} onMouseMove={()=>setHovered(point)}><circle cx={point.x} cy={point.y} r="9" fill="transparent"/><circle cx={point.x} cy={point.y} r={hovered?.date===point.date?4.5:3} fill="currentColor" stroke="rgba(255,255,255,.8)" strokeWidth="1"/></g>)}
      <text x={pad.left} y={height-9} textAnchor="start" className={styles.axisTick}>{shortDate(points[0]?.date??'')}</text><text x={width-pad.right} y={height-9} textAnchor="end" className={styles.axisTick}>{shortDate(points.at(-1)?.date??'')}</text>
      <text x={(pad.left+width-pad.right)/2} y={height-1} textAnchor="middle" className={styles.axisTitle}>Date</text><text x="10" y={(pad.top+height-pad.bottom)/2} textAnchor="middle" transform={`rotate(-90 10 ${(pad.top+height-pad.bottom)/2})`} className={styles.axisTitle}>Value</text>
    </svg>
    {hovered?<div className={styles.chartTooltip} style={{left:`${(hovered.x/width)*100}%`,top:`${(hovered.y/height)*100}%`}}><b>{hovered.value}</b><span>{formatDate(hovered.date)}</span></div>:null}
  </div>;
}

function CollapsibleSection({ eyebrow,title,action,children,id,defaultOpen=false }: { eyebrow:string; title:string; action?:React.ReactNode; children:React.ReactNode; id?:string; defaultOpen?:boolean }) {
  const [open,setOpen]=useState(defaultOpen);
  return <section className={styles.section} id={id}>
    <div className={styles.sectionHeading}>
      <button type="button" className={styles.sectionToggle} onClick={()=>setOpen((current)=>!current)} aria-expanded={open}><span><small>{eyebrow}</small><h2>{title}</h2></span><i aria-hidden="true">⌄</i></button>
      {action?<div className={styles.sectionAction}>{action}</div>:null}
    </div>
    {open?<div className={styles.sectionBody}>{children}</div>:null}
  </section>;
}

function PlayerNotesDisclosure({ player,notes,onSelect,standalone=false }: { player:DashboardPlayer; notes:PlayerNote[]; onSelect:(note:PlayerNote)=>void; standalone?:boolean }) {
  const [query,setQuery]=useState('');
  const normalizedQuery=query.trim().toLowerCase();
  const filteredNotes=normalizedQuery?notes.filter((note)=>[note.noteText,note.category,note.domain,note.noteDate,formatDate(note.noteDate)].some((value)=>String(value).toLowerCase().includes(normalizedQuery))):notes;
  const content=<><div className={styles.noteSearch}><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder={`Search ${player.fullName.split(/\s+/)[0]}'s notes…`} aria-label={`Search ${player.fullName}'s notes`}/>{query?<button type="button" onClick={()=>setQuery('')} aria-label="Clear note search">×</button>:null}</div>
    <div className={styles.playerNotes}>{filteredNotes.map((note)=>{const noteLabels=[meaningfulNoteLabel(note.category)?note.category:'',note.pinned?'Pinned':''].filter(Boolean).join(' · ');return <button type="button" key={note.id} onClick={()=>onSelect(note)}><header>{meaningfulNoteLabel(note.domain)?<b>{note.domain}</b>:<span/>}<time>{formatDate(note.noteDate)}</time></header>{noteLabels?<small>{noteLabels}</small>:null}<p>{note.noteText}</p><footer>View full note <span>→</span></footer></button>;})}{!notes.length?<p className={styles.emptyPlayerState}>No player notes yet.</p>:!filteredNotes.length?<p className={styles.emptyPlayerState}>No notes match “{query}”.</p>:null}</div></>;
  if(standalone)return <div className={styles.focusedNotes}>{content}</div>;
  return <details><summary><b>{player.fullName}</b><aside><span>{notes.length} note{notes.length===1?'':'s'}</span><i>⌄</i></aside></summary>{content}</details>;
}

function DashboardSelect({ label,value,options,onChange,searchable=false }: { label:string; value:string; options:Array<{value:string;label:string}>; onChange:(value:string)=>void; searchable?:boolean }) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState('');
  const rootRef=useRef<HTMLDivElement|null>(null);
  const selected=options.find((option)=>option.value===value)??options[0];
  const visibleOptions=options.filter((option)=>option.label.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(()=>{
    if(!open)return;
    const close=(event:MouseEvent)=>{if(!rootRef.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('mousedown',close);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',escape);};
  },[open]);
  return <div ref={rootRef} className="portal-search-select">
    <button type="button" className="portal-search-select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen((current)=>!current)}>{selected?.label??'Select'}</button>
    {open?<div className="portal-search-select-menu" role="listbox" aria-label={label}>
      {searchable?<input className="portal-search-select-input" autoFocus type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}…`}/>:null}
      <div className="portal-search-select-options">{visibleOptions.map((option)=><button type="button" className="portal-search-select-option" role="option" aria-selected={option.value===value} key={option.value} onClick={()=>{onChange(option.value);setOpen(false);setQuery('');}}>{option.label}{option.value===value?' ✓':''}</button>)}{!visibleOptions.length?<span className="portal-muted-text" style={{padding:8}}>No matches found.</span>:null}</div>
    </div>:null}
  </div>;
}

export default function CoachDashboard({ firstName }: { firstName:string }) {
  const [data,setData]=useState<Overview>(EMPTY),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [playerDraft,setPlayerDraft]=useState<number[]>([]),[playerSearch,setPlayerSearch]=useState(''),[savingPlayers,setSavingPlayers]=useState(false);
  const [noteForm,setNoteForm]=useState({category:'Ideas',title:'',body:'',pinned:false}),[savingNote,setSavingNote]=useState(false),[editingNoteId,setEditingNoteId]=useState<number|null>(null);
  const [flags,setFlags]=useState<FlagResult[]>([]),[flagRules,setFlagRules]=useState<FlagRule[]>([]),[flagsLoading,setFlagsLoading]=useState(true),[uploading,setUploading]=useState(false),[mediaCategory,setMediaCategory]=useState('General'),[uploadStatus,setUploadStatus]=useState('');
  const [addingMediaCategory,setAddingMediaCategory]=useState(false),[mediaCategoryDraft,setMediaCategoryDraft]=useState(''),[savingMediaCategory,setSavingMediaCategory]=useState(false);
  const [selectedNote,setSelectedNote]=useState<PlayerNote|null>(null);
  const [selectedMedia,setSelectedMedia]=useState<PersonalMedia|null>(null);
  const [viewedPlayerId,setViewedPlayerId]=useState<number|null>(null);
  const [playerNoteDraft,setPlayerNoteDraft]=useState({category:'Player Plan',noteDate:todayIsoDate(),noteText:'',playerVisible:false});
  const [savingPlayerNote,setSavingPlayerNote]=useState(false),[playerNoteStatus,setPlayerNoteStatus]=useState('');
  const fileRef=useRef<HTMLInputElement|null>(null);
  const selectedPlayerKey=data.selectedPlayerIds.join(',');

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try { const response=await fetch('/api/admin/my-dashboard',{cache:'no-store'}); const payload=await response.json(); if(!response.ok) throw new Error(payload.error||'Could not load dashboard.'); setData(payload);setPlayerDraft(payload.selectedPlayerIds||[]); }
    catch(err){setError(err instanceof Error?err.message:'Could not load dashboard.');} finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    if(!selectedPlayerKey)return;
    setFlagsLoading(true);
    fetch('/api/ai/flags/evaluate',{cache:'no-store'}).then(async(evaluateResponse)=>{
      const payload=evaluateResponse.ok?await evaluateResponse.json():null;
      const selectedNames=new Set(data.players.map((player)=>personKey(player.fullName)));
      setFlags((Array.isArray(payload?.results)?payload.results:[]).filter((result:FlagResult)=>selectedNames.has(personKey(result.player))));
      setFlagRules(Array.isArray(payload?.rules)?payload.rules:[]);
    }).catch(()=>{}).finally(()=>setFlagsLoading(false));
  },[selectedPlayerKey,data.players]);

  useEffect(()=>{
    if(!data.players.length){setViewedPlayerId(null);return;}
    if(!data.players.some((player)=>player.playerId===viewedPlayerId))setViewedPlayerId(data.players[0].playerId);
  },[data.players,viewedPlayerId]);
  useEffect(()=>{
    setPlayerNoteStatus('');
    setPlayerNoteDraft((current)=>({...current,noteText:'',playerVisible:false}));
  },[viewedPlayerId]);

  const visibleChoices=useMemo(()=>data.availablePlayers.filter((player)=>player.fullName.toLowerCase().includes(playerSearch.toLowerCase().trim())),[data.availablePlayers,playerSearch]);
  const viewedPlayer=useMemo(()=>data.players.find((player)=>player.playerId===viewedPlayerId)??data.players[0]??null,[data.players,viewedPlayerId]);
  const activeFlagRules=useMemo(()=>flagRules.filter((rule)=>rule.enabled),[flagRules]);
  const viewedPlayerFlagResults=useMemo(()=>viewedPlayer?flags.filter((flag)=>personKey(flag.player)===personKey(viewedPlayer.fullName)):[],[flags,viewedPlayer]);
  const viewedPlayerFlags=useMemo(()=>viewedPlayerFlagResults.filter((flag)=>flag.triggered),[viewedPlayerFlagResults]);
  const viewedPlayerFlagMap=useMemo(()=>new Map(viewedPlayerFlagResults.map((result)=>[result.ruleId,result])),[viewedPlayerFlagResults]);
  const viewedPlayerLastFlagSession=useMemo(()=>viewedPlayerFlagResults.reduce((latest,result)=>result.sessionDate>latest?result.sessionDate:latest,''),[viewedPlayerFlagResults]);
  const viewedPlayerWorkouts=useMemo(()=>viewedPlayer?data.workouts.filter((workout)=>workout.playerId===viewedPlayer.playerId):[],[data.workouts,viewedPlayer]);
  const viewedPlayerNotes=useMemo(()=>viewedPlayer?data.playerNotes.filter((note)=>note.playerId===viewedPlayer.playerId).slice(0,60):[],[data.playerNotes,viewedPlayer]);
  const viewedPlayerTrends=useMemo(()=>viewedPlayer?data.questionnaireTrends.filter((trend)=>trend.playerId===viewedPlayer.playerId):[],[data.questionnaireTrends,viewedPlayer]);
  const viewedPlayerReports=useMemo(()=>viewedPlayer?data.reports.filter((report)=>report.playerId===viewedPlayer.playerId):[],[data.reports,viewedPlayer]);
  const playerNoteCategories=useMemo(()=>Array.from(new Set([...DEFAULT_PLAYER_NOTE_CATEGORIES,...viewedPlayerNotes.map((note)=>note.category)].filter((category)=>category&&category!=='Assessment'&&category!=='Questionnaires'))).sort((a,b)=>a.localeCompare(b)),[viewedPlayerNotes]);
  const oneLeft=viewedPlayerWorkouts.filter((workout)=>workout.targetCount!==null&&workout.targetCount-workout.completedCount===1).length;
  const mediaCategories=useMemo(()=>Array.from(new Set([...DEFAULT_MEDIA_CATEGORIES,...(data.mediaCategories??[]),...data.personalMedia.map((media)=>media.category)].map((category)=>category.trim()).filter(Boolean))).sort((a,b)=>a==='General'?-1:b==='General'?1:a.localeCompare(b)),[data.mediaCategories,data.personalMedia]);

  useEffect(()=>{if(!selectedNote)return;const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelectedNote(null);};document.addEventListener('keydown',onKeyDown);return()=>document.removeEventListener('keydown',onKeyDown);},[selectedNote]);

  async function savePlayers(){setSavingPlayers(true);setError('');try{const response=await fetch('/api/admin/my-dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'players',playerIds:playerDraft})});const payload=await response.json();if(!response.ok)throw new Error(payload.error);await load();}catch(err){setError(err instanceof Error?err.message:'Could not save players.');}finally{setSavingPlayers(false);}}
  function resetNoteForm(){setEditingNoteId(null);setNoteForm({category:'Ideas',title:'',body:'',pinned:false});}
  function editNote(note:PersonalNote){setEditingNoteId(note.id);setNoteForm({category:note.category,title:note.title,body:note.body,pinned:note.pinned});}
  async function saveNote(event:React.FormEvent){event.preventDefault();setSavingNote(true);try{const response=await fetch('/api/admin/my-dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'note',id:editingNoteId??undefined,...noteForm,noteBody:noteForm.body})});const payload=await response.json();if(!response.ok)throw new Error(payload.error);resetNoteForm();await load();}catch(err){setError(err instanceof Error?err.message:'Could not save note.');}finally{setSavingNote(false);}}
  async function toggleNotePin(note:PersonalNote){setError('');try{const response=await fetch('/api/admin/my-dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'note',id:note.id,category:note.category,title:note.title,noteBody:note.body,pinned:!note.pinned})});const payload=await response.json();if(!response.ok)throw new Error(payload.error);if(editingNoteId===note.id)setNoteForm((current)=>({...current,pinned:!note.pinned}));await load();}catch(err){setError(err instanceof Error?err.message:'Could not update note.');}}
  async function deleteNote(id:number){if(!window.confirm('Delete this note?'))return;await fetch(`/api/admin/my-dashboard?noteId=${id}`,{method:'DELETE'});await load();}
  async function uploadMedia(file:File|null){
    if(!file)return;
    setUploading(true);setError('');setUploadStatus(`Preparing ${file.name}…`);
    const title=file.name.replace(/\.[^.]+$/,'');
    const contentType=inferMediaContentType(file);
    const uploadThroughServer=async()=>{
      setUploadStatus(`Uploading ${file.name}…`);
      const form=new FormData();form.set('file',file);form.set('title',title);form.set('category',mediaCategory);
      const response=await fetch('/api/admin/my-dashboard/media',{method:'POST',body:form});
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw new Error(payload.error||'Upload failed.');
    };
    try{
      const presignResponse=await fetch('/api/admin/my-dashboard/media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'presign',fileName:file.name,contentType,sizeBytes:file.size})});
      const presign=await presignResponse.json().catch(()=>({})) as {uploadUrl?:string;r2Key?:string;error?:string};
      if(!presignResponse.ok)throw new Error(presign.error||'Could not prepare the upload.');
      if(presign.uploadUrl&&presign.r2Key){
        setUploadStatus(`Uploading ${file.name}…`);
        let putSucceeded=false;
        try{const put=await fetch(presign.uploadUrl,{method:'PUT',headers:{'Content-Type':contentType},body:file});putSucceeded=put.ok;}catch{}
        const isLocal=window.location.hostname==='localhost'||window.location.hostname==='127.0.0.1';
        if(!putSucceeded){if(isLocal)await uploadThroughServer();else throw new Error('The file could not be uploaded to storage.');}
        else{
          setUploadStatus('Saving media…');
          const finalizeResponse=await fetch('/api/admin/my-dashboard/media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'finalize',fileName:file.name,contentType,sizeBytes:file.size,title,category:mediaCategory,r2Key:presign.r2Key})});
          const finalized=await finalizeResponse.json().catch(()=>({})) as {error?:string};
          if(!finalizeResponse.ok)throw new Error(finalized.error||'Could not save the uploaded media.');
        }
      }else await uploadThroughServer();
      await load();setUploadStatus(`${file.name} uploaded.`);
    }catch(err){const message=err instanceof Error?err.message:'Upload failed.';setError(message);setUploadStatus(message);}
    finally{setUploading(false);if(fileRef.current)fileRef.current.value='';}
  }
  async function saveMediaAnnotations(mediaId:number,annotations:BreakdownAnnotation[]){
    const response=await fetch('/api/admin/my-dashboard/media',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:mediaId,breakdownAnnotations:annotations})});
    const payload=await response.json().catch(()=>({})) as {media?:PersonalMedia;error?:string};
    if(!response.ok||!payload.media)throw new Error(payload.error||'Could not save the video breakdown.');
    setData((current)=>({...current,personalMedia:current.personalMedia.map((item)=>item.id===mediaId?payload.media!:item)}));
    setSelectedMedia(payload.media);
    setUploadStatus('Video breakdown saved.');
  }
  async function deleteMedia(media:PersonalMedia){
    if(!window.confirm(`Delete “${media.title}”? This cannot be undone.`))return;
    const response=await fetch(`/api/admin/my-dashboard/media?id=${media.id}`,{method:'DELETE'});
    const payload=await response.json().catch(()=>({})) as {ok?:boolean;error?:string};
    if(!response.ok||!payload.ok)throw new Error(payload.error||'Could not delete media.');
    setSelectedMedia(null);setUploadStatus(`${media.title} deleted.`);await load();
  }
  async function createMediaCategory(event:React.FormEvent){
    event.preventDefault();const name=mediaCategoryDraft.trim();if(!name)return;
    setSavingMediaCategory(true);setError('');
    try{const response=await fetch('/api/admin/my-dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'media_category',name})});const payload=await response.json().catch(()=>({})) as {category?:string;error?:string};if(!response.ok||!payload.category)throw new Error(payload.error||'Could not create category.');setMediaCategory(payload.category);setMediaCategoryDraft('');setAddingMediaCategory(false);await load();}
    catch(err){setError(err instanceof Error?err.message:'Could not create category.');}finally{setSavingMediaCategory(false);}
  }
  async function savePlayerNote(event:React.FormEvent){
    event.preventDefault();
    if(!viewedPlayer||!playerNoteDraft.noteText.trim())return;
    setSavingPlayerNote(true);setPlayerNoteStatus('');setError('');
    try{
      const response=await fetch('/api/player/plan-notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId:viewedPlayer.playerId,domain:'General',noteDate:playerNoteDraft.noteDate,category:playerNoteDraft.category,noteText:playerNoteDraft.noteText.trim(),playerVisible:playerNoteDraft.playerVisible})});
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw new Error(payload.error||'Could not save the player note.');
      setPlayerNoteDraft((current)=>({...current,noteText:'',playerVisible:false}));
      setPlayerNoteStatus('Note saved to the player profile.');
      await load();
    }catch(err){setError(err instanceof Error?err.message:'Could not save the player note.');}
    finally{setSavingPlayerNote(false);}
  }

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><p>PERSONAL PERFORMANCE DESK</p><h1>{firstName}&apos;s Dashboard</h1><span>Your athletes, decisions, ideas, and follow-through—one private command center.</span></div>
      <div className={styles.heroStats}><span><b>{data.players.length}</b> athletes managed</span><span><b>{viewedPlayerFlags.length}</b> active flags</span><span className={oneLeft?styles.alertStat:''}><b>{oneLeft}</b> one workout left</span></div>
    </header>
    {error?<div className={styles.error}>{error}</div>:null}

    <section className={styles.rosterBar}>
      <div className={styles.athleteControlRow}>
        {data.players.length?<div className={styles.standardField}><span>Viewing athlete</span><DashboardSelect label="Athletes" searchable value={String(viewedPlayer?.playerId??'')} onChange={(value)=>setViewedPlayerId(Number(value))} options={data.players.map((player)=>({value:String(player.playerId),label:player.fullName}))}/></div>:null}
        <details className={styles.playerPicker}><summary>Manage athletes</summary><div className={styles.pickerMenu}>
          <input value={playerSearch} onChange={(e)=>setPlayerSearch(e.target.value)} placeholder="Search roster…" />
          <div className={styles.checkList}>{visibleChoices.map((player)=><label key={player.playerId}><input type="checkbox" checked={playerDraft.includes(player.playerId)} onChange={()=>setPlayerDraft((current)=>current.includes(player.playerId)?current.filter((id)=>id!==player.playerId):[...current,player.playerId])}/><span>{player.fullName}</span></label>)}</div>
          <button type="button" onClick={savePlayers} disabled={savingPlayers}>{savingPlayers?'Saving…':'Save athletes'}</button>
        </div></details>
      </div>
    </section>

    {loading?<div className={styles.loading}>Building your dashboard…</div>:!data.players.length?<section className={styles.empty}><b>Start with your athlete group.</b><span>Select the players you personally train. Their goals, flags, notes, questionnaires, workouts, and automated reports will flow into this page.</span></section>:<>
      <CollapsibleSection eyebrow="01 · PRIVATE NOTEBOOK" title="Personal Notes" id="notes">
          <form className={styles.noteForm} onSubmit={saveNote}><div><input value={noteForm.category} onChange={(e)=>setNoteForm({...noteForm,category:e.target.value})} placeholder="Category"/><input value={noteForm.title} onChange={(e)=>setNoteForm({...noteForm,title:e.target.value})} placeholder="Note title" required/></div><textarea value={noteForm.body} onChange={(e)=>setNoteForm({...noteForm,body:e.target.value})} placeholder="Capture an idea, coaching observation, reminder, or plan…" required/><footer><label><input type="checkbox" checked={noteForm.pinned} onChange={(e)=>setNoteForm({...noteForm,pinned:e.target.checked})}/> Pin note</label><div className={styles.noteFormActions}>{editingNoteId?<button type="button" onClick={resetNoteForm}>Cancel</button>:null}<button disabled={savingNote}>{savingNote?'Saving…':editingNoteId?'Update note':'Add note'}</button></div></footer></form>
          <div className={styles.notes}>{data.personalNotes.map((note)=><article key={note.id}><div><small>{note.category}{note.pinned?' · PINNED':''}</small><span className={styles.noteActions}><button type="button" onClick={()=>void toggleNotePin(note)} aria-label={`${note.pinned?'Unpin':'Pin'} ${note.title}`} title={note.pinned?'Unpin note':'Pin note'}>{note.pinned?'★':'☆'}</button><button type="button" onClick={()=>editNote(note)} aria-label={`Edit ${note.title}`} title="Edit note">Edit</button><button type="button" onClick={()=>deleteNote(note.id)} aria-label={`Delete ${note.title}`} title="Delete note">×</button></span></div><h3>{note.title}</h3><p>{note.body}</p><time>{formatDate(note.updatedAt)}</time></article>)}{!data.personalNotes.length?<p className={styles.muted}>Your private notes will stay organized here.</p>:null}</div>
      </CollapsibleSection>

      <CollapsibleSection eyebrow="02 · MEDIA VAULT" title="Media & Reports" id="media">
          <div className={styles.mediaWorkspace}>
            <aside className={styles.mediaControls}>
              <header><small>ADD TO VAULT</small><b>Upload and organize</b><span>Choose a category, then add a photo, video, or PDF.</span></header>
              <div className={styles.mediaToolbar}>
                <div className={styles.standardField}><span>Category</span><DashboardSelect label="Categories" searchable value={mediaCategory} onChange={setMediaCategory} options={mediaCategories.map((category)=>({value:category,label:category}))}/></div>
                <input ref={fileRef} className={styles.mediaFileInput} hidden type="file" accept="image/*,video/*,application/pdf,.mov,.mp4,.m4v,.webm,.avi,.mkv" onChange={(e)=>void uploadMedia(e.target.files?.[0]??null)}/>
                <button type="button" className={`btn ${styles.mediaAction} ${styles.mediaPrimary}`} disabled={uploading} onClick={()=>fileRef.current?.click()}>{uploading?'Uploading…':'Upload media'}</button>
                <button type="button" className={`btn ${styles.mediaAction} ${styles.mediaSecondary}`} aria-expanded={addingMediaCategory} onClick={()=>setAddingMediaCategory((current)=>!current)}>＋ New category</button>
              </div>
              {addingMediaCategory?<form className={styles.categoryCreator} onSubmit={createMediaCategory}><label htmlFor="dashboard-new-media-category"><small>NEW CATEGORY</small><input id="dashboard-new-media-category" autoFocus value={mediaCategoryDraft} onChange={(event)=>setMediaCategoryDraft(event.target.value)} maxLength={80} placeholder="e.g. Pitch design"/></label><div><button type="button" className={`btn ${styles.mediaSecondary}`} onClick={()=>{setAddingMediaCategory(false);setMediaCategoryDraft('');}}>Cancel</button><button className={`btn ${styles.mediaPrimary}`} disabled={savingMediaCategory||!mediaCategoryDraft.trim()}>{savingMediaCategory?'Adding…':'Add category'}</button></div></form>:null}
              {uploadStatus?<p className={uploadStatus.toLowerCase().includes('uploaded.')?styles.uploadSuccess:styles.uploadStatus} role="status">{uploadStatus}</p>:null}
            </aside>
            <div className={styles.mediaLibrary}>
              <header><div><small>YOUR LIBRARY</small><b>Previous uploads</b></div><span>{data.personalMedia.length+viewedPlayerReports.length} items</span></header>
              <div className={styles.mediaGrid}>{data.personalMedia.map((media)=>media.mediaType==='video'?<button type="button" key={`own-${media.id}`} onClick={()=>setSelectedMedia(media)}><span className={styles.fileType}>VID</span><div><b>{media.title}</b><small>{media.category} · {formatDate(media.createdAt)} · Open breakdown</small></div><i>→</i></button>:<a key={`own-${media.id}`} href={`/api/admin/my-dashboard/media/${media.id}`} target="_blank" rel="noreferrer"><span className={styles.fileType}>{media.mediaType==='photo'?'IMG':'PDF'}</span><div><b>{media.title}</b><small>{media.category} · {formatDate(media.createdAt)}</small></div></a>)}
              {viewedPlayerReports.map((report)=><a key={`report-${report.id}`} href={`/api/player/media/${report.id}`} target="_blank" rel="noreferrer" className={styles.report}><span className={styles.fileType}>PDF</span><div><b>{report.title}</b><small>{report.playerName} · Automated · {formatDate(report.createdAt)}</small></div></a>)}
              {!data.personalMedia.length&&!viewedPlayerReports.length?<p className={styles.muted}>Your uploads and {viewedPlayer?.fullName}&apos;s automated reports will appear here.</p>:null}</div>
            </div>
          </div>
      </CollapsibleSection>

      <CollapsibleSection eyebrow="03 · ATHLETE RADAR" title="Player Flags" action={<Link href="/portal/dashboard?suite=flags">Open all flags ↗</Link>}>
        {flagsLoading?<p className={styles.muted}>Updating flag data…</p>:activeFlagRules.length===0?<p className={styles.emptyPlayerState}>No visible flag columns are configured.</p>:viewedPlayer?<div className={`portal-table-wrap flags-simple-wrap ${styles.playerFlagTable}`}><table className="portal-table flags-simple-table"><thead><tr><th>Player</th><th>Last session</th>{activeFlagRules.map((rule)=><th key={rule.id}><span className={styles.flagColumnTitle}>{rule.name}</span></th>)}</tr></thead><tbody><tr><td><strong>{viewedPlayer.fullName}</strong></td><td>{formatFlagDate(viewedPlayerLastFlagSession)}</td>{activeFlagRules.map((rule)=>{const result=viewedPlayerFlagMap.get(rule.id),tone=dashboardFlagTone(rule,result);return <td key={rule.id} className={tone==='positive'?styles.flagCellPositive:tone==='negative'?styles.flagCellNegative:styles.flagCellNeutral}><DashboardFlagMetricCell rule={rule} result={result}/></td>;})}</tr></tbody></table></div>:null}
      </CollapsibleSection>

      <CollapsibleSection eyebrow="04 · GOAL TRACKING" title="Player Plan Progress" action={viewedPlayer?<Link href={`/portal/dashboard?suite=player-plans&playerPlanPlayerId=${viewedPlayer.playerId}`}>Open Player Plan ↗</Link>:null}>
        {viewedPlayer&&viewedPlayer.goals.some((goal)=>goal.goalDescription)?<ProfilePlanGoalsPanel playerId={viewedPlayer.playerId} playerName={viewedPlayer.fullName} goals={viewedPlayer.goals} canEditGoals={false}/>:<p className={styles.emptyPlayerState}>No active goals for {viewedPlayer?.fullName}.</p>}
      </CollapsibleSection>

      <CollapsibleSection eyebrow="05 · PLAYER CONTEXT" title="Player Notes" action={<Link href="/portal/admin/player-notes">Open player notes ↗</Link>}>
        {viewedPlayer?<><form className={styles.playerNoteComposer} onSubmit={savePlayerNote}><header><div><small>NEW PLAYER NOTE</small><b>Add a note for {viewedPlayer.fullName}</b></div>{playerNoteStatus?<span>{playerNoteStatus}</span>:null}</header><div className={styles.playerNoteFields}><label><span>Category</span><DashboardSelect label="Note categories" value={playerNoteDraft.category} onChange={(category)=>setPlayerNoteDraft((current)=>({...current,category}))} options={playerNoteCategories.map((category)=>({value:category,label:category}))}/></label><label><span>Date</span><input type="date" value={playerNoteDraft.noteDate} onChange={(event)=>setPlayerNoteDraft((current)=>({...current,noteDate:event.target.value}))}/></label></div><label className={styles.playerNoteText}><span>Note</span><textarea rows={4} value={playerNoteDraft.noteText} onChange={(event)=>setPlayerNoteDraft((current)=>({...current,noteText:event.target.value}))} placeholder={`Write a note for ${viewedPlayer.fullName}…`} required/></label><footer><label><input type="checkbox" checked={playerNoteDraft.playerVisible} onChange={(event)=>setPlayerNoteDraft((current)=>({...current,playerVisible:event.target.checked}))}/> Visible to player</label><button type="submit" className={`btn ${styles.mediaPrimary}`} disabled={savingPlayerNote||!playerNoteDraft.noteText.trim()}>{savingPlayerNote?'Saving…':'Save note'}</button></footer></form><PlayerNotesDisclosure player={viewedPlayer} notes={viewedPlayerNotes} onSelect={setSelectedNote} standalone/></>:null}
      </CollapsibleSection>

      <CollapsibleSection eyebrow="06 · READINESS SIGNALS" title="Questionnaire Trends" action={<Link href="/portal/admin/questionnaires">Manage questionnaires ↗</Link>}>
        <div className={styles.trendGrid}>{viewedPlayerTrends.map((trend,index)=><article key={`${trend.playerId}-${trend.question}-${index}`}><header><div><b>{trend.question}</b><small>{trend.questionnaireName}</small></div><strong>{trend.points.at(-1)?.value}</strong></header><Sparkline points={trend.points}/><footer><span>Latest response</span><small>{trend.points.length} responses</small></footer></article>)}{!viewedPlayerTrends.length?<p className={styles.emptyPlayerState}>No numeric questionnaire trends for {viewedPlayer?.fullName} yet.</p>:null}</div>
      </CollapsibleSection>

      <CollapsibleSection eyebrow="07 · PROGRAM ACCOUNTABILITY" title="Workout Progress" action={<Link href="/portal/admin/workouts">Open programming ↗</Link>}>
        <div className={styles.workoutDetails}>{viewedPlayerWorkouts.map((workout)=>{const remaining=workout.targetCount===null?null:Math.max(0,workout.targetCount-workout.completedCount);const pct=workout.targetCount?Math.min(100,(workout.completedCount/workout.targetCount)*100):0;return <article className={remaining===1?styles.oneLeft:''} key={workout.itemId}><header><div><b>{workout.name}</b><small>{workout.section?.replace(/_/g,' ')||'Workout'}</small></div>{remaining===1?<span>1 LEFT</span>:remaining===0&&workout.targetCount?<span className={styles.done}>DONE</span>:null}</header><div className={styles.progress}><i style={{width:`${pct}%`}}/></div><footer><strong>{workout.completedCount}</strong><span>{workout.targetCount===null?'total completions':`of ${workout.targetCount} completed`}</span></footer></article>})}{!viewedPlayerWorkouts.length?<p className={styles.emptyPlayerState}>No target workouts assigned to {viewedPlayer?.fullName}.</p>:null}</div>
      </CollapsibleSection>

      <CollapsibleSection eyebrow="08 · PERFORMANCE LAB" title="Biomechanics And Performance Data" action={viewedPlayer?<Link href={`/portal/force-plates?player=${encodeURIComponent(viewedPlayer.fullName)}`}>Open Full Page ↗</Link>:null}>
        {viewedPlayer?<AthletePerformanceEmbed playerName={viewedPlayer.fullName}/>:null}
      </CollapsibleSection>
    </>}
    {selectedNote?<div className={styles.modalBackdrop} role="presentation" onMouseDown={(event)=>{if(event.currentTarget===event.target)setSelectedNote(null);}}><section className={styles.noteModal} role="dialog" aria-modal="true" aria-labelledby="player-note-title"><header><div><small>PLAYER NOTE</small><h2 id="player-note-title">{selectedNote.playerName}</h2></div><button type="button" onClick={()=>setSelectedNote(null)} aria-label="Close note">×</button></header><div className={styles.noteMeta}><span><small>Date</small><b>{formatDate(selectedNote.noteDate)}</b></span>{meaningfulNoteLabel(selectedNote.domain)?<span><small>Domain</small><b>{selectedNote.domain}</b></span>:null}{meaningfulNoteLabel(selectedNote.category)?<span><small>Category</small><b>{selectedNote.category}</b></span>:null}{selectedNote.pinned?<span><small>Status</small><b>Pinned</b></span>:null}</div><article><p>{selectedNote.noteText}</p></article><footer><Link href="/portal/admin/player-notes">Open in Player Notes</Link><button type="button" onClick={()=>setSelectedNote(null)}>Done</button></footer></section></div>:null}
    {selectedMedia?<MediaBreakdownViewer title={selectedMedia.title} url={`/api/admin/my-dashboard/media/${selectedMedia.id}`} mimeType={selectedMedia.contentType||'video/mp4'} downloadName={selectedMedia.fileName} onClose={()=>setSelectedMedia(null)} initialAnnotations={selectedMedia.breakdownAnnotations||[]} onSaveAnnotations={(annotations)=>saveMediaAnnotations(selectedMedia.id,annotations)} onDelete={()=>void deleteMedia(selectedMedia)}/>:null}
  </main>;
}
