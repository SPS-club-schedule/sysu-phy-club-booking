export const PERIODS = [ ['08:00','08:45'],['08:55','09:40'],['10:10','10:55'],['11:05','11:50'],['14:20','15:05'],['15:15','16:00'],['16:30','17:15'],['17:25','18:10'],['19:00','19:45'],['19:55','20:40'],['20:50','21:35'] ];
export const SLOTS = [0,2,4,6,8,10].map(i=>({label:i===10?'第 11 节':`第 ${i+1}–${i+2} 节`,start:PERIODS[i][0],end:PERIODS[Math.min(i+1,10)][1]}));
export const CLUBS: string[] = ['SPS', 'torchwood', '学生会'];
export type Booking = {id:string;club:string;activity:string;location:string;date:string;start:string;end:string;source?:'sps-schedule';sourceTaskId?:string};
export function today(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}
export function addDays(date:string,n:number){const d=new Date(date+'T12:00:00+08:00');d.setUTCDate(d.getUTCDate()+n);return today(d)}
export function monday(date:string){const day=new Date(date+'T12:00:00+08:00').getUTCDay();return addDays(date,-((day+6)%7))}
// Two calendar months, inclusive. Clamp month-end dates to the destination's
// last day (e.g. December 31 -> February 28/29), rather than rolling into March.
export function bookingEnd(date:string){
 const [year,month,day]=date.split('-').map(Number);
 const lastDay=new Date(Date.UTC(year,month+2,0)).getUTCDate();
 return new Date(Date.UTC(year,month+1,Math.min(day,lastDay))).toISOString().slice(0,10);
}
export function bookingWeekIndex(firstDate:string,date:string){return Math.round((Date.parse(monday(date))-Date.parse(monday(firstDate)))/604800000)}
export function minutes(time:string){const [h,m]=time.split(':').map(Number);return h*60+m}
export function timeLabel(start:string,end:string){const a=PERIODS.findIndex(p=>p[0]===start),b=PERIODS.findIndex(p=>p[1]===end);return a>=0&&b>=a?(a===b?`第 ${a+1} 节课`:`第 ${a+1} 节课–第 ${b+1} 节课`):`${start}–${end}`}
export function overlaps(a:Pick<Booking,'start'|'end'>,b:Pick<Booking,'start'|'end'>){return a.start<b.end&&b.start<a.end}
export function validate(b:Booking,now=new Date(),allowedClubs=CLUBS){
 if(!b||typeof b!=='object')return '预约信息无效';
 const t=today(now);if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||b.date<t||b.date>bookingEnd(t)||today(new Date(b.date+'T12:00:00+08:00'))!==b.date)return '仅可预约今天至两个月后的对应日期（含当天）';
 if(!allowedClubs.includes(b.club))return '请选择社团';
 if(typeof b.activity!=='string'||!b.activity.trim()||b.activity.trim().length>60)return '请填写 1–60 字的活动名称';
 if(typeof b.location!=='string'||!b.location.trim()||b.location.trim().length>80)return '请填写 1–80 字的活动地点';
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.end)||b.start>=b.end)return '结束时间须晚于起始时间，请使用 24 小时制';
 if(new Date(`${b.date}T${b.start}:00+08:00`).getTime()<=now.getTime())return '起始时间已过，请选择未来的时间';
 return null;
}

export function cancellationId(body:unknown):string|null{
 if(!body||typeof body!=='object')return null;
 const b=body as {id?:unknown;confirmed?:unknown};
 return b.confirmed===true&&typeof b.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.id)?b.id:null;
}

export type TimelineSegment={start:string;end:string;label:string;isClass:boolean};
export function timelineSegments():TimelineSegment[]{
 const segments:TimelineSegment[]=[];let cursor='00:00';
 const gapLabel=(start:string)=>start==='00:00'?'课前时段':start==='11:50'?'午饭 / 午休':start==='18:10'?'晚饭时间':start==='21:35'?'晚间时段':'课间';
 PERIODS.forEach(([start,end],i)=>{
  if(cursor<start)segments.push({start:cursor,end:start,label:gapLabel(cursor),isClass:false});
  segments.push({start,end,label:`第 ${i+1} 节`,isClass:true});cursor=end;
 });
 segments.push({start:cursor,end:'24:00',label:gapLabel(cursor),isClass:false});
 return segments;
}

// A single continuous scale is shared by all seven days. Empty intervals stay
// proportional; only intervals occupied by overflowing booking text stretch.
export function timelineScale(items:Pick<Booking,'id'|'start'|'end'>[],contentHeights:Record<string,number>={},pixelsPerMinute=2){
 const ranges=items.map(b=>({start:minutes(b.start),end:minutes(b.end),required:contentHeights[b.id]||0})).filter(b=>b.end>b.start);
 const points=[...new Set([0,1440,...ranges.flatMap(b=>[b.start,b.end])])].sort((a,b)=>a-b);
 const offsets=[0];const rates:number[]=[];
 for(let i=0;i<points.length-1;i++){
  const rate=Math.max(pixelsPerMinute,...ranges.filter(b=>b.start<=points[i]&&b.end>=points[i+1]).map(b=>b.required/(b.end-b.start)));
  rates.push(rate);offsets.push(offsets[i]+(points[i+1]-points[i])*rate);
 }
 const y=(time:string)=>{const minute=minutes(time);let i=points.findIndex((p,k)=>k<points.length-1&&minute<points[k+1]);if(i<0)i=points.length-2;return offsets[i]+(minute-points[i])*rates[i]};
 return {y,height:offsets.at(-1)!,span:(start:string,end:string)=>y(end)-y(start),expanded:rates.some(r=>r>pixelsPerMinute)};
}
