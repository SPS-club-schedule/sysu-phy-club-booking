import {today,addDays,bookingEnd,type Booking} from './schedule';
export type SpsEvent={id:string;title:string;location:string;startsAt:number;endsAt:number};
export type SpsSnapshot={sourceId:string;version:number;events:SpsEvent[]};
export function validateSpsSnapshot(value:unknown,clubId:string):SpsSnapshot {
  const s=value as SpsSnapshot;
  if(!s || s.sourceId!==clubId || !Number.isSafeInteger(s.version) || s.version<0 || !Array.isArray(s.events) || s.events.length>10000)throw new Error('Invalid SPS snapshot');
  const ids=new Set<string>();
  const events=s.events.map(e=>{
    if(!e || !/^(t_|tg_)[a-f0-9]{32}$/.test(e.id) || ids.has(e.id) ||
      typeof e.title!=='string' || !e.title.trim() || e.title.length>80 || typeof e.location!=='string' || e.location.length>80 ||
      !Number.isSafeInteger(e.startsAt) || !Number.isSafeInteger(e.endsAt) || e.startsAt<0 || e.endsAt<=e.startsAt || e.endsAt>Date.UTC(2100,0,1))throw new Error('Invalid SPS activity');
    ids.add(e.id);
    return {id:e.id,title:e.title.trim(),location:e.location.trim() || '未定',startsAt:e.startsAt,endsAt:e.endsAt};
  });
  return {sourceId:s.sourceId,version:s.version,events};
}
const time=(at:number)=>new Date(at+8*3600000).toISOString().slice(11,16);
// Split only the displayed dates. A midnight end is exclusive; long tasks do
// not create thousands of stored daily records or lose their true end date.
export function spsBookings(snapshot?:SpsSnapshot,from=today(),to=bookingEnd(from)):Booking[] {
  const result:Booking[]=[];
  if(!snapshot)return result;
  const fromAt=Date.parse(from+'T00:00:00+08:00'),toAt=Date.parse(addDays(to,1)+'T00:00:00+08:00');
  for(const e of snapshot.events){
    if(e.startsAt>=toAt || e.endsAt<=fromAt)continue;
    const startDate=today(new Date(Math.max(e.startsAt,fromAt))),lastDate=today(new Date(Math.min(e.endsAt,toAt)-1));
    for(let date=startDate;date<=lastDate;date=addDays(date,1)){
      const start=Date.parse(date+'T00:00:00+08:00'),end=start+86400000;
      result.push({id:'sps:'+e.id+':'+date,club:'SPS',activity:e.title,location:e.location || '未定',date,
        start:e.startsAt<=start?'00:00':time(e.startsAt),end:e.endsAt>=end?'24:00':time(e.endsAt),source:'sps-schedule',sourceTaskId:e.id});
    }
  }
  return result;
}
export function activityFeed(bookings:Booking[]) {
  return bookings.map(b=>({id:b.id,club:b.club,title:b.activity,location:b.location || '未定',
    startsAt:Date.parse(b.date+'T'+b.start+':00+08:00'),endsAt:Date.parse(b.date+'T'+b.end+':00+08:00')}));
}
