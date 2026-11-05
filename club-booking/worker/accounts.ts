import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { CLUBS } from '../app/schedule';
import { IdentityError, scheduleIdentity, type SpsIdentity } from './sps-login';
import { BookingNotifications } from './booking-notifications';

export type AccountUser = {id:string;username:string;club:string;email:string;emailVerified:boolean};
export type AccountEnv = {SPS_SYNC_KEY?:string;RESEND_API_KEY?:string;EMAIL_FROM?:string;EMAIL_ENABLED?:string;FRONTEND_URL:string};
type Profile = {id:string;username:string;club:string;email:string;verified:number};
type Row = Profile & {salt:string;password_hash:string};
type Session = {token_hash:string;account_id:string;expires_at:number};
type Challenge = {id:string;account_id:string;kind:string;code_hash:string;expires_at:number;attempts:number;created_at:number};
type Job = {id:string;payload:string;expires_at:number;attempts:number;next_at:number;created_at:number};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('hex');
const digest=(password:string,salt:string)=>scryptSync(password,salt,32,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex');
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const DAY=86400000;
export class AccountError extends Error {constructor(public status:number,message:string){super(message)}}
function fail(status:number,message:string):never{throw new AccountError(status,message)}
function username(v:unknown){if(typeof v!=='string'||!/^[a-zA-Z0-9_]{3,30}$/.test(v))fail(400,'用户名须为 3–30 位字母、数字或下划线');return v.toLowerCase()}
function password(v:unknown){if(typeof v!=='string'||v.length<10||v.length>128)fail(400,'密码须为 10–128 个字符');return v}
function email(v:unknown){if(typeof v!=='string'||v.length>254||! /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(v.trim()))fail(400,'请填写有效的邮箱地址');return v.trim().toLowerCase()}
const publicUser=(r:Profile):AccountUser=>({id:r.id,username:r.username,club:r.club,email:r.email,emailVerified:!!r.verified});
export async function jsonBody(request:Request,max=8192):Promise<Record<string,unknown>>{
 if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))fail(400,'请使用 JSON 请求');
 const reader=request.body?.getReader();if(!reader)fail(400,'请求内容为空');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail(413,'请求内容过长')}chunks.push(value)}
 try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value}catch{return fail(400,'请求内容无效')}
}

export class Accounts {
 readonly notifications: BookingNotifications;
 private sql:SqlStorage;
 constructor(private ctx:DurableObjectState,private env:AccountEnv){
  this.sql=ctx.storage.sql;
  this.sql.exec(`CREATE TABLE IF NOT EXISTS booking_accounts (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, club TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS booking_sps_accounts (id TEXT PRIMARY KEY,username TEXT NOT NULL,email TEXT NOT NULL,verified INTEGER NOT NULL,revision INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS booking_sessions (token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS booking_sessions_account ON booking_sessions(account_id);
   CREATE TABLE IF NOT EXISTS booking_auth_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS booking_challenges (id TEXT PRIMARY KEY,account_id TEXT NOT NULL,kind TEXT NOT NULL,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,UNIQUE(account_id,kind));
   CREATE TABLE IF NOT EXISTS booking_tickets (ticket_hash TEXT PRIMARY KEY,token_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS booking_mail (id TEXT PRIMARY KEY,payload TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS booking_mail_usage (day INTEGER PRIMARY KEY,used INTEGER NOT NULL);`);
  this.notifications = new BookingNotifications(this.sql, env);
 }
 configured(){return !!this.env.RESEND_API_KEY&&!!this.env.EMAIL_FROM&&this.env.EMAIL_ENABLED==='true'}
 limit(key:string,max:number,window:number){
  const now=Date.now(),keyHash=hash(key);
  this.sql.exec('DELETE FROM booking_auth_limits WHERE expires_at<=?',now);
  const row=this.sql.exec<{count:number;expires_at:number}>('SELECT count,expires_at FROM booking_auth_limits WHERE key=?',keyHash).toArray()[0];
  if(row&&row.count>=max)fail(429,'尝试过于频繁，请稍后再试');
  this.sql.exec('INSERT INTO booking_auth_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1',keyHash,1,now+window);
 }
 private account(id:string):Profile | undefined {
  if (id.startsWith('sps:')) return this.sql.exec<Profile>("SELECT id,username,'SPS' AS club,email,verified FROM booking_sps_accounts WHERE id=?",id).toArray()[0];
  return this.sql.exec<Row>('SELECT * FROM booking_accounts WHERE id=?',id).toArray()[0];
 }
 private saveSpsIdentity(identity:SpsIdentity, requireExistingSession=false) {
  const id='sps:'+identity.id, address=identity.verifiedEmail.toLowerCase();
  const previous=this.sql.exec<{revision:number}>('SELECT revision FROM booking_sps_accounts WHERE id=?',id).toArray()[0];
  if (previous && previous.revision!==identity.revision) {
   if (previous.revision>identity.revision) fail(401,'日程账号已更新，请重新登录');
   this.sql.exec('DELETE FROM booking_sessions WHERE account_id=?',id);
   if (requireExistingSession) fail(401,'日程账号已更新，请重新登录');
  }
  const verified=address ? 1 : 0;
  this.sql.exec('INSERT INTO booking_sps_accounts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,email=excluded.email,verified=excluded.verified,revision=excluded.revision',id,identity.username,address,verified,identity.revision);
  return {id,username:identity.username,club:'SPS',email:address,verified};
 }
 async currentSession(request:Request, verified=false) {
  const auth=this.authenticate(request);
  if (auth.user.id.startsWith('sps:')) {
   try {
    const profile=await scheduleIdentity(this.env.SPS_SYNC_KEY,{operation:'check',id:auth.user.id.slice(4)});
    this.saveSpsIdentity(profile,true);
   } catch (e) {
    if (e instanceof IdentityError && (e.status===401 || e.status===403)) {
     this.sql.exec('DELETE FROM booking_sessions WHERE account_id=?',auth.user.id);
     fail(401,'当前日程账号已无 SPS 预约权限，请重新登录');
    }
    throw e;
   }
  }
  return this.authenticate(request,verified);
 }
 private session(row:Profile){
  const now=Date.now(),token=random(),expiresAt=now+7*DAY;
  this.sql.exec('DELETE FROM booking_sessions WHERE expires_at<=?',now);
  // Bound remembered sessions per account without invalidating ordinary reloads.
  this.sql.exec('DELETE FROM booking_sessions WHERE account_id=? AND token_hash NOT IN (SELECT token_hash FROM booking_sessions WHERE account_id=? ORDER BY expires_at DESC LIMIT 9)',row.id,row.id);
  this.sql.exec('INSERT INTO booking_sessions VALUES(?,?,?)',hash(token),row.id,expiresAt);
  return {token,expiresAt,user:publicUser(row)};
 }
 tokenValid(tokenHash:string){const s=this.sql.exec<Session>('SELECT * FROM booking_sessions WHERE token_hash=?',tokenHash).toArray()[0];return !!s&&s.expires_at>Date.now()}
 authenticate(request:Request,verified=false){
  const bearer=request.headers.get('authorization')||'';
  if(!/^Bearer [a-f0-9]{64}$/.test(bearer))fail(401,'请先登录');
  const tokenHash=hash(bearer.slice(7));
  const session=this.sql.exec<Session>('SELECT * FROM booking_sessions WHERE token_hash=?',tokenHash).toArray()[0];
  if(!session||session.expires_at<=Date.now())fail(401,'登录已过期，请重新登录');
  const row=this.account(session.account_id);if(!row)fail(401,'请重新登录');
  if(verified&&!row.verified)fail(403,'请先验证邮箱');
  return {user:publicUser(row),tokenHash,expiresAt:session.expires_at};
 }
 takeTicket(ticket:string|null){
  if(!ticket||!/^[a-f0-9]{64}$/.test(ticket))fail(401,'请先登录');
  const row=this.sql.exec<{token_hash:string;expires_at:number}>('DELETE FROM booking_tickets WHERE ticket_hash=? RETURNING token_hash,expires_at',hash(ticket)).toArray()[0];
  if(!row||row.expires_at<=Date.now()||!this.tokenValid(row.token_hash))fail(401,'实时连接凭证已过期');
  return row.token_hash;
 }
 private challenge(row:Profile,kind:'verify'|'reset'){
  if(!this.configured())fail(503,'邮件服务暂时不可用，请稍后再试');
  this.limit('email-account:'+row.id,5,3600000);this.limit('email-target:'+row.email,5,3600000);
  const old=this.sql.exec<Challenge>('SELECT * FROM booking_challenges WHERE account_id=? AND kind=?',row.id,kind).toArray()[0];
  if(old&&Date.now()-old.created_at<60000)fail(429,'请等待一分钟后再发送验证码');
  const id=random(),code=String(randomInt(100000,1000000)),now=Date.now(),expiry=now+15*60000;
  const purpose=kind==='verify'?'验证邮箱':'重设密码';
  const text=`你正在${purpose}，验证码为：${code}\n\n用户名：${row.username}\n验证码 15 分钟内有效，请在网站或 App 内输入。若非本人操作，请忽略本邮件。\n\n物院社团预约\n${this.env.FRONTEND_URL}`;
  this.sql.exec('DELETE FROM booking_mail WHERE id IN (SELECT id FROM booking_challenges WHERE account_id=? AND kind=?)',row.id,kind);
  this.sql.exec('INSERT INTO booking_challenges VALUES(?,?,?,?,?,0,?) ON CONFLICT(account_id,kind) DO UPDATE SET id=excluded.id,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,created_at=excluded.created_at',id,row.id,kind,hash(id+':'+code),expiry,now);
  this.sql.exec('INSERT INTO booking_mail(id,payload,expires_at,next_at,created_at) VALUES(?,?,?,?,?)',id,JSON.stringify({from:this.env.EMAIL_FROM,to:[row.email],subject:`[物院社团预约] ${purpose}验证码`,text}),expiry,now,now);
 }
 private checkCode(row:Profile,kind:string,code:unknown){
  const c=this.sql.exec<Challenge>('SELECT * FROM booking_challenges WHERE account_id=? AND kind=?',row.id,kind).toArray()[0];
  if(!c||c.expires_at<=Date.now()||c.attempts>=5)fail(400,'验证码错误或已过期，请重新发送');
  this.sql.exec('UPDATE booking_challenges SET attempts=attempts+1 WHERE id=?',c.id);
  if(typeof code!=='string'||!/^\d{6}$/.test(code)||!equal(hash(c.id+':'+code),c.code_hash))fail(400,'验证码错误或已过期');
  this.sql.exec('DELETE FROM booking_challenges WHERE id=?',c.id);this.sql.exec('DELETE FROM booking_mail WHERE id=?',c.id);
 }
 async handle(request:Request){
  const path=new URL(request.url).pathname.replace('/api/auth/','');
  if(path==='config'&&request.method==='GET')return {clubs:CLUBS,emailEnabled:this.configured()};
  if(path==='me'&&request.method==='GET'){const {user,expiresAt}=await this.currentSession(request);return {user,expiresAt}}
  if (path === 'club-contact' && request.method === 'GET') {
   const {user} = await this.currentSession(request, true);
   return {email: this.notifications.contact(user.club)};
  }
  if(request.method!=='POST')fail(405,'不支持的操作');
  const data=await jsonBody(request),ip=request.headers.get('cf-connecting-ip')||'local';
  this.limit('ip:'+ip,100,15*60000);
  if(path==='register'){
   const name=username(data.username),pass=password(data.password),address=email(data.email);
   if(typeof data.club!=='string'||!CLUBS.includes(data.club))fail(400,'请选择所属社团');
   if(!this.configured())fail(503,'邮件服务暂时不可用，请稍后再注册');
   this.limit('register:'+ip,15,3600000);
   if(this.sql.exec('SELECT id FROM booking_accounts WHERE username=? OR email=?',name,address).toArray().length)fail(409,'用户名或邮箱已被注册，请登录或找回密码');
   const salt=random(),row:Row={id:random(),username:name,club:data.club,email:address,verified:0,salt,password_hash:digest(pass,salt)};
   return this.ctx.storage.transactionSync(()=>{
    this.sql.exec('INSERT INTO booking_accounts VALUES(?,?,?,?,?,?,?,?)',row.id,name,row.club,address,0,salt,row.password_hash,Date.now());
    this.challenge(row,'verify');return this.session(row);
   });
  }
  if (path==='sps-entry' || path==='sps-preview') {
   if (typeof data.code!=='string' || !/^[a-f0-9]{64}$/.test(data.code)) fail(400,'跳转凭证无效，请从日历重新打开');
   const profile=await scheduleIdentity(this.env.SPS_SYNC_KEY,{operation:path==='sps-entry'?'redeem':'preview',code:data.code});
   if (path==='sps-preview') return {username:profile.username};
   return this.ctx.storage.transactionSync(()=>this.session(this.saveSpsIdentity(profile)));
  }
  if (path==='login' && data.provider==='sps') {
   const name=username(data.username), pass=password(data.password);
   this.limit('sps-login:'+name,10,15*60000);
   const profile=await scheduleIdentity(this.env.SPS_SYNC_KEY,{operation:'login',username:name,password:pass});
   this.sql.exec('DELETE FROM booking_auth_limits WHERE key=?',hash('sps-login:'+name));
   return this.ctx.storage.transactionSync(()=>this.session(this.saveSpsIdentity(profile)));
  }
  if(path==='login'){
   const name=username(data.username),pass=password(data.password);this.limit('login:'+name,10,15*60000);
   const row=this.sql.exec<Row>('SELECT * FROM booking_accounts WHERE username=?',name).toArray()[0];
   const computed=digest(pass,row?.salt||'0'.repeat(64));
   if(!row||!equal(computed,row.password_hash))fail(401,'用户名或密码不正确');
   this.sql.exec('DELETE FROM booking_auth_limits WHERE key=?',hash('login:'+name));return this.session(row);
  }
  if(path==='reset-request'){
   const name=username(data.username),address=email(data.email);this.limit('reset:'+name,5,3600000);
   const row=this.sql.exec<Row>('SELECT * FROM booking_accounts WHERE username=? AND email=?',name,address).toArray()[0];
   if(!this.configured())fail(503,'邮件服务暂时不可用，请稍后再试');
   if(row?.verified)this.challenge(row,'reset');
   return {message:'如果用户名与已验证邮箱匹配，验证码会发送到该邮箱。'};
  }
  if(path==='reset'){
   const name=username(data.username),address=email(data.email),pass=password(data.password);this.limit('reset-code:'+name,10,15*60000);
   const row=this.sql.exec<Row>('SELECT * FROM booking_accounts WHERE username=? AND email=?',name,address).toArray()[0];
   if(!row||!row.verified)fail(400,'验证码错误或已过期');
   this.checkCode(row,'reset',data.code);
   const salt=random(),next=digest(pass,salt);
   return this.ctx.storage.transactionSync(()=>{
    this.sql.exec('UPDATE booking_accounts SET salt=?,password_hash=? WHERE id=?',salt,next,row.id);
    this.sql.exec('DELETE FROM booking_sessions WHERE account_id=?',row.id);
    return this.session(row);
   });
  }
  const auth=path==='logout'?this.authenticate(request):await this.currentSession(request),row=this.account(auth.user.id)!;
  if (row.id.startsWith('sps:') && (path==='verify' || path==='resend')) fail(403,'请在 SPS 日程的账号设置中验证邮箱');
  if (path === 'club-contact') {
   if (!row.verified) fail(403, '请先验证邮箱');
   if (data.club !== undefined && data.club !== row.club) fail(403, '只能修改本社团的负责人邮箱');
   const address = email(data.email);
   const current = this.notifications.contact(row.club);
   if (data.previousEmail !== undefined && data.previousEmail !== current) fail(409, '负责人邮箱已由其他成员更新，请重新打开后再修改');
   this.limit('club-contact:' + row.id, 15, 3600000);
   this.notifications.setContact(row.club, address);
   return {email: address};
  }
  if(path==='logout'){this.sql.exec('DELETE FROM booking_sessions WHERE token_hash=?',auth.tokenHash);return {signedOut:true}}
  if(path==='verify'){
   this.limit('verify-code:'+row.id,10,15*60000);this.checkCode(row,'verify',data.code);
   this.sql.exec('UPDATE booking_accounts SET verified=1 WHERE id=?',row.id);return {user:publicUser({...row,verified:1})};
  }
  if(path==='resend'){
   if(row.verified)return {user:publicUser(row)};
   if(data.email!==undefined){const next=email(data.email);if(next!==row.email){
    if(this.sql.exec('SELECT id FROM booking_accounts WHERE email=? AND id<>?',next,row.id).toArray().length)fail(409,'该邮箱已被使用');
    // Updating a pending email and its challenge commits together.
    return this.ctx.storage.transactionSync(()=>{this.sql.exec('UPDATE booking_accounts SET email=? WHERE id=?',next,row.id);this.challenge({...row,email:next},'verify');return {user:publicUser({...row,email:next})}});
   }}
   this.challenge(row,'verify');return {user:publicUser(row)};
  }
  if(path==='live-ticket'){
   if(!row.verified)fail(403,'请先验证邮箱');this.limit('ticket:'+row.id,120,60000);
   this.sql.exec('DELETE FROM booking_tickets WHERE expires_at<=?',Date.now());
   const ticket=random();this.sql.exec('INSERT INTO booking_tickets VALUES(?,?,?)',hash(ticket),auth.tokenHash,Date.now()+60000);return {ticket};
  }
  return fail(404,'接口不存在');
 }
 async schedule(){
  const next=this.sql.exec<{due:number}>('SELECT MIN(next_at) AS due FROM booking_mail').toArray()[0]?.due;
  if(next!=null)await this.ctx.storage.setAlarm(Math.max(Date.now()+100,next));
 }
 async pump(){
  const now=Date.now(),day=Math.floor(now/DAY);
  this.sql.exec('DELETE FROM booking_mail WHERE expires_at<=?',now);
  this.sql.exec('DELETE FROM booking_challenges WHERE expires_at<=?',now);
  this.sql.exec('DELETE FROM booking_mail_usage WHERE day<?',day-2);
  const jobs=this.sql.exec<Job>('SELECT * FROM booking_mail WHERE next_at<=? ORDER BY created_at LIMIT 3',now).toArray();
  if(!this.configured()){if(jobs.length)await this.ctx.storage.setAlarm(now+60000);return}
  for(const job of jobs){
   const used=this.sql.exec<{used:number}>('SELECT used FROM booking_mail_usage WHERE day=?',day).toArray()[0]?.used||0;
   if(used>=50){this.sql.exec('UPDATE booking_mail SET next_at=? WHERE id=?',(day+1)*DAY,job.id);continue}
   this.sql.exec('INSERT INTO booking_mail_usage VALUES(?,1) ON CONFLICT(day) DO UPDATE SET used=used+1',day);
   this.sql.exec('UPDATE booking_mail SET attempts=attempts+1,next_at=? WHERE id=?',now+Math.min(300000,10000*2**job.attempts),job.id);
   try{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+this.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'club-booking/'+job.id},body:job.payload,signal:AbortSignal.timeout(8000)});
    if(response.ok)this.sql.exec('DELETE FROM booking_mail WHERE id=?',job.id);
    else if(response.status<500&&response.status!==429&&response.status!==409){
     console.warn('Booking email rejected permanently',{status:response.status});
     this.sql.exec('DELETE FROM booking_mail WHERE id=?',job.id);
    }
   }catch{/* Durable alarm retries the same idempotent request, until code expiry. */}
  }
  await this.schedule();
 }
}
