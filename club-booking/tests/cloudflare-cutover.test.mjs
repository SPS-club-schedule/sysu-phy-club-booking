import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const token = 'test-only-cutover-token';
const snapshot = {revision:34,state:{bookings:[],curriculum:{version:1,timetables:[]}}};
async function handler(mode) {
  const result=await build({entryPoints:['unicloud/migration.ts'],bundle:true,write:false,platform:'node',format:'esm',define:{
    __BOOKING_PUSH_ENABLED__:'false',__BOOKING_MIGRATION_MODE__:JSON.stringify(mode),
    __BOOKING_MIGRATION_TOKEN_HASH__:JSON.stringify(createHash('sha256').update(token).digest('hex')),
    __BOOKING_FORWARD_BASE__:JSON.stringify('https://sysu-phy-club-book.folderrewind.top'),
  }});
  return (await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))).main;
}
const event=(method,path='/api/bookings',extra={})=>({httpMethod:method,path,headers:{origin:'https://sps-club-schedule.github.io'},...extra});

test('cutover freeze blocks writes and only a bearer token can export the full source',async()=>{
  const before=globalThis.uniCloud;let reads=0;
  globalThis.uniCloud={database:()=>({collection:()=>({doc:()=>({get:async()=>{reads++;return {data:[{revision:snapshot.revision,payload:JSON.stringify(snapshot.state)}]}}})})})};
  try {
    const main=await handler('freeze');
    assert.equal((await main({})).statusCode,403);
    for(const method of ['POST','DELETE','PUT','PATCH'])assert.equal((await main(event(method))).statusCode,503);
    assert.equal(reads,0);
    assert.equal((await main(event('GET','/__migration'))).statusCode,404);
    const exported=await main(event('GET','/__migration',{headers:{authorization:`Bearer ${token}`}}));
    assert.equal(exported.statusCode,200);assert.deepEqual(JSON.parse(exported.body),snapshot);
    assert.equal((await main(event('GET'))).statusCode,200);
  } finally { if(before===undefined)delete globalThis.uniCloud;else globalThis.uniCloud=before; }
});

test('legacy bridge forwards to Cloudflare without touching the former database or retrying writes',async()=>{
  const before=globalThis.uniCloud;const calls=[];
  globalThis.uniCloud={database:()=>{throw new Error('Former database must not be used')},httpclient:{request:async(url,options)=>{
    calls.push({url,options});return {status:201,headers:{'access-control-allow-origin':options.headers.Origin},data:Buffer.from('{"id":"created"}')};
  }}};
  try {
    const main=await handler('forward');
    assert.equal((await main(event('GET','/__migration',{headers:{authorization:`Bearer ${token}`}}))).statusCode,404);
    assert.equal(calls.length,0);
    const body=JSON.stringify({activity:'test'});
    const response=await main(event('POST','/api/bookings',{body:Buffer.from(body).toString('base64'),isBase64Encoded:true}));
    assert.equal(response.statusCode,201);assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://sysu-phy-club-book.folderrewind.top/api/bookings');
    assert.equal(calls[0].options.content.toString(),body);
    globalThis.uniCloud.httpclient.request=async()=>{calls.push('failure');throw new Error('ambiguous timeout')};
    assert.equal((await main(event('POST','/api/bookings',{body}))).statusCode,503);
    assert.equal(calls.length,2);
  } finally { if(before===undefined)delete globalThis.uniCloud;else globalThis.uniCloud=before; }
});
