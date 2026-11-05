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
  assert.ok(!sent.some(m=>m.to[0]===a.email&&m.subject.includes('预约成功')));
  const peer=await verifiedSession(mf,origin,'SPS');
  const shared=await (await request(mf,'/api/bookings',{...booking,start:'10:10',end:'11:50'},a.token)).json();
  assert.equal((await request(mf,'/api/bookings',{id:shared.id,confirmed:true},peer.token,'DELETE')).status,200);
  await waitFor(()=>sent.some(m=>m.to[0]===a.email&&m.subject.includes('预约已取消')));
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
  assert.equal((await request(mf,'/api/auth/club-contact',undefined,session.token)).status,403);
  assert.equal((await request(mf,'/api/auth/club-contact',{email:'example@example.test'},session.token)).status,403);
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

test('committed bookings notify the appropriate owners and club contacts once per inbox', {timeout:60000}, async () => {
 const mf = new Miniflare({...options, bindings: {...options.bindings, SPS_CLUB_ID:'test-club', SPS_SYNC_KEY:'test-sync'}});
 const startIndex = sent.length;
 const day = addDays(today(),1);
 const booking = (club, activity, start='14:00', end='15:00') => ({club, activity, start, end, date:day, location:'测试活动室'});
 const legacyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const legacy = {...booking('学生会','历史活动','20:00','21:00'), id:legacyId};
 const contactPath = '/api/auth/club-contact';
 const post = (who, data) => request(mf,'/api/bookings',data,who.token);
 const cancel = (who,id) => request(mf,'/api/bookings',{id,confirmed:true},who.token,'DELETE');
 const setLead = (who,email,extra={}) => request(mf,contactPath,{email,...extra},who.token);
 const leadOf = async who => (await (await request(mf,contactPath,undefined,who.token)).json()).data.email;
 const received = title => sent.slice(startIndex).filter(m=>m.subject.endsWith(' · '+title));
 const assertTo = (title,addresses) => assert.deepEqual(received(title).map(m=>{assert.equal(m.to.length,1);return m.to[0]}).sort(), [...addresses].sort(),title);
 try {
  assert.equal((await request(mf,'/__migration',{revision:1,state:{bookings:[legacy],curriculum:{version:1,timetables:[]}}},'test-only-seed')).status,201);
  const original = await verifiedSession(mf,origin,'学生会'), peer = await verifiedSession(mf,origin,'学生会');
  const incoming = await verifiedSession(mf,origin,'torchwood'), sps = await verifiedSession(mf,origin,'SPS');
  assert.equal((await request(mf,contactPath)).status,401);
  assert.equal(await leadOf(original),null);
  assert.equal((await setLead(peer,'invalid')).status,400);
  assert.equal((await setLead(peer,'wrong@example.test',{club:incoming.user.club})).status,403);
  const lead = 'director@example.test';
  assert.equal((await setLead(peer,lead.toUpperCase(),{previousEmail:null})).status,200);
  assert.equal(await leadOf(original),lead);
  assert.equal(await leadOf(incoming),null);
  assert.equal((await setLead(original,'stale@example.test',{previousEmail:null})).status,409);
  assert.equal((await setLead(incoming,incoming.email)).status,200);
  const first = await (await post(original,booking('学生会','先预约'))).json();
  const later = await (await post(original,booking('学生会','第二场','15:00','16:00'))).json();
  await waitFor(()=>received('第二场').length>0);
  assertTo('先预约',[lead]);
  const newBooking=booking('torchwood','两场冲突','14:30','15:30');
  assert.equal((await post(incoming,newBooking)).status,409);
  assert.equal((await post(incoming,{...newBooking,accepted:[first.id]})).status,409);
  assert.equal((await post(original,booking('学生会','同社团冲突'))).status,409);
  assert.equal((await post(incoming,{...newBooking,accepted:[first.id,later.id]})).status,201);
  await waitFor(()=>received('两场冲突').length>=3);
  assertTo('两场冲突',[original.email,lead,incoming.email]);
  for(const mail of received('两场冲突')){
   for(const token of [incoming.username,'torchwood','两场冲突','14:30–15:30','先预约','第二场',day,'协商'])assert.ok(mail.text.includes(token),token);
  }
  assert.equal((await cancel(peer,first.id)).status,200);
  assert.equal((await cancel(peer,first.id)).status,200);
  await waitFor(()=>received('先预约').length>=3);
  const cancelled = received('先预约').filter(m=>m.subject.includes('已取消'));
  assert.deepEqual(cancelled.map(m=>m.to[0]).sort(),[original.email,lead].sort());
  assert.ok(cancelled.every(m=>m.text.includes(peer.username)&&m.text.includes(day)&&m.text.includes('14:00–15:00')));
  assert.equal((await cancel(original,later.id)).status,200);
  assert.equal((await cancel(peer,legacy.id)).status,200);
  const noSuccess = await post(incoming,booking('torchwood','负责人本人预约','18:00','19:00')); assert.equal(noSuccess.status,201);
  // A lead who also owns a conflicting booking receives only one copy, even if both clubs share the address.
  assert.equal((await setLead(peer,original.email)).status,200);
  assert.equal((await setLead(sps,original.email)).status,200);
  const shadow = booking('学生会','同步冲突原预约','08:00','09:00');
  assert.equal((await post(original,shadow)).status,201);
  const sync = {sourceId:'test-club',version:1,events:[{id:'t_'+'1'.repeat(32),title:'同步来访',location:'测试活动室',startsAt:Date.parse(day+'T08:30:00+08:00'),endsAt:Date.parse(day+'T09:30:00+08:00')}]};
  for(const version of [1,1,2])assert.equal((await request(mf,'/api/integrations/sps',{...sync,version},'test-sync','PUT')).status,200);
  await waitFor(()=>received('同步来访').length>0);
  assertTo('同步来访',[original.email]);assert.ok(received('同步来访')[0].text.includes('SPS 日程同步'));
  assertTo('负责人本人预约',[]);assertTo('同社团冲突',[]);assertTo('同步冲突原预约',[]);assertTo('历史活动',[lead]);
  assertTo('第二场',[lead,lead]);assert.ok(received('第二场').some(m=>m.subject.includes('已取消')));
  assertTo('两场冲突',[original.email,lead,incoming.email]);
  const publicBody=await (await request(mf,'/api/activities')).text();assert.ok(!publicBody.includes('@'));assert.ok(!publicBody.includes(incoming.username));
 } finally { await mf.dispose(); }
});

test('SPS identity is separate from a colliding local username and email; revocation stops an existing session', {timeout:30000}, async()=>{
 const id='a'.repeat(64);
 let active=true, revision=1,entryUsed=false;
 const calls=[];
 let identity;
 const member=new Miniflare({...options,bindings:{...options.bindings,SPS_SYNC_KEY:'fixture-key'},outboundService:async req=>{
     if(req.url==='https://api.resend.com/emails')return outboundService(req);
     assert.equal(req.url,'https://sps-club-api.sysu-physics-clubs.workers.dev/integrations/booking/identity');
     assert.equal(req.headers.get('authorization'),'Bearer fixture-key');
     const body=await req.json();calls.push(body.operation);
     if(!active)return Response.json({}, {status:403});
     if(body.operation==='login' && body.password!=='Sps-only-password!') return Response.json({}, {status:401});
     if(body.operation==='redeem'){if(entryUsed)return Response.json({},{status:401});entryUsed=true}
     const external={id,username:identity.username,verifiedEmail:identity.email,revision};
     return Response.json({ok:true,data:body.operation==='preview'?{username:external.username}:external});
   }});
 try {
   identity=await verifiedSession(member,origin,'torchwood');
   const manual=async(provider,password)=>request(member,'/api/auth/login',{provider,username:identity.username,password});
   const login=await manual('sps','Sps-only-password!');assert.equal(login.status,200,login.ok?'':(await login.clone().text())+' '+JSON.stringify(calls));
   const session=(await login.json()).data;assert.equal(session.user.id,'sps:'+id);assert.equal(session.user.club,'SPS');assert.ok(session.user.emailVerified);assert.equal(session.user.email,identity.email);
   const local=await manual('local',identity.password);assert.equal((await local.json()).data.user.club,'torchwood');
   assert.equal((await manual('local','Sps-only-password!')).status,401);
   assert.equal((await manual('sps',identity.password)).status,401);
   assert.equal((await request(member,'/api/auth/club-contact',{email:'sps-lead@example.test'},session.token)).status,200);
   const entry=await request(member,'/api/auth/sps-entry',{code:'b'.repeat(64)});assert.equal(entry.status,200);
   const second=(await entry.json()).data;assert.equal(second.user.id,session.user.id);
   assert.equal((await request(member,'/api/auth/sps-entry',{code:'b'.repeat(64)})).status,401);
   revision++;assert.equal((await request(member,'/api/auth/me',undefined,session.token)).status,401);
   const fresh=(await (await manual('sps','Sps-only-password!')).json()).data;
   active=false;
   assert.equal((await request(member,'/api/bookings',undefined,fresh.token)).status,401);
   assert.equal((await request(member,'/api/auth/live-ticket',{},fresh.token)).status,401);
   assert.equal((await request(member,'/api/auth/me',undefined,identity.token)).status,200);
   assert.ok(calls.includes('check'));
 } finally { await member.dispose(); }
});
