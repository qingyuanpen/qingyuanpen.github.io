import {CLOUD} from './cloud-config.mjs';
import {beijingToday} from './model.mjs';
import {sameRecords,decodeCloud,syncSnapshot,resolveConflicts} from './sync-core.mjs';

export async function startCloud(bridge){
  const $=id=>document.getElementById(id);
  const client=window.supabase?.createClient(CLOUD.url,CLOUD.key,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  if(!client)throw Error('登录组件暂未加载，本机保存仍可使用。');
  let signedIn=false,ready=false,migration=false,busy=false,again=false,pending=false,state={revision:0,records:[]},conflict=null,conflictSnapshot=null,timer=null,epoch=0;
  const badge=$('storage-badge'),loginButton=$('cloud-login'),syncButton=$('cloud-sync'),signout=$('cloud-signout');
  function status(message,error=false){
    badge.replaceChildren(document.createElement('i'),document.createTextNode(message));badge.classList.toggle('cloud-error',error);
    $('cloud-state').textContent=message;
    $('cloud-description').textContent=bridge.isDemo()?'演示模式不会上传数据。':signedIn?(migration?'本机记录尚未迁移；确认后才会合并上传。':ready?'记录仅供本人访问；其他设备登录后可读取云端记录。':'本机记录保留；云端连接尚未就绪。'):'登录后可跨设备同步；未登录时记录仅保存在本机。';
    syncButton.hidden=!signedIn||!ready;signout.hidden=!signedIn;loginButton.hidden=signedIn;
    syncButton.disabled=busy||bridge.isDemo();loginButton.disabled=bridge.isDemo();signout.disabled=bridge.isDemo();
    $('cloud-migrate').hidden=!migration||!signedIn;$('cloud-migrate').disabled=busy||bridge.isDemo();
    bridge.refresh?.();
  }
  function showError(error){
    const missing=['PGRST202','42883','42P01'].includes(error?.code);
    const message=missing?'云端待初始化':error?.code==='PT409'?'云端已变化，请重试同步':error?.code==='42501'?'账号未获云端访问权限':'同步未完成，本机记录已保留';
    status(message,true);$('cloud-help').hidden=false;
    $('cloud-help').textContent=missing?'请先在 Supabase 运行初始化脚本，再点击“重新连接”。':error?.message||'请检查网络后重试。';
  }
  function saveState(next){
    localStorage.setItem(CLOUD.stateKey,JSON.stringify(next));state=next;
  }
  function restoreState(){
    const raw=localStorage.getItem(CLOUD.stateKey);
    if(!raw)return null;
    return decodeCloud(JSON.parse(raw),beijingToday());
  }
  async function readCloud(){const {data,error}=await client.rpc('br_growth_load');if(error)throw error;return data;}
  async function saveCloud(revision,records){const {data,error}=await client.rpc('br_growth_save',{expected_revision:revision,record_list:records});if(error)throw error;return data;}
  function showConflict(result,snapshot){
    conflict=result;conflictSnapshot=snapshot;
    $('conflict-dates').textContent=result.conflicts.map(c=>c.date).join('、');
    $('cloud-conflict').showModal();status('同日记录有冲突，等待选择',true);
  }
  async function sync(){
    if(!signedIn||!ready||migration||bridge.isDemo())return;
    if(busy){again=true;return;}
    const snapshot=bridge.getRecords(),currentEpoch=epoch;
    busy=true;again=false;status('正在同步…');
    try{
      const result=await syncSnapshot({base:state.records,local:snapshot,readCloud,saveCloud,today:beijingToday()});
      if(currentEpoch!==epoch)return;
      if(result.kind==='conflict'){pending=true;showConflict(result,snapshot);return;}
      // A save during the request stays in the local queue; never replace it with an old snapshot.
      const changed=!sameRecords(bridge.getRecords(),snapshot);
      if(!changed)bridge.replaceRecords(result.records);
      saveState({revision:result.revision,records:result.records});
      pending=changed;again=changed;
      $('cloud-help').hidden=true;
      status(changed?'本机有新修改，继续同步…':'已同步云端');
      if(!changed)bridge.notify('云端同步完成。');
    }catch(error){if(currentEpoch!==epoch)return;pending=true;showError(error);}
    finally{busy=false;syncButton.disabled=bridge.isDemo();if(again){again=false;timer=setTimeout(sync,200);}}
  }
  async function connect(){
    if(bridge.isDemo()){status('演示模式 · 不同步');return;}
    if(busy)return;
    const currentEpoch=++epoch;
    try{
      const {data:{user},error}=await client.auth.getUser();
      if(currentEpoch!==epoch)return;
      if(error||!user){signedIn=false;ready=false;status('本机保存 · 未登录');return;}
      if((user.email||'').toLowerCase()!==CLOUD.ownerEmail){signedIn=false;ready=false;await client.auth.signOut({scope:'local'});status('请使用指定邮箱登录',true);return;}
      signedIn=true;ready=false;status('正在连接云端…');
      const remote=decodeCloud(await readCloud(),beijingToday());
      if(currentEpoch!==epoch)return;
      const previous=restoreState();
      if(previous){state=previous;migration=false;ready=true;pending=!sameRecords(bridge.getRecords(),state.records);await sync();}
      else if(bridge.getRecords().length&&!sameRecords(bridge.getRecords(),remote.records)){
        state={revision:0,records:[]};migration=true;ready=false;pending=true;
        status(`本机 ${bridge.getRecords().length} 条记录待迁移`);
      }else{
        bridge.replaceRecords(remote.records);saveState(remote);migration=false;ready=true;pending=false;status('已同步云端');
      }
    }catch(error){if(currentEpoch!==epoch)return;ready=false;showError(error);}
  }
  loginButton.addEventListener('click',()=>{$('login-email').value=CLOUD.ownerEmail;$('login-result').textContent='';$('cloud-login-dialog').showModal();});
  $('close-login').addEventListener('click',()=>$('cloud-login-dialog').close());
  $('login-form').addEventListener('submit',async event=>{
    event.preventDefault();if(bridge.isDemo())return;
    const button=$('send-login');button.disabled=true;
    try{
      const {error}=await client.auth.signInWithOtp({email:CLOUD.ownerEmail,options:{emailRedirectTo:CLOUD.redirectTo,shouldCreateUser:true}});
      if(error)throw error;
      $('login-result').textContent='登录邮件已发送。请在这台设备打开邮件中的链接；链接仅用于登录。';
    }catch(error){$('login-result').textContent='发送失败：'+error.message;}
    finally{button.disabled=false;}
  });
  syncButton.addEventListener('click',sync);
  $('cloud-reconnect').addEventListener('click',connect);
  $('cloud-migrate').addEventListener('click',()=>{
    if(bridge.isDemo())return;
    // Explicit migration: no legacy local data is uploaded before this click.
    migration=false;ready=true;pending=true;saveState({revision:0,records:[]});sync();
  });
  signout.addEventListener('click',async()=>{
    if(bridge.isDemo())return;
    if((pending||busy)&&!confirm('还有待同步内容。退出后仍保留本机记录，是否继续？'))return;
    epoch++;clearTimeout(timer);signedIn=false;ready=false;migration=false;again=false;
    const {error}=await client.auth.signOut({scope:'local'});
    status('本机保存 · 已退出');if(error)bridge.notify('当前设备退出未完成，请检查网络。',true);
  });
  for(const side of ['local','remote'])$(side==='local'?'conflict-local':'conflict-remote').addEventListener('click',async()=>{
    if(!conflict)return;
    if(!sameRecords(bridge.getRecords(),conflictSnapshot)){$('cloud-conflict').close();conflict=null;bridge.notify('本机记录有新修改，重新检查冲突。');sync();return;}
    const selected=resolveConflicts(conflict,side);
    // Use the conflict's remote snapshot as base. A later remote edit will produce another conflict.
    saveState({revision:conflict.remote.revision,records:conflict.remote.records});
    bridge.replaceRecords(selected);pending=true;conflict=null;$('cloud-conflict').close();sync();
  });
  $('conflict-later').addEventListener('click',()=>{$('cloud-conflict').close();status('有未解决的冲突，本机记录保留',true);});
  window.addEventListener('online',()=>{if(signedIn&&ready)sync();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&signedIn&&ready&&!migration&&!bridge.isDemo())sync();});
  client.auth.onAuthStateChange((event)=>{if(event==='SIGNED_IN'||event==='TOKEN_REFRESHED')setTimeout(connect,0);else if(event==='SIGNED_OUT'){signedIn=false;ready=false;status('本机保存 · 未登录');}});
  // Do not send a login email automatically, including in demo mode.
  const session=await client.auth.getSession();
  if(session.data.session&&!bridge.isDemo())await connect();else status(bridge.isDemo()?'演示模式 · 不同步':'本机保存 · 未登录');
  return {
    localChanged(){pending=true;if(ready&&!migration){status('已存本机 · 等待同步');clearTimeout(timer);timer=setTimeout(sync,600);}},
    modeChanged(){status(bridge.isDemo()?'演示模式 · 不同步':signedIn&&ready?(pending?'本机有待同步内容':'已连接云端'):'本机保存 · 未登录');if(!bridge.isDemo())connect();},
    label(){return bridge.isDemo()?'演示数据不会上传。':signedIn&&ready?(pending?'本机已保存 · 云端有待同步内容':'本机缓存＋云端记录'):'仅本机保存 · 登录并连接后同步';}
  };
}
