import { createHash, timingSafeEqual } from 'node:crypto';
import { main as currentHandler } from './api';

declare const __BOOKING_MIGRATION_MODE__: 'freeze' | 'forward';
declare const __BOOKING_MIGRATION_TOKEN_HASH__: string;
declare const __BOOKING_FORWARD_BASE__: string;
declare const uniCloud: {
  database(): any;
  httpclient: { request(url: string, options: unknown): Promise<{status: number; headers: Record<string,string>; data: Buffer}> };
};
type Event = Parameters<typeof currentHandler>[0];
const origins = ['https://sps-club-schedule.github.io', 'https://farawayshore.github.io', 'https://sysu-phy-club-book.folderrewind.top'];

// Only deployed during cutover. The original database remains intact for rollback.
export async function main(event: Event = {}) {
  const incoming = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v])=>[k.toLowerCase(),v]));
  const headers: Record<string,string> = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',Vary:'Origin'};
  if (origins.includes(incoming.origin)) headers['Access-Control-Allow-Origin'] = incoming.origin;
  const reply = (data: unknown, statusCode: number) => ({mpserverlessComposedResponse:true,isBase64Encoded:false,statusCode,headers,body:JSON.stringify(data)});
  if (!event.httpMethod || !event.path) return reply({error:'请通过网站接口访问'},403);
  if (__BOOKING_MIGRATION_MODE__ === 'forward') {
    if (!['/api/bookings','/api/curriculum'].includes(event.path) || !['GET','POST','DELETE','OPTIONS'].includes(event.httpMethod))
      return reply({error:'接口不存在'},404);
    try {
      const response = await uniCloud.httpclient.request(__BOOKING_FORWARD_BASE__ + event.path, {
        method:event.httpMethod, timeout:8000, followRedirect:false,
        headers:{'Content-Type':'application/json', ...(incoming.origin?{Origin:incoming.origin}:{}),
          ...(incoming['access-control-request-method']?{'Access-Control-Request-Method':incoming['access-control-request-method']}:{}),
          ...(incoming['access-control-request-headers']?{'Access-Control-Request-Headers':incoming['access-control-request-headers']}:{}),
        },
        ...(event.httpMethod==='GET'?{}:{content:event.isBase64Encoded?Buffer.from(event.body||'','base64'):event.body||''}),
      });
      for (const key of ['access-control-allow-origin','access-control-allow-methods','access-control-allow-headers'])
        if (response.headers[key]) headers[key] = response.headers[key];
      return {mpserverlessComposedResponse:true,isBase64Encoded:false,statusCode:response.status,headers,body:response.data.toString('utf8')};
    } catch { return reply({error:'服务暂时不可用，请稍后重试'},503); }
  }
  if (event.path === '/__migration' && event.httpMethod === 'GET') {
    const token = incoming.authorization?.replace(/^Bearer /,'') || '';
    const hash = createHash('sha256').update(token).digest();
    const expected = Buffer.from(__BOOKING_MIGRATION_TOKEN_HASH__, 'hex');
    if (!token || expected.length !== hash.length || !timingSafeEqual(hash, expected)) return reply({error:'接口不存在'},404);
    const result = await uniCloud.database().collection('club_booking_state').doc('current').get();
    const row = result.data[0];
    return reply({revision:row.revision,state:JSON.parse(row.payload)},200);
  }
  if (['POST','DELETE','PUT','PATCH'].includes(event.httpMethod)) return reply({error:'正在迁移数据，请稍后刷新再试'},503);
  return currentHandler(event);
}
