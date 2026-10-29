import {today,bookingEnd,addDays} from '../app/schedule.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['unicloud/api.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {createHandler}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const state={bookings:[],curriculum:{version:1,timetables:[]}};
function fixture(){let data=structuredClone(state),revision=0;return createHandler({async read(){const copy={state:structuredClone(data),revision};await new Promise(r=>setImmediate(r));return copy},async compareAndSet(rev,next){if(rev!==revision)return false;data=structuredClone(next);revision++;return true}})}
const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
const b={club:'SPS',activity:'test',location:'test',date,start:'08:00',end:'09:00'};
const event=(method,body,path='/api/bookings')=>({httpMethod:method,path,headers:{origin:'https://farawayshore.github.io'},body:JSON.stringify(body)});
const json=r=>JSON.parse(r.body);
test('simultaneous overlapping writes admit only one same-club booking',async()=>{const handler=fixture();const results=await Promise.all([handler(event('POST',b)),handler(event('POST',b))]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[201,409]);assert.equal(json(await handler(event('GET'))).bookings.length,1)});
test('other-club confirmation and confirmed cancellation preserved',async()=>{const h=fixture();const first=json(await h(event('POST',b)));const other={...b,club:'torchwood'};assert.equal((await h(event('POST',other))).statusCode,409);assert.equal((await h(event('POST',{...other,accepted:[first.id]}))).statusCode,201);assert.equal((await h(event('DELETE',{id:first.id}))).statusCode,400);assert.equal((await h(event('DELETE',{id:first.id,confirmed:true}))).statusCode,200);assert.equal(json(await h(event('GET'))).bookings.length,1)});
test('public curriculum is read-only, foreign origin and SDK invocation rejected',async()=>{const h=fixture();for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await h(event(method,{},'/api/curriculum'))).statusCode,405);assert.equal((await h({...event('POST',b),headers:{origin:'https://evil.example'}})).statusCode,403);assert.equal((await h({})).statusCode,403);assert.deepEqual(json(await h(event('GET',null,'/api/curriculum'))),state.curriculum)});

test('only successful changes publish their committed revision; failed push cannot undo a booking',async()=>{
 let data=structuredClone(state),revision=0;const notices=[];
 const store={async read(){return {state:structuredClone(data),revision}},async compareAndSet(rev,next){assert.equal(rev,revision);data=structuredClone(next);revision++;return true}};
 const h=createHandler(store,async rev=>{assert.equal(rev,revision);notices.push(rev);if(rev===2)throw new Error('push quota')});
 const created=await h(event('POST',b));assert.equal(created.statusCode,201);assert.deepEqual(notices,[1]);
 assert.equal((await h(event('POST',b))).statusCode,409);assert.deepEqual(notices,[1]);
 const cancelled=await h(event('DELETE',{id:json(created).id,confirmed:true}));
 assert.equal(cancelled.statusCode,200);assert.ok(json(cancelled).warning);assert.deepEqual(notices,[1,2]);
 assert.equal(json(await h(event('GET'))).revision,2);assert.equal(data.bookings.length,0);
 await h(event('DELETE',{id:json(created).id,confirmed:true}));assert.deepEqual(notices,[1,2]);
});

test('API lists a booking on the two-month boundary and rejects the next day',async()=>{
 const h=fixture();const end=bookingEnd(today());
 const created=await h(event('POST',{...b,date:end}));assert.equal(created.statusCode,201);
 assert.equal(json(await h(event('GET'))).bookings[0].date,end);
 assert.equal((await h(event('POST',{...b,date:addDays(end,1)}))).statusCode,400);
});

test('cloud handler mock honors major filters without accessing the cloud',async()=>{
 const weekday=(new Date(b.date+'T00:00:00Z').getUTCDay()+6)%7+1;
 const table={id:'g3',label:'大三',grade:3,term:'测试',week1Monday:addDays(b.date,1-weekday),overrides:[],courses:[{id:'c',name:'专属课程',weekday,weeks:[1],start:b.start,end:b.end,location:'甲楼',audiences:[{major:'physics',group:'elite',requirement:'required'}]}]};
 let data={bookings:[],curriculum:{version:1,timetables:[table]}},revision=0;
 const h=createHandler({async read(){return {state:structuredClone(data),revision}},async compareAndSet(rev,next){if(rev!==revision)return false;data=next;revision++;return true}});
 const payload={...b,selectedGrades:['g3'],courseFilters:{g3:{majors:['physics'],groups:['elite','theory'],types:['required']}}};
 const conflict=await h(event('POST',payload));assert.equal(conflict.statusCode,409);assert.equal(json(conflict).conflicts[0].activity,'专属课程');
 assert.equal((await h(event('POST',{...payload,courseFilters:null}))).statusCode,400);
 payload.courseFilters.g3.majors=['optical'];assert.equal((await h(event('POST',payload))).statusCode,201);
 assert.equal(data.bookings.length,1);
});

test('committed mutation returns the full snapshot without a second database read',async()=>{
 let reads=0,revision=9,data=structuredClone(state);
 const h=createHandler({async read(){reads++;return {revision,state:structuredClone(data)}},async compareAndSet(r,next){if(r!==revision)return false;data=structuredClone(next);revision++;return true}});
 const created=json(await h(event('POST',b)));
 assert.equal(reads,1);assert.equal(created.snapshot.revision,10);assert.equal(created.snapshot.bookings[0].id,created.id);assert.deepEqual(created.snapshot.curriculum,state.curriculum);
 const deleted=json(await h(event('DELETE',{id:created.id,confirmed:true})));
 assert.equal(reads,2);assert.equal(deleted.snapshot.revision,11);assert.deepEqual(deleted.snapshot.bookings,[]);
 const repeated=json(await h(event('DELETE',{id:created.id,confirmed:true})));
 assert.equal(repeated.snapshot.revision,11);assert.deepEqual(repeated.snapshot.bookings,[]);
});

// Keep both sites usable during the organization transfer.
test('organization Pages origin can read and preflight booking mutations', async()=>{
 const h=fixture();
 for(const origin of ['https://sps-club-schedule.github.io','https://farawayshore.github.io']){
  for(const method of ['GET','OPTIONS']){
   const r=await h({...event(method),headers:{origin}});
   assert.equal(r.statusCode,200);
   assert.equal(r.headers['Access-Control-Allow-Origin'],origin);
  }
 }
});
