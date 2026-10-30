import { randomUUID } from 'node:crypto';
import { today, bookingEnd, validate, cancellationId, overlaps, type Booking } from './schedule';
import { validCourseFilters,findCourseConflicts, type Curriculum } from './curriculum';
import {spsBookings,activityFeed,type SpsSnapshot} from './sps-integration';

export type State = { bookings: Booking[]; curriculum: Curriculum; sps?:SpsSnapshot };
function publicBookings(state:State){const t=today();return [...state.bookings.filter(b=>b.date>=t&&b.date<=bookingEnd(t)),...spsBookings(state.sps,t)].sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start))}
function publicSnapshot(state:State,revision:number){return {revision,today:today(),bookings:publicBookings(state),curriculum:state.curriculum}}
export type Store = { read(): Promise<{ revision: number; state: State }>; compareAndSet(revision: number, state: State): Promise<boolean> };
const ORIGINS = ['https://sps-club-schedule.github.io', 'https://farawayshore.github.io'];
type Event = { path?: string; httpMethod?: string; headers?: Record<string,string>; body?: string; isBase64Encoded?: boolean };
export function createHandler(store: Store, notify?: (revision:number)=>Promise<void>, origins:readonly string[]=ORIGINS) {
 return async (event: Event = {}) => {
  const headers: Record<string,string> = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', Vary:'Origin' };
  const incoming = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v])=>[k.toLowerCase(),v]));
  const allowedOrigin=origins.includes(incoming.origin);
  if(allowedOrigin)headers['Access-Control-Allow-Origin']=incoming.origin;
  const reply=(data:unknown,status=200)=>({mpserverlessComposedResponse:true,isBase64Encoded:false,statusCode:status,headers,body:JSON.stringify(data)});
  const method=event.httpMethod;
  // Cloud functions may also be invoked directly through the client SDK: reject that path.
  if(!method || !event.path)return reply({error:'请通过网站接口访问'},403);
  if(incoming.origin && !allowedOrigin)return reply({error:'请求来源无效'},403);
  const path=event.path.replace(/\/$/,'');
  if(!['/api/bookings','/api/curriculum','/api/activities'].includes(path))return reply({error:'接口不存在'},404);
  if(method==='OPTIONS'){headers['Access-Control-Allow-Methods']='GET, POST, DELETE';headers['Access-Control-Allow-Headers']='Content-Type';return reply({},200)}
  if(path!=='/api/bookings' && method!=='GET')return reply({error:'不支持的操作'},405);
  if(!['GET','POST','DELETE'].includes(method))return reply({error:'不支持的操作'},405);
  if(method!=='GET' && !allowedOrigin)return reply({error:'请求来源无效'},403);
  try {
   if(method==='GET'){
    const {state,revision}=await store.read();
    if(path==='/api/curriculum')return reply(state.curriculum);
    if(path==='/api/activities')return reply({revision,from:today(),to:bookingEnd(today()),activities:activityFeed(publicBookings(state))});
    return reply(publicSnapshot(state,revision));
   }
   const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):event.body||'';
   if(Buffer.byteLength(raw)>8192)return reply({error:'请求内容过长'},413);
   let body;try{body=JSON.parse(raw)}catch{return reply({error:'请求内容无效'},400)}
   if(method==='DELETE' && typeof body?.id==='string' && body.id.startsWith('sps:'))return reply({error:'此活动由 SPS 日程同步，请在 SPS 日程中修改或归档'},403);
   const id=method==='DELETE'?cancellationId(body):randomUUID();
   if(method==='DELETE'&&!id)return reply({error:'请确认要取消的预约'},400);
   if(method==='POST'){const error=validate(body);if(error)return reply({error},400)}
   for(let attempt=0;attempt<5;attempt++){
    const {revision,state}=await store.read();
    if(method==='DELETE'){
     if(!state.bookings.some(b=>b.id===id))return reply({id,cancelled:true,snapshot:publicSnapshot(state,revision)});
     state.bookings=state.bookings.filter(b=>b.id!==id);
    }else{
     const selected=body.selectedGrades??[];
     if(!Array.isArray(selected)||selected.length>20||selected.some((id:unknown)=>typeof id!=='string'||!state.curriculum.timetables.some(t=>t.id===id)))return reply({error:'请选择有效的年级课表'},400);
     if(!validCourseFilters(body.courseFilters,state.curriculum))return reply({error:'课表筛选选项无效'},400);
     const conflicts=[...state.bookings,...spsBookings(state.sps,body.date,body.date)].filter(b=>b.date===body.date&&overlaps(b,body));
     if(conflicts.some(b=>b.club===body.club))return reply({error:'您的社团已经预约相同时段，请勿重复预约',kind:'duplicate'},409);
     const courses=findCourseConflicts(state.curriculum,selected,body,body.courseFilters);
     const acceptedCourses=Array.isArray(body.acceptedCourses)?body.acceptedCourses:[];
     if(courses.some(c=>!acceptedCourses.includes(c.confirmationKey)))return reply({kind:'course_conflict',conflicts:courses},409);
     const accepted=Array.isArray(body.accepted)?body.accepted.filter((x:unknown)=>typeof x==='string').slice(0,100):[];
     if(conflicts.some(b=>!accepted.includes(b.id)))return reply({kind:'conflict',conflicts},409);
     state.bookings.push({id:id!,club:body.club,activity:body.activity.trim(),location:body.location.trim(),date:body.date,start:body.start,end:body.end});
    }
    // The database matches revision and writes the replacement in one atomic update.
    // A losing writer reloads and rechecks every conflict before retrying.
    if(await store.compareAndSet(revision,state)){
     let warning:string|undefined;
     if(notify){try{await notify(revision+1)}catch{warning='数据已保存，但更新推送未送出；其他页面可手动刷新。'}}
     return reply({id,...(method==='DELETE'?{cancelled:true}:{}),revision:revision+1,warning,snapshot:publicSnapshot(state,revision+1)},method==='DELETE'?200:201);
    }
   }
   return reply({error:'预约正在更新，请刷新后重试'},503);
  }catch{return reply({error:'服务暂时不可用，请稍后重试'},503)}
 };
}
