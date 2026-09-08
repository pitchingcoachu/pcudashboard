import type { FlagRuleRow } from './ai-workspace-db';

export type FlagResult = { ruleId:number; ruleName:string; domain:'pitching'|'hitting'; player:string; sessionDate:string; metric:string; pitchType:string; sessionAverage:number; baselineAverage:number; change:number; changePercent:number; sample:number; triggered:boolean };

const METRIC_KEYS:Record<string,string[]>={
  velocity:['rel_speed','velo','velocity'],ivb:['ivb','induced_vert_break','inducedverticalbreak'],hb:['hb','horizontal_break','horzbreak'],
  release_height:['release_height','rel_height'],release_side:['release_side','rel_side'],extension:['extension'],spin_rate:['spin_rate','spin'],
  exit_velocity:['exit_velocity','exit_speed','exitspeed'],launch_angle:['launch_angle','angle'],bat_speed:['bat_speed','batspeed'],
};
const numeric=(row:Record<string,unknown>,keys:string[])=>{for(const key of keys){const actual=Object.keys(row).find((k)=>k.toLowerCase()===key);const n=Number(actual?row[actual]:undefined);if(Number.isFinite(n))return n;}return null;};
const text=(row:Record<string,unknown>,keys:string[])=>{for(const key of keys){const actual=Object.keys(row).find((k)=>k.toLowerCase()===key);const v=String(actual?row[actual]??'':'').trim();if(v)return v;}return '';};
const avg=(values:number[])=>values.reduce((sum,value)=>sum+value,0)/values.length;

export function evaluateFlagRules(rules:FlagRuleRow[],pointsByDomain:{pitching:Array<Record<string,unknown>>;hitting:Array<Record<string,unknown>>}):FlagResult[]{
  const results:FlagResult[]=[];
  for(const rule of rules.filter((r)=>r.enabled)){
    const rows=pointsByDomain[rule.domain]??[];const keys=METRIC_KEYS[rule.metric]??[rule.metric];
    const grouped=new Map<string,{player:string;date:string;values:number[]}>();
    for(const row of rows){
      const player=text(row,rule.domain==='pitching'?['pitcher','player_name','name']:['batter','hitter','player_name','name']);
      const date=text(row,['session_date','date','game_date']).slice(0,10);if(!player||!date)continue;
      if(rule.targetPlayer!=='All'&&player.toLowerCase()!==rule.targetPlayer.toLowerCase())continue;
      const type=text(row,['pitch_type','tagged_pitch_type','taggedpitchtype']);if(rule.pitchType!=='All'&&type.toLowerCase()!==rule.pitchType.toLowerCase())continue;
      const sessionType=text(row,['session_type','tagged_pitch_type_session']);if(rule.sessionType!=='All'&&sessionType.toLowerCase()!==rule.sessionType.toLowerCase())continue;
      let value=numeric(row,keys);if(value===null)continue;if(['release_height','release_side','extension'].includes(rule.metric))value*=12;
      const key=`${player}\u0000${date}`;const group=grouped.get(key)??{player,date,values:[]};group.values.push(value);grouped.set(key,group);
    }
    const byPlayer=new Map<string,Array<{date:string;average:number;sample:number}>>();
    for(const group of grouped.values()){if(group.values.length<rule.minimumSample)continue;const list=byPlayer.get(group.player)??[];list.push({date:group.date,average:avg(group.values),sample:group.values.length});byPlayer.set(group.player,list);}
    for(const [player,sessions] of byPlayer){sessions.sort((a,b)=>b.date.localeCompare(a.date));const current=sessions[0];const currentDate=new Date(`${current.date}T12:00:00Z`);const earliest=new Date(currentDate);earliest.setUTCDate(earliest.getUTCDate()-rule.baselineDays);const baseline=sessions.slice(1).filter((s)=>{const d=new Date(`${s.date}T12:00:00Z`);return d>=earliest&&d<currentDate;});if(!baseline.length)continue;const baselineAverage=avg(baseline.map((s)=>s.average));const change=current.average-baselineAverage;const changePercent=baselineAverage===0?0:(change/baselineAverage)*100;const magnitude=rule.thresholdType==='percent'?Math.abs(changePercent):Math.abs(change);const directionMatches=rule.direction==='either'||(rule.direction==='increase'&&change>0)||(rule.direction==='decrease'&&change<0);results.push({ruleId:rule.id,ruleName:rule.name,domain:rule.domain,player,sessionDate:current.date,metric:rule.metric,pitchType:rule.pitchType,sessionAverage:current.average,baselineAverage,change,changePercent,sample:current.sample,triggered:directionMatches&&magnitude>=rule.threshold});}
  }
  return results.filter((r)=>r.triggered).sort((a,b)=>b.sessionDate.localeCompare(a.sessionDate)||Math.abs(b.change)-Math.abs(a.change));
}
