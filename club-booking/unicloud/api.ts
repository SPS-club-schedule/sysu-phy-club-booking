import { randomUUID } from 'node:crypto';
import { validateCurriculum } from '../app/curriculum';
import { createHandler, type State } from '../app/booking-handler';
export { createHandler } from '../app/booking-handler';
export type { State, Store } from '../app/booking-handler';

declare const __BOOKING_PUSH_ENABLED__: boolean;
declare const uniCloud: { database(): any; getPushManager(options:{appId:string}):{sendMessage(options:unknown):Promise<{errCode?:number|string}>} };
async function notifyRevision(revision:number){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  // Bound push latency: a committed booking must never become an HTTP failure
  // merely because the independent push service is unavailable or rate-limited.
  const result=await Promise.race([
   uniCloud.getPushManager({appId:'__UNI__F181DF8'}).sendMessage({
    title:'预约日历更新',content:'日历数据已更新',payload:{type:'booking-state-changed',revision},
    force_notification:false,settings:{ttl:-1},request_id:randomUUID().replaceAll('-',''),
   }),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Push timeout')),2500)}),
  ]);
  if(result.errCode!==0)throw new Error('Push rejected');
 }finally{clearTimeout(timer)}
}
export const main=createHandler({
 async read(){
  const result=await uniCloud.database().collection('club_booking_state').doc('current').get();
  const row=result.data[0];if(!row || !Number.isSafeInteger(row.revision))throw new Error('Missing state');
  const state=JSON.parse(row.payload) as State;
  state.curriculum=validateCurriculum(state.curriculum);
  if(!Array.isArray(state.bookings))throw new Error('Invalid state');
  return {revision:row.revision,state};
 },
 async compareAndSet(revision,state){
  const result=await uniCloud.database().collection('club_booking_state').where({_id:'current',revision}).update({revision:revision+1,payload:JSON.stringify(state)});
  return result.updated===1;
 }
},typeof __BOOKING_PUSH_ENABLED__!=='undefined' && __BOOKING_PUSH_ENABLED__?notifyRevision:undefined);
