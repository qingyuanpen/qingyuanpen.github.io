import {VERSION,STORAGE_KEY,POLICY,DOMAINS,beijingToday,addDays,inCycle,blankRecord,normalizeRecord,totalMinutes,assess,validateRecovery,upsert,stats,parseBackup,mergeRecords,demoRecords} from './model.mjs';
const $=id=>document.getElementById(id);
let today=beijingToday(),records=[],scope='cycle',demo=new URLSearchParams(location.search).get('demo')==='1',showAll=false,dirty=false,pendingImport=null,storageOK=true,toastTimer;
const dateInput=$('entry-date'),form=$('entry-form');
let cloudHooks=null,cloudApplying=false,cloudDraftChanged=false;
function activeRecords(){return demo?demoRecords():records;}
function effectiveToday(){return demo?POLICY.end:today;}
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function storageError(message){storageOK=false;$('storage-error').textContent=message;$('storage-error').hidden=false;$('storage-badge').textContent='保存不可用';}
function load(){
  try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)records=parseBackup(raw,{today});}
  catch{storageError('本机保存暂不可用或已有记录无法读取。为保护原记录，已停止写入；请先导出原始备份。');}
}
function persist(next){
  if(!storageOK)throw Error('本机保存不可用，未写入。请先导出备份并检查浏览器存储权限。');
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:VERSION,records:next}));}
  catch{throw Error('保存失败：浏览器存储空间不足或访问被限制。原记录保留，请导出备份。');}
  records=next;
  if(!cloudApplying)cloudHooks?.localChanged();
}
function text(id,value){$(id).textContent=value;}
function el(tag,cls,content){const node=document.createElement(tag);if(cls)node.className=cls;if(content!==undefined)node.textContent=content;return node;}
function renderMetrics(){
  const data=activeRecords(),s=stats(data,scope,effectiveToday());
  text('stat-hours',(s.minutes/60).toFixed(1));text('stat-minutes',`共 ${s.minutes.toLocaleString()} 分钟实际投入`);text('stat-recorded',s.recorded);text('stat-complete',s.complete);text('stat-rate',s.rate===null?'暂无本期可评定记录':`已记录且可评定日期中，${s.rate}% 达标`);text('stat-streak',s.streak);text('stat-best',`最长连续 ${s.best} 天 · 全部记录`);
  text('scope-label',scope==='cycle'?'本期累计':scope==='30'?'近 30 天累计':'全部累计');
  const percent=Math.round(s.cycleComplete/14*100);$('cycle-orbit').style.setProperty('--progress',percent*3.6+'deg');$('cycle-orbit').setAttribute('aria-label',`本期 14 天中 ${s.cycleComplete} 天达标`);$('cycle-percent').replaceChildren(document.createTextNode(percent),el('small','','%'));
  for(const k of DOMAINS){text(k+'-total',s.totals[k].toLocaleString());$(k+'-progress').style.width=(s.eligible?s.days[k]/s.eligible*100:0)+'%';}
  text('research-days',s.days.research+' 天达标');text('english-days',s.days.english+' 天达标');text('fitness-days',s.trained+' 次训练'+(s.recovered?' · '+s.recovered+' 天恢复':''));
  renderChart(s);renderHistory(s.selected);
  const bytes=new TextEncoder().encode(JSON.stringify({version:VERSION,records})).length;
  text('storage-detail',demo?'演示数据不会写入本机，也不会参与真实统计。':`${records.length} 天记录 · 导出文件约 ${(bytes/1024).toFixed(1)} KB · ${cloudHooks?.label()||'仅本机保存 · 云端连接中'}`);
}
function renderChart(s){
  let dates=[];const end=effectiveToday();
  if(scope==='cycle')dates=Array.from({length:14},(_,i)=>addDays(POLICY.start,i));
  else if(scope==='30')dates=Array.from({length:30},(_,i)=>addDays(end,i-29));
  else {const first=s.selected[0]?.date||addDays(end,-13);const span=Math.round((Date.parse(end)-Date.parse(first))/86400000)+1;if(span>30){for(let i=11;i>=0;i--){const m=new Date(end+'T00:00:00Z');m.setUTCDate(1);m.setUTCMonth(m.getUTCMonth()-i);dates.push(m.toISOString().slice(0,7));}}else dates=Array.from({length:Math.max(14,span)},(_,i)=>addDays(span<14?addDays(end,-13):first,i));}
  const monthly=dates[0].length===7;
  const grouped=dates.map(date=>{const items=s.selected.filter(r=>monthly?r.date.startsWith(date):r.date===date);return {date,items,values:DOMAINS.map(k=>items.reduce((n,r)=>n+r[k].minutes,0))};});
  const max=Math.max(monthly?600:120,...grouped.map(x=>x.values.reduce((a,b)=>a+b,0)));const top=Math.ceil(max/(monthly?60:30))*(monthly?60:30);
  text('chart-top',top);text('chart-mid',Math.round(top/2));
  const box=$('bars');box.replaceChildren();
  grouped.forEach((g,i)=>{
    const total=g.values.reduce((a,b)=>a+b,0),future=!monthly&&g.date>end;
    const outer=el('div','day-bar'+(future?' future':'')+(g.date===end?' current':''));outer.setAttribute('role','listitem');
    const graphic=el(future||monthly?'div':'button','bar-graphic');
    if(graphic.tagName==='BUTTON'){graphic.type='button';graphic.addEventListener('click',()=>{if(chooseDate(g.date))$('daily-form').scrollIntoView({behavior:'smooth'});});}
    const label=g.date+`：科研 ${g.values[0]}，英语 ${g.values[1]}，运动 ${g.values[2]} 分钟`;
    graphic.setAttribute('aria-label',label);graphic.title=label;
    const stack=el('span','bar-stack'+(total?'':' bar-empty'));stack.style.height=total?total/top*100+'%':'3px';
    for(let j=0;j<3;j++){if(!g.values[j])continue;const part=el('span',DOMAINS[j]);part.style.height=g.values[j]/total*100+'%';stack.append(part);}
    graphic.append(stack);outer.append(graphic);
    const showLabel=dates.length<=14||i%3===0||i===dates.length-1;
    outer.append(el('span','bar-label',showLabel?(monthly?g.date.slice(5)+'月':g.date.slice(8)):''));outer.append(el('span','bar-tooltip',g.date.replaceAll('-','.')+' · '+total+' 分钟'));box.append(outer);
  });
  text('chart-range',dates[0].replaceAll('-','.')+' — '+dates.at(-1).replaceAll('-','.'));
  text('chart-summary',monthly?'按月汇总 · 最近 12 个月':s.recorded?`本范围累计 ${s.minutes} 分钟`:'从第一条真实记录开始');
  const unit=$('chart-summary').nextElementSibling;unit.textContent=monthly?'MIN / MONTH':'MIN / DAY';
}
function renderHistory(selected){
  const list=$('history-list');list.replaceChildren();const sorted=[...selected].sort((a,b)=>b.date.localeCompare(a.date));
  if(!sorted.length){const empty=el('div','history-empty'),icon=el('div','empty-icon','↗');empty.append(icon,el('h3','','你的第一条记录，会从这里开始。'),el('p','','完成多少，就记录多少。保存后总览会同步更新。'));list.append(empty);}
  for(const r of sorted.slice(0,showAll?sorted.length:5)){
    const a=assess(r,activeRecords()),row=el('article','history-row');row.append(el('time','history-date',r.date.replaceAll('-','.')));row.lastChild.dateTime=r.date;row.append(el('span','history-status '+a.status,a.label));
    const summary=el('div','history-summary'),times=el('div','history-times');for(const [k,label]of [['research','科研'],['english','英语'],['fitness','运动']])times.append(el('span',k,label+' '+r[k].minutes+'′'));if(r.recovery)times.append(el('span','muted','恢复'));summary.append(times,el('p','history-note',r.reflection||r.pauseReason||DOMAINS.map(k=>r[k].note).filter(Boolean).join(' / ')||'记录了今天的状态'));row.append(summary);
    const edit=el('button','',demo?'查看 ↗':'编辑 ↗');edit.type='button';edit.setAttribute('aria-label',(demo?'查看':'编辑')+' '+r.date+' 的记录');edit.addEventListener('click',()=>{if(chooseDate(r.date))$('daily-form').scrollIntoView({behavior:'smooth'});});row.append(edit);list.append(row);
  }
  $('show-more').hidden=sorted.length<=5;text('show-more',showAll?'收起记录 ↑':`查看全部 ${sorted.length} 条记录 ↓`);
}
function readForm(){
  const r=blankRecord(dateInput.value);
  for(const k of DOMAINS){r[k]={minutes:Number($(k+'-minutes').value),note:$(k+'-note').value};}
  r.recovery=$('recovery').checked;r.recoveryDeclared=$('recovery-confirm').checked;r.paused=$('paused').checked;r.pauseReason=$('pause-reason').value;r.reflection=$('reflection').value;return r;
}
function updatePreview(){
  const r=readForm();const a=assess(r,activeRecords());
  for(const k of DOMAINS){const node=$(k+'-result');node.classList.toggle('done',a[k]);node.textContent=r.paused?'暂停':!inCycle(r.date)?'仅记录':k==='fitness'&&r.recovery?(a.recoveryOK?'恢复日':'待确认报备'):a[k]?'已达标':r[k].minutes?`还差 ${Math.max(0,POLICY[k]-r[k].minutes)} 分钟`:'待记录';if(r[k].minutes>=POLICY[k]&&!r[k].note.trim()&&!r.paused&&inCycle(r.date))node.textContent='补一句内容';}
  $('recovery-confirm-wrap').hidden=!r.recovery;$('pause-reason').hidden=!r.paused;
}
function loadForm(date){
  const found=activeRecords().find(r=>r.date===date),r=found||blankRecord(date);dateInput.value=date;
  for(const k of DOMAINS){$(k+'-minutes').value=r[k].minutes;$(k+'-note').value=r[k].note;}
  $('recovery').checked=r.recovery;$('recovery-confirm').checked=r.recoveryDeclared;$('paused').checked=r.paused;$('pause-reason').value=r.pauseReason;$('reflection').value=r.reflection;
  dirty=false;cloudDraftChanged=false;$('form-error').hidden=true;dateInput.dataset.loaded=date;
  text('save-state',demo?'演示记录':found?'已保存 · 可继续修改':'尚未保存');text('save-button',demo?'演示模式 · 不保存':found?'更新当日记录 →':'保存当日记录 →');
  const hint=!inCycle(date)?'该日期在本期承诺之外：可以记录投入，暂不判定达标。':date<effectiveToday()?'历史补录：保留实际完成情况，不代表当日按时打卡。':'按实际情况填写，未完成的项目也可以保存。';text('date-hint',hint);
  for(const control of form.querySelectorAll('input,textarea,button'))control.disabled=demo;
  updatePreview();
}
function chooseDate(date){
  if(date>effectiveToday()){dateInput.value=dateInput.dataset.loaded;toast('请选择今天或之前的日期。',true);return false;}
  if(dirty&&!confirm('当前内容尚未保存。切换日期会放弃这次修改，是否继续？')){dateInput.value=dateInput.dataset.loaded;return false;}
  loadForm(date);return true;
}
function refreshMode(){
  $('demo-banner').hidden=!demo;text('demo-toggle',demo?'返回我的记录':'查看演示 ↗');
  text('today-label',(demo?POLICY.end:today).replaceAll('-','.')+' · '+(demo?'示例日期':'北京时间'));
  dateInput.max=effectiveToday();dateInput.min='2000-01-01';
  $('export-button').disabled=demo;$('import-button').disabled=demo||!storageOK;
  loadForm(demo?POLICY.end:today);renderMetrics();
}
function toggleDemo(){
  if(dirty&&!confirm('当前内容尚未保存。切换模式会放弃这次修改，是否继续？'))return;
  demo=!demo;showAll=false;const url=new URL(location.href);if(demo)url.searchParams.set('demo','1');else url.searchParams.delete('demo');history.replaceState(null,'',url);refreshMode();cloudHooks?.modeChanged();
}
dateInput.addEventListener('change',()=>chooseDate(dateInput.value));$('today-button').addEventListener('click',()=>chooseDate(effectiveToday()));
form.addEventListener('input',()=>{dirty=true;text('save-state','有修改 · 待保存');updatePreview();});form.addEventListener('change',()=>{dirty=true;updatePreview();});
form.addEventListener('submit',event=>{
  event.preventDefault();if(demo)return;$('form-error').hidden=true;
  try{
    today=beijingToday();dateInput.max=today;
    const r=normalizeRecord(readForm(),{today});validateRecovery(r,records);const previous=records.find(x=>x.date===r.date);r.savedAt=previous?.savedAt||new Date().toISOString();r.updatedAt=new Date().toISOString();
    if(!r.paused&&!r.recovery&&!totalMinutes(r)&&!r.reflection&&!DOMAINS.some(k=>r[k].note))throw Error('请填写至少一项实际内容，或记录今天的特殊情况。');
    if(cloudDraftChanged&&!confirm('这一天在云端有新记录，是否用当前表单更新？取消后表单仍会保留，可以先查看历史记录。'))return;
    persist(upsert(records,r));loadForm(r.date);renderMetrics();toast('已保存至本机，成长总览已更新。');
  }catch(error){text('form-error',error.message);$('form-error').hidden=false;}
});
for(const button of document.querySelectorAll('[data-scope]'))button.addEventListener('click',()=>{scope=button.dataset.scope;showAll=false;for(const b of document.querySelectorAll('[data-scope]')){b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));}renderMetrics();});
$('demo-toggle').addEventListener('click',toggleDemo);$('demo-exit').addEventListener('click',toggleDemo);$('show-more').addEventListener('click',()=>{showAll=!showAll;renderMetrics();});
function download(content,filename){const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('export-button').addEventListener('click',()=>{
  if(demo)return;
  try{const raw=localStorage.getItem(STORAGE_KEY);const content=storageOK?JSON.stringify({version:VERSION,exportedAt:new Date().toISOString(),policy:POLICY,records},null,2):raw;if(!content)throw Error('暂无可导出的原始记录。');download(content,`brandon-growth-log-${today}${storageOK?'':'-raw'}.json`);toast(storageOK?'已导出备份。未来换设备时可以导入。':'已导出原始数据，请妥善保管。');}
  catch(error){toast('导出失败：'+error.message,true);}
});
$('import-button').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async()=>{
  const file=$('import-file').files[0];if(!file)return;
  try{if(file.size>5*1024*1024)throw Error('单次导入上限为 5 MB，请拆分备份后导入。');const incoming=parseBackup(await file.text(),{today});pendingImport=mergeRecords(records,incoming);const added=pendingImport.length-records.length;text('import-summary',`文件包含 ${incoming.length} 天记录，将新增 ${added} 天；${incoming.length-added} 个已有日期保持原样。`);$('import-dialog').showModal();}
  catch(error){toast(error.message,true);}finally{$('import-file').value='';}
});
$('cancel-import').addEventListener('click',()=>{$('import-dialog').close();pendingImport=null;});
$('confirm-import').addEventListener('click',()=>{
  try{if(!pendingImport)return;persist(pendingImport);pendingImport=null;$('import-dialog').close();if(!dirty)loadForm(dateInput.value);renderMetrics();toast('记录已合并导入，已有日期保持原样。');}
  catch(error){$('import-dialog').close();toast(error.message,true);}
});
window.addEventListener('beforeunload',e=>{if(dirty&&!demo){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{if(e.key!==STORAGE_KEY||demo)return;try{records=e.newValue?parseBackup(e.newValue,{today}):[];renderMetrics();if(!dirty)loadForm(dateInput.value);toast(dirty?'其他页面更新了记录，当前未保存内容仍保留。':'已同步本机其他页面的更新。');}catch{storageError('其他页面写入的数据无法读取，已停止写入。请先导出原始备份。');}});
document.addEventListener('visibilitychange',()=>{if(document.hidden||demo)return;const newDay=beijingToday();if(newDay!==today){today=newDay;dateInput.max=today;text('today-label',today.replaceAll('-','.')+' · 北京时间');renderMetrics();if(!dirty)loadForm(today);}});
load();refreshMode();

import('./cloud.mjs').then(async module=>{
  cloudHooks=await module.startCloud({
    getRecords:()=>structuredClone(records),
    isDemo:()=>demo,
    notify:toast,
    refresh:renderMetrics,
    replaceRecords(next){
      cloudApplying=true;
      try{
        const before=records.find(r=>r.date===dateInput.value),after=next.find(r=>r.date===dateInput.value);
        if(dirty&&JSON.stringify(before)!==JSON.stringify(after)){
          cloudDraftChanged=true;
          $('form-error').textContent='填写期间，云端更新了当天记录。当前表单已保留；保存前会请你确认。';
          $('form-error').hidden=false;
        }
        persist(next);renderMetrics();if(!dirty)loadForm(dateInput.value);
      }
      finally{cloudApplying=false;}
    }
  });
  renderMetrics();
}).catch(error=>{
  $('cloud-help').hidden=false;
  $('cloud-help').textContent=error.message;
  $('cloud-state').textContent='云端连接未完成，本机保存可用';
});
