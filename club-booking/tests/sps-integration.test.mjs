import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {today,addDays} from '../app/schedule.ts';
const helpers=await build({entryPoints:['app/sps-integration.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {spsBookings,validateSpsSnapshot}=await import('data:text/javascript;base64,'+Buffer.from(helpers.outputFiles[0].text).toString('base64'));
const sourceId='c_'+'1'.repeat(32),taskId='t_'+'2'.repeat(32),date=addDays(today(),1),at=(d,t)=>Date.parse(d+'T'+t+':00+08:00');
const snapshot={sourceId,version:5,events:[{id:taskId,title:'SPS activity',location:'',startsAt:at(date,'23:00'),endsAt:at(addDays(date,2),'00:00')}]};
test('SPS intervals split at Shanghai midnight, clip display range and preserve title/location',()=>{
  const valid=validateSpsSnapshot(snapshot,sourceId),blocks=spsBookings(valid,date,addDays(date,3));
  assert.equal(blocks.length,2);assert.deepEqual(blocks.map(b=>[b.start,b.end]),[['23:00','24:00'],['00:00','24:00']]);
  assert.equal(blocks[0].location,'未定');assert.equal(blocks[0].club,'SPS');assert.equal(blocks[0].sourceTaskId,taskId);
  assert.equal(spsBookings(valid,addDays(date,1),addDays(date,1)).length,1);
  assert.equal(spsBookings(valid,addDays(date,2),addDays(date,3)).length,0);
  for(const patch of [{sourceId:'other'},{version:-1},{events:[...snapshot.events,...snapshot.events]},{events:[{...snapshot.events[0],endsAt:0}]},{events:[{...snapshot.events[0],location:17}]}])assert.throws(()=>validateSpsSnapshot({...snapshot,...patch},sourceId));
});
test('authenticated source snapshots update atomically, ignore stale retries and preserve manual bookings/curriculum',async()=>{
  const bundle=await build({entryPoints:['worker/cloudflare.ts'],bundle:true,write:false,format:'esm',platform:'node',external:['cloudflare:workers']});
  const origin='https://sps-club-schedule.github.io',key='test-only-sync-key';
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],durableObjects:{BOOKINGS:{className:'BookingState',useSQLite:true}},bindings:{ALLOWED_ORIGINS:origin,FRONTEND_URL:origin,MIGRATION_TOKEN:'test-only-migrate',SPS_SYNC_KEY:key,SPS_CLUB_ID:sourceId}});
  const req=(path,method='GET',body,token)=>mf.dispatchFetch('https://booking.test'+path,{method,headers:{origin,...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const manual={id:'00000000-0000-4000-8000-000000000001',club:'学生会',activity:'Manual',location:'教室',date,start:'12:00',end:'13:00'};
  const curriculum={version:1,timetables:[]};
  try{
    assert.equal((await req('/__migration','POST',{revision:3,state:{bookings:[manual],curriculum}},'test-only-migrate')).status,201);
    assert.equal((await req('/api/integrations/sps','PUT',snapshot)).status,404);
    assert.equal((await req('/api/integrations/sps','PUT',{...snapshot,sourceId:'other'},key)).status,400);
    const ws=await req('/api/updates','GET');assert.equal(ws.status,426);
    const live=await mf.dispatchFetch('https://booking.test/api/updates',{headers:{origin,upgrade:'websocket'}});const socket=live.webSocket;socket.accept();let updated=false;socket.addEventListener('message',e=>{if(JSON.parse(e.data).revision>=4)updated=true});
    assert.equal((await req('/api/integrations/sps','PUT',snapshot,key)).status,200);
    let body=await (await req('/api/bookings')).json();assert.equal(body.bookings.length,3);assert.deepEqual(body.curriculum,curriculum);assert.equal(body.revision,4);
    const block=body.bookings.find(b=>b.source==='sps-schedule');assert.equal((await req('/api/bookings','DELETE',{id:block.id,confirmed:true})).status,403);
    const feed=await (await req('/api/activities')).json();assert.equal(feed.activities.length,3);assert.equal('curriculum' in feed,false);assert.equal(feed.activities[1].club,'SPS');
    const same={club:'SPS',activity:'Overlap',location:'x',date,start:'23:10',end:'23:20'};
    assert.equal((await req('/api/bookings','POST',same)).status,409);
    const cross=await req('/api/bookings','POST',{...same,club:'torchwood'});assert.equal((await cross.json()).kind,'conflict');
    assert.equal((await req('/api/bookings','POST',{...same,club:'torchwood',accepted:[block.id]})).status,201);
    const removed={...snapshot,version:6,events:[]};await req('/api/integrations/sps','PUT',removed,key);
    await req('/api/integrations/sps','PUT',snapshot,key);body=await (await req('/api/bookings')).json();assert.equal(body.bookings.length,2);assert.ok(body.bookings.some(b=>b.id===manual.id));
    const current=body.revision;await req('/api/integrations/sps','PUT',removed,key);assert.equal((await (await req('/api/bookings')).json()).revision,current);
    await req('/api/integrations/sps','PUT',{...snapshot,version:7,events:[{...snapshot.events[0],location:'301'}]},key);
    body=await (await req('/api/bookings')).json();assert.equal(body.bookings.filter(b=>b.source).length,2);assert.ok(body.bookings.filter(b=>b.source).every(b=>b.location==='301'));
    await new Promise(r=>setTimeout(r,50));assert.equal(updated,true);socket.close(1000);
  }finally{await mf.dispose();}
});
