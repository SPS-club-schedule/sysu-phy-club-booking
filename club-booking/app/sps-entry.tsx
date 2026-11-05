'use client';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {authRequest} from './auth-gate';
import {saveSession, type Session} from './auth-session';

type Stage = {kind:'loading'|'ready'} | {kind:'confirm'; username:string; code:string} | {kind:'error'; message:string};
async function redeem(code:string) {
  const session = await authRequest<Session>('sps-entry',{code});
  saveSession(session);
}

async function openEntry():Promise<Stage> {
  const fragment = location.hash;
  if (fragment!=='#from-sps' && !fragment.startsWith('#sps-entry=')) return {kind:'ready'};
  history.replaceState(history.state,'',location.pathname+location.search);
  const sameTab = fragment==='#from-sps';
  const code = sameTab ? sessionStorage.getItem('sps-to-booking-v1') : fragment.slice('#sps-entry='.length);
  sessionStorage.removeItem('sps-to-booking-v1');
  if (!code || !/^[a-f0-9]{64}$/.test(code)) throw new Error('跳转凭证无效，请从日程日历重新打开');
  if (sameTab) {
    await redeem(code);
    return {kind:'ready'};
  }
  const {username}=await authRequest<{username:string}>('sps-preview',{code});
  return {kind:'confirm',username,code};
}

export default function SpsEntry({children}:{children:ReactNode}) {
  const [stage,setStage]=useState<Stage>(()=>({
    kind: typeof window!=='undefined' && (location.hash==='#from-sps' || location.hash.startsWith('#sps-entry=')) ? 'loading' : 'ready'
  }));
  const opening=useRef<Promise<Stage> | null>(null);
  useEffect(()=>{
    let active=true;
    opening.current ??= openEntry();
    opening.current.then(next=>{if(active)setStage(next)}).catch(e=>{if(active)setStage({kind:'error',message:e.message})});
    return ()=>{active=false};
  },[]);
  if(stage.kind==='ready')return <>{children}</>;
  async function confirm(code:string) {
    setStage({kind:'loading'});
    try { await redeem(code); setStage({kind:'ready'}); }
    catch(e){setStage({kind:'error',message:e instanceof Error?e.message:'登录失败，请重试'});}
  }
  return <main className="auth-page"><section className="auth-card">
    <h1>SPS 日程登录</h1>
    {stage.kind==='loading' && <p role="status">正在确认日程账号…</p>}
    {stage.kind==='confirm' && <button className="primary auth-submit" onClick={()=>void confirm(stage.code)}>以 {stage.username} 身份进入预约网站</button>}
    {stage.kind==='error' && <p role="alert">{stage.message}</p>}
    {stage.kind!=='loading' && <><a className="auth-link" href="https://sps-club-schedule.github.io/sps-club-schedule/#/calendar">返回日程日历</a><button className="auth-link" onClick={()=>setStage({kind:'ready'})}>返回预约首页</button></>}
  </section></main>;
}
