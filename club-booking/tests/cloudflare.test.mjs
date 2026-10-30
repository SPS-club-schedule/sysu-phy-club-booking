import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { today, addDays } from '../app/schedule.ts';

const bundle = await build({entryPoints:['worker/cloudflare.ts'],bundle:true,write:false,format:'esm',platform:'node',external:['cloudflare:workers']});
const origin = 'https://sysu-phy-club-book.folderrewind.top';
const payload = {club:'SPS',activity:'migration test',location:'test',date:addDays(today(),1),start:'08:00',end:'09:00'};
const historical = {id:'1c19701e-951b-4177-8958-ef77f16b3502',...payload,date:'2026-01-01'};
const initial = {revision:34,state:{bookings:[historical],curriculum:{version:1,timetables:[]}}};
const options = {
  modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
  durableObjects:{BOOKINGS:{className:'BookingState',useSQLite:true}},
  bindings:{ALLOWED_ORIGINS:origin,MIGRATION_TOKEN:'test-only-migration-token'},
};
const request = (mf,path,method='GET',body,headers={}) => mf.dispatchFetch('https://booking.test'+path,{
  method,headers:{origin,...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),
});
const admin = {authorization:'Bearer test-only-migration-token'};
const seed = mf => request(mf,'/__migration','POST',initial,admin);

test('SQLite migration is protected, insert-only, and survives a Worker restart', async()=>{
  const directory = await mkdtemp(join(tmpdir(),'booking-do-'));
  let mf = new Miniflare({...options,durableObjectsPersist:directory});
  try {
    assert.equal((await request(mf,'/api/bookings')).status,503);
    assert.equal((await request(mf,'/__migration','POST',initial)).status,404);
    assert.equal((await request(mf,'/__migration','POST',{...initial,revision:-1},admin)).status,400);
    assert.equal((await seed(mf)).status,201);
    assert.equal((await seed(mf)).status,409);
    assert.deepEqual(await (await request(mf,'/__migration','GET',undefined,admin)).json(),initial);
    assert.deepEqual((await (await request(mf,'/api/bookings')).json()).bookings,[]);
    await mf.dispose();
    mf = new Miniflare({...options,durableObjectsPersist:directory});
    assert.deepEqual(await (await request(mf,'/__migration','GET',undefined,admin)).json(),initial);
    await mf.setOptions({...options,durableObjectsPersist:directory,bindings:{ALLOWED_ORIGINS:origin}});
    assert.equal((await request(mf,'/__migration','GET',undefined,admin)).status,404);
    assert.equal((await request(mf,'/api/bookings')).status,200);
  } finally { await mf.dispose(); await rm(directory,{recursive:true,force:true}); }
});

test('concurrent writes, conflicts, CORS, snapshots, cancellation and realtime notifications', async()=>{
  const mf = new Miniflare(options);
  try {
    await seed(mf);
    assert.equal((await request(mf,'/api/bookings','POST',payload,{origin:'https://evil.example'})).status,403);
    const preflight=await request(mf,'/api/bookings','OPTIONS',undefined,{'access-control-request-method':'POST','access-control-request-headers':'content-type'});
    assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
    assert.equal((await request(mf,'/api/curriculum','POST',{})).status,405);
    assert.equal((await request(mf,'/api/updates','GET',undefined,{upgrade:'websocket',origin:'https://evil.example'})).status,403);
    const live=await request(mf,'/api/updates','GET',undefined,{upgrade:'websocket'});
    assert.equal(live.status,101);
    const socket=live.webSocket;const messages=[];
    socket.addEventListener('message',event=>messages.push(event.data));socket.accept();
    const writes=await Promise.all([request(mf,'/api/bookings','POST',payload),request(mf,'/api/bookings','POST',payload)]);
    assert.deepEqual(writes.map(r=>r.status).sort(),[201,409]);
    const created=await writes.find(r=>r.status===201).json();
    assert.equal(created.snapshot.revision,35);
    const cross=await request(mf,'/api/bookings','POST',{...payload,club:'torchwood'});
    assert.equal(cross.status,409);
    assert.equal((await cross.json()).kind,'conflict');
    assert.equal((await request(mf,'/api/bookings','DELETE',{id:created.id})).status,400);
    const cancelled=await request(mf,'/api/bookings','DELETE',{id:created.id,confirmed:true});
    assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).snapshot.revision,36);
    // Hibernation's automatic heartbeat does not read the database.
    socket.send('ping');
    await new Promise((resolve,reject)=>{
      const until=Date.now()+3000;
      const check=()=>messages.includes('pong')&&messages.some(s=>s.includes('"revision":36'))?resolve():Date.now()>until?reject(new Error('Missing notification/heartbeat')):setTimeout(check,10);check();
    });
    const exported=await (await request(mf,'/__migration','GET',undefined,admin)).json();
    assert.deepEqual(exported.state.bookings,[historical]);
    socket.close(1000);
  } finally { await mf.dispose(); }
});
