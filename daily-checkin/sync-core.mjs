import {parseBackup} from './model.mjs';
export function signature(r){
  if(!r)return 'missing';
  const {savedAt,updatedAt,...value}=r;
  return JSON.stringify(value);
}
export function sameRecords(a,b){
  if(a.length!==b.length)return false;
  const map=new Map(b.map(r=>[r.date,signature(r)]));
  return a.every(r=>map.get(r.date)===signature(r));
}
export function mergeThreeWay(base,local,remote){
  const b=new Map(base.map(r=>[r.date,r])),l=new Map(local.map(r=>[r.date,r])),r=new Map(remote.map(r=>[r.date,r]));
  const dates=[...new Set([...b.keys(),...l.keys(),...r.keys()])].sort();
  const merged=[],conflicts=[];
  for(const date of dates){
    // This app has no deletion feature. A missing cache entry is never a deletion request.
    const bv=b.get(date),lv=l.get(date)||bv,rv=r.get(date)||bv;
    const lc=signature(lv)!==signature(bv),rc=signature(rv)!==signature(bv);
    if(lc&&rc&&signature(lv)!==signature(rv)){conflicts.push({date,local:lv||null,remote:rv||null});continue;}
    const chosen=lc?lv:rv;
    if(chosen)merged.push(chosen);
  }
  return {merged,conflicts};
}
export function resolveConflicts(result,side){
  if(!['local','remote'].includes(side))throw Error('Invalid conflict selection');
  return result.merged.concat(result.conflicts.map(c=>c[side]).filter(Boolean)).sort((a,b)=>a.date.localeCompare(b.date));
}
export function decodeCloud(doc,today){
  if(!doc||!Number.isSafeInteger(doc.revision)||doc.revision<0||!Array.isArray(doc.records))throw Error('云端返回的数据格式不正确，已停止同步。');
  return {revision:doc.revision,records:parseBackup(JSON.stringify({version:1,records:doc.records}),{today})};
}
export async function syncSnapshot({base,local,readCloud,saveCloud,today,resolution}){
  const remote=decodeCloud(await readCloud(),today);
  const result=mergeThreeWay(base,local,remote.records);
  if(result.conflicts.length&&!resolution)return {kind:'conflict',...result,remote,local};
  const records=result.conflicts.length?resolveConflicts(result,resolution):result.merged;
  let revision=remote.revision;
  if(!sameRecords(records,remote.records)){
    const saved=await saveCloud(remote.revision,records);
    if(!saved||!Number.isSafeInteger(saved.revision)||saved.revision<=remote.revision)throw Error('云端未确认新的保存版本。');
    revision=saved.revision;
  }
  return {kind:'synced',records,revision};
}
