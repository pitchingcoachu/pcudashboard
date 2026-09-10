import type { FlagRuleRow } from './ai-workspace-db';

export type FlagResult = { ruleId:number; ruleName:string; domain:'pitching'|'hitting'; player:string; sessionDate:string; metric:string; pitchType:string; sessionAverage:number; baselineAverage:number|null; change:number|null; changePercent:number|null; sample:number; triggered:boolean };

const METRIC_KEYS:Record<string,string[]>={
  velocity:['rel_speed','velo','velocity'],ivb:['ivb','induced_vert_break','inducedverticalbreak'],hb:['hb','horizontal_break','horzbreak'],
  release_height:['release_height','rel_height'],release_side:['release_side','rel_side'],extension:['extension'],spin_rate:['spin_rate','spin'],
  exit_velocity:['exit_velocity','exit_speed','exitspeed'],launch_angle:['launch_angle','angle'],bat_speed:['bat_speed','batspeed'],
};
const METRIC_COUNT_KEYS:Record<string,string[]>={velocity:['velocity_n','velo_n'],ivb:['ivb_n'],hb:['hb_n'],release_height:['release_height_n','rel_height_n'],release_side:['release_side_n','rel_side_n'],extension:['extension_n','ext_n'],spin_rate:['spin_rate_n','spin_n'],exit_velocity:['exit_velocity_n','ev_n'],launch_angle:['launch_angle_n','la_n'],bat_speed:['bat_speed_n']};
const numeric=(row:Record<string,unknown>,keys:string[])=>{for(const key of keys){const actual=Object.keys(row).find((candidate)=>candidate.toLowerCase()===key);const raw=actual?row[actual]:undefined;if(raw===null||raw===undefined||raw==='')continue;const n=Number(raw);if(Number.isFinite(n))return n;}return null;};
const text=(row:Record<string,unknown>,keys:string[])=>{for(const key of keys){const actual=Object.keys(row).find((k)=>k.toLowerCase()===key);const v=String(actual?row[actual]??'':'').trim();if(v)return v;}return '';};
const avg=(values:number[])=>values.reduce((sum,value)=>sum+value,0)/values.length;
const firstLast=(value:string)=>{const raw=value.replace(/\s+/g,' ').trim();if(!raw.includes(','))return raw;const [last,...rest]=raw.split(',').map((part)=>part.trim()).filter(Boolean);return rest.length&&last?`${rest.join(' ')} ${last}`.trim():raw;};
const personKey=(value:string)=>firstLast(value).toLowerCase().replace(/[^a-z0-9]+/g,'');
const pitchTypeKey=(value:string)=>{const token=value.toLowerCase().replace(/[^a-z0-9]+/g,'');if(['fastball','fourseamfastball','fourseam','ff','fa'].includes(token))return'fastball';if(['sinker','oneseamfastball','twoseamfastball','twoseamfasball','twoseam','si','ft'].includes(token))return'sinker';if(['changeup','ch'].includes(token))return'changeup';if(['sweeper','st'].includes(token))return'sweeper';if(['splitter','splitfinger','splitfingerfastball','sp','fs'].includes(token))return'splitter';if(['curveball','cu','knucklecurve','kc'].includes(token))return'curveball';if(['cutter','fc'].includes(token))return'cutter';if(['slider','sl'].includes(token))return'slider';if(['knuckleball','kn'].includes(token))return'knuckleball';return token;};

export function evaluateFlagRules(rules:FlagRuleRow[],pointsByDomain:{pitching:Array<Record<string,unknown>>;hitting:Array<Record<string,unknown>>}):FlagResult[]{
  const results:FlagResult[]=[];
  for(const rule of rules.filter((r)=>r.enabled)){
    const rows=pointsByDomain[rule.domain]??[];const keys=METRIC_KEYS[rule.metric]??[rule.metric];const countKeys=METRIC_COUNT_KEYS[rule.metric]??[];
    const selectedPitchTypes=rule.pitchTypes?.length?rule.pitchTypes:[rule.pitchType];const allPitchTypes=selectedPitchTypes.some((value)=>value.toLowerCase()==='all');const selectedPitchTypeKeys=new Set(selectedPitchTypes.map(pitchTypeKey));
    const cutoff=new Date();cutoff.setUTCHours(0,0,0,0);cutoff.setUTCDate(cutoff.getUTCDate()-rule.baselineDays);const cutoffDate=cutoff.toISOString().slice(0,10);
    const grouped=new Map<string,{player:string;date:string;weightedSum:number;weight:number;sample:number}>();
    for(const row of rows){
      const player=text(row,rule.domain==='pitching'?['pitcher','player_name','name']:['batter','hitter','player_name','name']);
      const date=text(row,['session_date','date','game_date']).slice(0,10);if(!player||!date||date<cutoffDate)continue;
      if(rule.targetPlayer!=='All'&&personKey(player)!==personKey(rule.targetPlayer))continue;
      const type=text(row,['pitch_type','tagged_pitch_type','taggedpitchtype']);if(!allPitchTypes&&!selectedPitchTypeKeys.has(pitchTypeKey(type)))continue;
      const sessionType=text(row,['session_type','tagged_pitch_type_session']);if(rule.sessionType!=='All'&&sessionType.toLowerCase()!==rule.sessionType.toLowerCase())continue;
      let value=numeric(row,keys);if(value===null)continue;if(['release_height','release_side','extension'].includes(rule.metric))value*=12;
      const weight=Math.max(1,numeric(row,countKeys)??1);const displayPlayer=firstLast(player);const key=`${personKey(player)}\u0000${date}`;const group=grouped.get(key)??{player:displayPlayer,date,weightedSum:0,weight:0,sample:0};group.weightedSum+=value*weight;group.weight+=weight;group.sample+=weight;grouped.set(key,group);
    }
    const byPlayer=new Map<string,Array<{date:string;average:number;sample:number}>>();
    for(const group of grouped.values()){if(group.sample<rule.minimumSample||group.weight===0)continue;const list=byPlayer.get(group.player)??[];list.push({date:group.date,average:group.weightedSum/group.weight,sample:group.sample});byPlayer.set(group.player,list);}
    for(const [player,sessions] of byPlayer){
      sessions.sort((a,b)=>b.date.localeCompare(a.date));
      const current=sessions[0];
      const currentDate=new Date(`${current.date}T12:00:00Z`);
      const earliest=new Date(currentDate);earliest.setUTCDate(earliest.getUTCDate()-rule.baselineDays);
      const baseline=sessions.slice(1).filter((session)=>{const date=new Date(`${session.date}T12:00:00Z`);return date>=earliest&&date<currentDate;});
      const baselineAverage=baseline.length?avg(baseline.map((session)=>session.average)):null;
      const change=baselineAverage===null?null:current.average-baselineAverage;
      const changePercent=change===null||baselineAverage===null||baselineAverage===0?null:(change/baselineAverage)*100;
      const magnitude=rule.thresholdType==='percent'?Math.abs(changePercent??0):Math.abs(change??0);
      results.push({ruleId:rule.id,ruleName:rule.name,domain:rule.domain,player,sessionDate:current.date,metric:rule.metric,pitchType:allPitchTypes?'All':selectedPitchTypes.join(', '),sessionAverage:current.average,baselineAverage,change,changePercent,sample:current.sample,triggered:baselineAverage!==null&&magnitude>=rule.threshold});
    }
  }
  return results.sort((a,b)=>b.sessionDate.localeCompare(a.sessionDate)||Math.abs(b.change??0)-Math.abs(a.change??0));
}
