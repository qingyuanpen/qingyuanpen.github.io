export const VERSION=1;
export const STORAGE_KEY='brandon-growth-log.v1';
export const POLICY=Object.freeze({id:'2026-11-05',start:'2026-11-05',end:'2026-11-18',research:30,english:30,fitness:20,recoveryDays:2});
export const DOMAINS=['research','english','fitness'];
export function beijingToday(now=new Date()){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');
}
export function addDays(day,n){return new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);}
export function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
export function inCycle(date){return date>=POLICY.start&&date<=POLICY.end;}
export function cycleWeek(date){return inCycle(date)?Math.floor((Date.parse(date)-Date.parse(POLICY.start))/604800000):-1;}
export function blankRecord(date){return {date,research:{minutes:0,note:''},english:{minutes:0,note:''},fitness:{minutes:0,note:''},recovery:false,recoveryDeclared:false,paused:false,pauseReason:'',reflection:'',savedAt:'',updatedAt:''};}
export function normalizeRecord(raw,{today=beijingToday(),allowFuture=false}={}){
  if(!raw||typeof raw!=='object'||!validDate(raw.date)) throw Error('记录日期无效。');
  if(!allowFuture&&raw.date>today) throw Error('不能保存未来日期的完成记录。');
  if(raw.date<'2000-01-01'||raw.date>'2100-12-31') throw Error('记录日期须在 2000—2100 年之间。');
  const r=blankRecord(raw.date);
  for(const k of DOMAINS){
    const d=raw[k];
    if(!d||!Number.isInteger(d.minutes)||d.minutes<0||d.minutes>1440||typeof d.note!=='string'||d.note.length>1600) throw Error('时长须为 0—1440 的整数，单项记录不超过 1600 字。');
    r[k]={minutes:d.minutes,note:d.note.trim()};
    if(d.minutes>0&&!r[k].note) throw Error('请为有时长的项目填写一句具体内容。');
  }
  if(totalMinutes(r)>1440) throw Error('三项合计不能超过一天的 1440 分钟，请分别计时。');
  for(const k of ['recovery','recoveryDeclared','paused']){
    if(raw[k]!==undefined&&typeof raw[k]!=='boolean')throw Error('记录状态格式无效。');
    r[k]=raw[k]===true;
  }
  for(const [k,limit]of [['pauseReason',300],['reflection',600]]){
    if(raw[k]!==undefined&&(typeof raw[k]!=='string'||raw[k].length>limit)) throw Error('补充说明格式或长度不正确。');
    r[k]=(raw[k]||'').trim();
  }
  if(r.paused&&!r.pauseReason)throw Error('暂停时请简要说明报备情况。');
  if(r.recovery&&!r.paused&&!r.recoveryDeclared)throw Error('恢复日请确认已提前在群内报备。');
  if(!r.recovery)r.recoveryDeclared=false;
  for(const k of ['savedAt','updatedAt'])r[k]=typeof raw[k]==='string'&&raw[k].length<40&&Number.isFinite(Date.parse(raw[k]))?raw[k]:'';
  return r;
}
export function totalMinutes(r){return DOMAINS.reduce((n,k)=>n+r[k].minutes,0);}
export function recoveryIndex(r,records){
  if(!inCycle(r.date)||!r.recovery||r.paused||!r.recoveryDeclared)return -1;
  const days=records.filter(x=>x.date!==r.date&&cycleWeek(x.date)===cycleWeek(r.date)&&x.recovery&&x.recoveryDeclared&&!x.paused).concat(r).sort((a,b)=>a.date.localeCompare(b.date));
  return days.findIndex(x=>x.date===r.date);
}
export function assess(r,records){
  if(!inCycle(r.date))return {status:'unassessed',label:'仅记录',research:false,english:false,fitness:false,recoveryOK:false};
  if(r.paused)return {status:'exempt',label:'报备暂停',research:false,english:false,fitness:false,recoveryOK:false};
  const research=r.research.minutes>=POLICY.research&&!!r.research.note;
  const english=r.english.minutes>=POLICY.english&&!!r.english.note;
  const index=recoveryIndex(r,records);
  const recoveryOK=r.recovery&&r.recoveryDeclared&&index>=0&&index<POLICY.recoveryDays;
  const fitness=r.recovery?recoveryOK:r.fitness.minutes>=POLICY.fitness&&!!r.fitness.note;
  const complete=research&&english&&fitness;
  return {status:complete?'complete':'partial',label:complete?(recoveryOK?'达标 · 恢复':'任务达标'):'尚未达标',research,english,fitness,recoveryOK};
}
export function validateRecovery(r,records){
  if(!r.recovery||r.paused||!inCycle(r.date))return;
  const used=records.filter(x=>x.date!==r.date&&cycleWeek(x.date)===cycleWeek(r.date)&&x.recovery&&x.recoveryDeclared&&!x.paused).length;
  if(used>=POLICY.recoveryDays)throw Error('本期这一周已使用 2 个恢复日，请按实际情况记录训练或报备暂停。');
}
export function upsert(records,r){return records.filter(x=>x.date!==r.date).concat(r).sort((a,b)=>a.date.localeCompare(b.date));}
export function filterRecords(records,scope,today=beijingToday()){
  return records.filter(r=>r.date<=today&&(scope==='all'||scope==='cycle'&&inCycle(r.date)||scope==='30'&&r.date>=addDays(today,-29)));
}
export function stats(records,scope,today=beijingToday()){
  const selected=filterRecords(records,scope,today),all=records.filter(r=>r.date<=today);
  const passed=new Set(all.filter(r=>assess(r,all).status==='complete').map(r=>r.date));
  const eligible=selected.filter(r=>inCycle(r.date)&&!r.paused);
  const complete=selected.filter(r=>assess(r,all).status==='complete').length;
  let streak=0,d=passed.has(today)?today:addDays(today,-1);
  while(passed.has(d)){streak++;d=addDays(d,-1);}
  let best=0,run=0,last='';
  for(const date of [...passed].sort()){run=last&&addDays(last,1)===date?run+1:1;last=date;best=Math.max(best,run);}
  const totals=Object.fromEntries(DOMAINS.map(k=>[k,selected.reduce((n,r)=>n+r[k].minutes,0)]));
  const days=Object.fromEntries(DOMAINS.map(k=>[k,eligible.filter(r=>assess(r,all)[k]).length]));
  const trained=eligible.filter(r=>!r.recovery&&assess(r,all).fitness).length;
  const recovered=eligible.filter(r=>assess(r,all).recoveryOK).length;
  return {selected,eligible:eligible.length,recorded:selected.length,complete,rate:eligible.length?Math.round(complete/eligible.length*100):null,minutes:Object.values(totals).reduce((a,b)=>a+b,0),totals,days,trained,recovered,streak,best,cycleComplete:all.filter(r=>inCycle(r.date)&&assess(r,all).status==='complete').length};
}
export function parseBackup(text,{today=beijingToday()}={}){
  let doc;try{doc=JSON.parse(text);}catch{throw Error('这不是有效的 JSON 备份文件。');}
  if(!doc||doc.version!==VERSION||!Array.isArray(doc.records)||doc.records.length>50000)throw Error('备份版本或格式不兼容。');
  const seen=new Set();
  return doc.records.map(raw=>{const r=normalizeRecord(raw,{today});if(seen.has(r.date))throw Error('备份中存在重复日期，请检查后再导入。');seen.add(r.date);return r;});
}
export function mergeRecords(current,incoming){const seen=new Set(current.map(r=>r.date));return [...current,...incoming.filter(r=>!seen.has(r.date))].sort((a,b)=>a.date.localeCompare(b.date));}
export function demoRecords(){
  const values=[[45,30,25],[70,45,30],[40,35,0],[80,40,45],[30,30,20],[55,40,0],[35,25,25],[90,45,40],[60,30,20],[50,40,0],[75,35,30],[35,30,25],[60,45,0],[45,35,30]];
  return values.map((v,i)=>{
    const r=blankRecord(addDays(POLICY.start,i));
    r.research={minutes:v[0],note:['整理文献比较表','检查数据与图表','完善阶段汇报提纲'][i%3]};
    r.english={minutes:v[1],note:['摘要精读与英文复述','听力订正与词汇复习','阅读笔记与口语练习'][i%3]};
    r.fitness={minutes:v[2],note:v[2]?['力量训练','羽毛球','快走'][i%3]:'计划恢复日'};
    r.recovery=v[2]===0;r.recoveryDeclared=r.recovery;r.reflection=['把今天的问题写清楚，明天继续。','保持节奏，比临时加量更重要。','今天推进了一小步。'][i%3];
    return r;
  });
}
