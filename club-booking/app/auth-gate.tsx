'use client';
import {useState,useEffect,type ReactNode} from 'react';
import {CalendarDays,LogOut} from 'lucide-react';
import {CLUBS} from './schedule';
import {bookingApiFetch} from './booking-api';
import {readSession,saveSession,rememberLogin,type User,type Session} from './auth-session';

export async function authRequest<T={user:User;expiresAt:number;message:string}>(path:string,body?:unknown):Promise<T>{
 const r=await bookingApiFetch('auth/'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const value=await r.json() as {error?:string;data:T};if(!r.ok)throw Object.assign(new Error(value.error||'操作未完成，请重试'),{status:r.status});return value.data;
}
export default function AuthGate({children}:{children:(user:User,logout:()=>void)=>ReactNode}){
 const [session,setSession]=useState<Session|null>(null),[checking,setChecking]=useState(true);
 const [mode,setMode]=useState<'login'|'sps'|'register'|'recover'>('login');
 const [name,setName]=useState(''),[pass,setPass]=useState(''),[address,setAddress]=useState(''),[club,setClub]=useState(''),[code,setCode]=useState('');
 const [remember,setRemember]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [native,setNative]=useState(false),[checkFailed,setCheckFailed]=useState(false);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{setSession(readSession());setNative(!!window.BookingNative);setChecking(false);const sync=()=>setSession(readSession());window.addEventListener('booking-auth-change',sync);return()=>window.removeEventListener('booking-auth-change',sync)},[]);
 useEffect(()=>{
  if(!session){setChecking(false);return}
  let active=true;setChecking(true);setCheckFailed(false);
  void authRequest('me').then(data=>{if(active){saveSession({...session,user:data.user,expiresAt:data.expiresAt});setAddress(data.user.email)}}).catch(e=>{if(active&&e.status!==401){setError(e.message);setCheckFailed(true)}}).finally(()=>{if(active)setChecking(false)});
  return()=>{active=false};
 // Refresh identity on a new token; updating its user does not loop.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[session?.token,retry]);
 function switchMode(next:typeof mode){setMode(next);setPass('');setCode('');setError('');setMessage('')}
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setMessage('');try{await action()}catch(e){setError(e instanceof Error?e.message:'操作未完成，请重试')}finally{setBusy(false)}}
 async function logout(){await run(async()=>{try{await authRequest('logout',{})}catch(e){if((e as {status?:number}).status!==401)throw e}saveSession(null,'logout');setPass('');setCode('');setMode('login')})}
 async function submit(){await run(async()=>{
  const data=await authRequest<Session>(mode==='recover'?'reset':mode==='sps'?'login':mode,mode==='sps'?{provider:'sps',username:name,password:pass}:mode==='login'?{username:name,password:pass}:{username:name,password:pass,email:address,...(mode==='register'?{club}:{code})});
  rememberLogin(data,name,pass,remember);setPass('');setCode('');setAddress(data.user.email);
 })}
 if(session?.user.emailVerified&&!checking&&!checkFailed)return <>{error&&<div className="auth-global-error" role="alert">{error}</div>}{children(session.user,()=>void logout())}</>;
 return <main className="auth-page"><a className="auth-brand" href="#"><CalendarDays size={28}/>物院社团预约</a><section className="auth-card" aria-labelledby="auth-title">
  {checking?<><h1 id="auth-title">正在恢复登录</h1><p>正在确认账号信息…</p></>:session&&checkFailed?<><h1 id="auth-title">暂时无法连接</h1><p role="alert">{error}</p><button className="primary auth-submit" onClick={()=>setRetry(n=>n+1)}>重试</button><button className="auth-link" onClick={()=>{saveSession(null,'logout');setError('')}}>退出此账号</button></>:session?.user.id.startsWith('sps:')?<><h1>验证日程邮箱</h1><p>{session.user.username} · SPS</p><p>请在 SPS 日程的账号设置中验证邮箱，再从日历进入预约网站。</p><a className="auth-link" href="https://sps-club-schedule.github.io/sps-club-schedule/#/account" target="_blank" rel="noopener noreferrer">打开日程账号设置</a><button className="auth-link" onClick={()=>void logout()}>返回登录</button></>:session?<>
   <h1 id="auth-title">验证你的邮箱</h1><p>{session.user.username} · {session.user.club}</p><p>输入邮件中的 6 位验证码，验证后即可查看课程和预约。</p>
   <form onSubmit={e=>{e.preventDefault();void run(async()=>{const data=await authRequest('verify',{code});saveSession({...session,user:data.user});setCode('')})}}>
    <label htmlFor="verify-email">邮箱</label><input id="verify-email" type="email" value={address||session.user.email} onChange={e=>setAddress(e.target.value)} autoComplete="email" required/>
    <label htmlFor="verify-code">验证码</label><input id="verify-code" value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required/>
    <button className="primary auth-submit" disabled={busy}>{busy?'正在验证…':'验证邮箱'}</button>
   </form>
   <button className="auth-link" disabled={busy} onClick={()=>void run(async()=>{const data=await authRequest('resend',{email:address||session.user.email});saveSession({...session,user:data.user});setMessage('验证码已安排发送，请检查邮箱；再次发送需间隔一分钟。')})}>重新发送验证码 / 更新邮箱</button>
   <button className="auth-link" disabled={busy} onClick={()=>void logout()}><LogOut size={14}/>退出登录</button>
  </>:<>
   <h1 id="auth-title">{mode==='sps'?'SPS 日程账号登录':mode==='login'?'登录':mode==='register'?'注册账号':'找回密码'}</h1>
   <p>{mode==='sps'?'使用 SPS 在籍成员或管理员的日程用户名和密码。':mode==='login'?'登录后查看课程和社团活动，管理本社团预约。':mode==='register'?'选择所属社团，填写账号与邮箱。':'使用注册时验证的邮箱重设密码。'}</p>
   <div className="auth-tabs"><button aria-pressed={mode==='login'||mode==='sps'} onClick={()=>switchMode('login')} disabled={busy}>登录</button><button aria-pressed={mode==='register'} onClick={()=>switchMode('register')} disabled={busy}>注册</button></div>
   <form onSubmit={e=>{e.preventDefault();void submit()}}>
    {mode==='register'&&<><label htmlFor="auth-club">所属社团</label><select id="auth-club" value={club} onChange={e=>setClub(e.target.value)} required><option value="">请选择社团</option>{CLUBS.map(c=><option key={c}>{c}</option>)}</select><small>注册后按此社团管理预约。</small></>}
    <label htmlFor="auth-name">用户名</label><input id="auth-name" value={name} onChange={e=>setName(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9_]{3,30}" minLength={3} maxLength={30} required/>
    {(mode==='register'||mode==='recover')&&<><label htmlFor="auth-email">邮箱</label><input id="auth-email" type="email" value={address} onChange={e=>setAddress(e.target.value)} autoComplete="email" maxLength={254} required/></>}
    {mode==='recover'&&<><button type="button" className="auth-link" disabled={busy||!name||!address} onClick={()=>void run(async()=>{const data=await authRequest('reset-request',{username:name,email:address});setMessage(data.message)})}>发送重设验证码</button><label htmlFor="reset-code">验证码</label><input id="reset-code" value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required/></>}
    <label htmlFor="auth-password">{mode==='recover'?'新密码':'密码'}</label><input id="auth-password" type="password" value={pass} onChange={e=>setPass(e.target.value)} autoComplete={mode==='login'||mode==='sps'?'current-password':'new-password'} minLength={10} maxLength={128} required/>
    {(mode==='register'||mode==='recover')&&<small>用户名 3–30 位字母、数字或下划线；密码至少 10 个字符。</small>}
    {native&&<label className="auth-remember"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>在此手机保存密码，下次自动登录</label>}
    <button className="primary auth-submit" disabled={busy}>{busy?'请稍候…':mode==='sps'?'使用日程账号登录':mode==='login'?'登录':mode==='register'?'注册并验证邮箱':'重设密码并登录'}</button>
   </form>
   {mode==='login'&&<button className="auth-link" disabled={busy} onClick={()=>switchMode('sps')}>使用 SPS 日程账号登录</button>}
   {mode==='sps'&&<button className="auth-link" disabled={busy} onClick={()=>switchMode('login')}>使用预约网站账号登录</button>}
   {mode==='login'&&<button className="auth-link" disabled={busy} onClick={()=>switchMode('recover')}>忘记密码</button>}
  </>}
  {!checking&&error&&!checkFailed&&<p className="auth-error" role="alert">{error}</p>}{message&&<p className="auth-message" role="status">{message}</p>}
 </section><p className="auth-footnote">物院社团预约 · 课程与社团共享日历</p></main>;
}
