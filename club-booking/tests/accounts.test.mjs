import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {today,addDays} from '../app/schedule.ts';
import {mailBindings,outboundService,sent,verifiedSession,waitFor} from './auth-fixture.mjs';
const bundle=await build({entryPoints:['worker/cloudflare.ts'],bundle:true,write:false,format:'esm',platform:'node',external:['cloudflare:workers']});
const origin='https://sps-club-schedule.github.io';
const options={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],durableObjects:{BOOKINGS:{className:'BookingState',useSQLite:true}},bindings:{...mailBindings,ALLOWED_ORIGINS:origin,FRONTEND_URL:origin+'/sysu-phy-club-booking/',MIGRATION_TOKEN:'test-only-seed'},outboundService};
const request=(mf,path,body,token,method=body===undefined?'GET':'POST')=>mf.dispatchFetch('https://booking.test'+path,{method,headers:{origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});

test('queued verification survives restart and retries with identical payload and idempotency key',{timeout:30000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'booking-mail-retry-')),attempts=[];
 let mf=new Miniflare({...options,durableObjectsPersist:directory,outboundService:async req=>{
  attempts.push({key:req.headers.get('Idempotency-Key'),body:await req.text()});
  return Response.json({error:'Temporary outage'},{status:503});
 }});
 try{
  const response=await request(mf,'/api/auth/register',{username:'retry_user',password:'Fictional-password-123',email:'retry@example.test',club:'SPS'});
  assert.equal(response.status,200);const session=(await response.json()).data;
  await waitFor(()=>attempts.length===1);await mf.dispose();
  mf=new Miniflare({...options,durableObjectsPersist:directory,outboundService:async req=>{
   attempts.push({key:req.headers.get('Idempotency-Key'),body:await req.text()});return Response.json({id:'test-only'});
  }});
  await request(mf,'/api/auth/me',undefined,session.token);
  await waitFor(()=>attempts.length===2);assert.deepEqual(attempts[0],attempts[1]);
  const code=JSON.parse(attempts[1].body).text.match(/验证码为：(\d{6})/)[1];
  assert.equal((await request(mf,'/api/auth/verify',{code},session.token)).status,200);
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true})}
});

test('accounts, verified email, club ownership, one-use websocket tickets, reset and logout',{timeout:60000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'booking-auth-'));let mf=new Miniflare({...options,durableObjectsPersist:directory});
 try{
  const seed={revision:4,state:{bookings:[],curriculum:{version:1,timetables:[]}}};
  assert.equal((await request(mf,'/__migration',seed,'test-only-seed')).status,201);
  assert.equal((await request(mf,'/api/bookings')).status,401);
  assert.equal((await request(mf,'/api/curriculum')).status,401);
  assert.equal((await request(mf,'/api/bookings/')).status,401);
  assert.equal((await request(mf,'/api/curriculum/')).status,401);
  assert.equal((await request(mf,'/api/bookings/',{club:'SPS'})).status,401);
  assert.equal((await request(mf,'/api/activities')).status,200);
  const preflight=await mf.dispatchFetch('https://booking.test/api/auth/login',{method:'OPTIONS',headers:{origin,'Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/Authorization/);
  const a=await verifiedSession(mf,origin,'SPS'),b=await verifiedSession(mf,origin,'torchwood');
  assert.equal((await request(mf,'/api/auth/register',{username:a.username,password:a.password,email:a.email,club:'SPS'})).status,409);
  assert.equal((await request(mf,'/api/auth/login',{username:a.username,password:'Wrong-password-123'})).status,401);
  const me=await (await request(mf,'/api/auth/me',undefined,a.token)).json();assert.equal(me.data.user.club,'SPS');assert.equal(me.data.user.emailVerified,true);assert.ok(!JSON.stringify(me).includes('token_hash'));
  const booking={club:'SPS',activity:'Test booking',location:'Test room',date:addDays(today(),1),start:'08:00',end:'09:00'};
  const create=await request(mf,'/api/bookings',booking,a.token);assert.equal(create.status,201);const created=await create.json();
  await waitFor(()=>sent.some(m=>m.to[0]===a.email&&m.subject.includes('预约成功')));
  const peer=await verifiedSession(mf,origin,'SPS');
  const shared=await (await request(mf,'/api/bookings',{...booking,start:'10:10',end:'11:50'},a.token)).json();
  assert.equal((await request(mf,'/api/bookings',{id:shared.id,confirmed:true},peer.token,'DELETE')).status,200);
  await waitFor(()=>sent.some(m=>m.to[0]===peer.email&&m.subject.includes('预约已取消')));
  assert.ok(!sent.some(m=>m.to[0]===b.email&&/预约成功|预约已取消/.test(m.subject)));
  assert.equal((await request(mf,'/api/bookings',booking,b.token)).status,403);
  assert.equal((await request(mf,'/api/bookings/',booking,b.token)).status,403);
  assert.equal((await request(mf,'/api/bookings',{id:created.id,confirmed:true},b.token,'DELETE')).status,403);
  const publicData=await (await request(mf,'/api/bookings',undefined,b.token)).text();assert.ok(!publicData.includes(a.email));assert.ok(!publicData.includes(a.username));
  const ticket=await (await request(mf,'/api/auth/live-ticket',{},a.token)).json();
  const websocket=()=>mf.dispatchFetch('https://booking.test/api/updates?ticket='+ticket.data.ticket,{headers:{origin,upgrade:'websocket'}});
  const live=await websocket();assert.equal(live.status,101);live.webSocket.accept();assert.equal((await websocket()).status,401);
  assert.equal((await request(mf,'/api/auth/reset-request',{username:a.username,email:a.email})).status,200);
  await waitFor(()=>sent.some(m=>m.to[0]===a.email&&m.subject.includes('重设密码')));
  const code=sent.find(m=>m.to[0]===a.email&&m.subject.includes('重设密码')).text.match(/验证码为：(\d{6})/)[1];
  assert.equal((await request(mf,'/api/auth/reset',{username:a.username,email:a.email,code:'000000',password:'Changed-password-123'})).status,400);
  const reset=await request(mf,'/api/auth/reset',{username:a.username,email:a.email,code,password:'Changed-password-123'});assert.equal(reset.status,200);const next=(await reset.json()).data;
  assert.equal((await request(mf,'/api/bookings',undefined,a.token)).status,401);
  assert.equal((await request(mf,'/api/auth/reset',{username:a.username,email:a.email,code,password:'Another-password-123'})).status,400);
  assert.equal((await request(mf,'/api/auth/login',{username:a.username,password:a.password})).status,401);
  await mf.dispose();mf=new Miniflare({...options,durableObjectsPersist:directory});
  assert.equal((await request(mf,'/api/bookings',undefined,next.token)).status,200);
  assert.equal((await request(mf,'/api/bookings',{id:created.id,confirmed:true},next.token,'DELETE')).status,200);
  assert.equal((await request(mf,'/api/auth/logout',{},next.token)).status,200);
  assert.equal((await request(mf,'/api/auth/me',undefined,next.token)).status,401);
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true})}
});

test('unverified accounts cannot read shared data, email changes keep verification bound, no mail without config',{timeout:30000},async()=>{
 const mf=new Miniflare(options);
 try{
  const payload={username:'pending_user',email:'pending@example.test',password:'Test-password-123',club:'学生会'};
  const create=await request(mf,'/api/auth/register',payload);assert.equal(create.status,200);const session=(await create.json()).data;
  assert.equal((await request(mf,'/api/bookings',undefined,session.token)).status,403);
  assert.equal((await request(mf,'/api/auth/live-ticket',{},session.token)).status,403);
  for(let i=0;i<5;i++)assert.equal((await request(mf,'/api/auth/verify',{code:'000000'},session.token)).status,400);
  await waitFor(()=>sent.some(m=>m.to[0]===payload.email));
  const code=sent.find(m=>m.to[0]===payload.email).text.match(/验证码为：(\d{6})/)[1];
  assert.equal((await request(mf,'/api/auth/verify',{code},session.token)).status,400);
  assert.equal((await request(mf,'/api/auth/resend',{email:'changed@example.test'},session.token)).status,429);
  assert.equal((await (await request(mf,'/api/auth/me',undefined,session.token)).json()).data.user.email,payload.email);
  await mf.setOptions({...options,bindings:{...options.bindings,RESEND_API_KEY:''}});
  assert.equal((await request(mf,'/api/auth/register',{...payload,username:'other_user',email:'other@example.test'})).status,503);
 }finally{await mf.dispose()}
});
