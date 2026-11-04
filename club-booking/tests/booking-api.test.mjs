import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['app/booking-api.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {bookingApiFetch}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('an already-expired session still signs out the calendar and notifies native re-login',async()=>{
 const original=global.fetch,messages=[],events=[];
 const storage=new Map([['physics-club-session-v1',JSON.stringify({token:'a'.repeat(64),expiresAt:Date.now()-1,user:{id:'test',club:'SPS'}})]]);
 global.sessionStorage={getItem:key=>storage.get(key),removeItem:key=>storage.delete(key)};
 global.window={BookingNative:{postMessage:value=>messages.push(JSON.parse(value))},dispatchEvent:event=>events.push(event.type)};
 try{
  global.fetch=async(_url,init)=>{assert.equal(init.headers.has('Authorization'),false);return Response.json({error:'expired'},{status:401})};
  await bookingApiFetch('bookings');assert.equal(storage.size,0);assert.deepEqual(messages,[{type:'expired',session:null}]);assert.deepEqual(events,['booking-auth-change']);
 }finally{global.fetch=original;delete global.window;delete global.sessionStorage}
});
test('a stalled request times out once and ambiguous mutations are never resubmitted',async(t)=>{
 const original=global.fetch;
 t.mock.timers.enable({apis:['setTimeout']});
 try {
  let count=0;
  global.fetch=async(_url,init)=>{count++;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}))};
  const read=assert.rejects(bookingApiFetch(),/连接超时/);
  t.mock.timers.tick(15000);await read;
  const write=assert.rejects(bookingApiFetch('bookings',{method:'POST'}),/刷新日历确认是否成功/);
  t.mock.timers.tick(15000);await write;
  assert.equal(count,2);
 } finally {global.fetch=original;t.mock.timers.reset()}
});
test('offline reads and ambiguous writes give actionable messages without retrying',async()=>{
 const original=global.fetch;
 try {
  let count=0;
  global.fetch=async()=>{count++;throw new TypeError('Failed to fetch')};
  await assert.rejects(bookingApiFetch(),/检查网络后重试/);
  await assert.rejects(bookingApiFetch('bookings',{method:'DELETE'}),/刷新日历确认是否成功/);
  assert.equal(count,2);
  const controller=new AbortController();controller.abort();
  global.fetch=async(_url,init)=>{assert.equal(init.signal.aborted,true);throw controller.signal.reason};
  await assert.rejects(bookingApiFetch('bookings',{signal:controller.signal}),{name:'AbortError'});
 } finally {global.fetch=original}
});
test('only an explicit gateway pre-execution rejection may retry a write',async()=>{const original=global.fetch;try{let n=0;global.fetch=async()=>++n===1?Response.json({error:{code:'InternalBizError',message:'no_matching_function_for_path /test'}},{status:404}):Response.json({id:'ok'},{status:201});assert.equal((await bookingApiFetch('bookings',{method:'POST'})).status,201);assert.equal(n,2);n=0;global.fetch=async()=>{n++;throw new Error('network')};await assert.rejects(bookingApiFetch('bookings',{method:'POST'}));assert.equal(n,1);n=0;global.fetch=async()=>{n++;return Response.json({error:'other'},{status:503})};assert.equal((await bookingApiFetch('bookings',{method:'POST'})).status,503);assert.equal(n,1)}finally{global.fetch=original}});
