export type User={id:string;username:string;club:string;email:string;emailVerified:boolean};
export type Session={token:string;expiresAt:number;user:User};
export const SESSION_KEY='physics-club-session-v1';
declare global {interface Window {BookingNative?:{postMessage:(message:string)=>void}}}
export function nativeMessage(message:unknown){window.BookingNative?.postMessage(JSON.stringify(message))}
export function readSession():Session|null{
 if(typeof window==='undefined')return null;
 try{const s=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');return s&&/^[a-f0-9]{64}$/.test(s.token)&&s.expiresAt>Date.now()&&s.user&&typeof s.user.id==='string'&&typeof s.user.club==='string'?s:null}catch{return null}
}
export function saveSession(session:Session|null,reason:'session'|'expired'|'logout'='session'){
 if(session)sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));else sessionStorage.removeItem(SESSION_KEY);
 nativeMessage({type:reason,session});window.dispatchEvent(new Event('booking-auth-change'));
}
export function rememberLogin(session:Session,username:string,password:string,remember:boolean){
 saveSession(session);
 nativeMessage({type:'auth-success',session,username,password:remember?password:undefined,remember});
}
