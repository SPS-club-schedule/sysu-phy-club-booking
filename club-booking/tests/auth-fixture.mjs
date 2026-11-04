import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export const mailBindings={RESEND_API_KEY:'test-only-mail-key',EMAIL_ENABLED:'true',EMAIL_FROM:'Booking <test@example.test>'};
export const sent=[];
export const outboundService=async request=>{
 assert.equal(request.url,'https://api.resend.com/emails');
 assert.equal(request.headers.get('Authorization'),'Bearer test-only-mail-key');
 assert.match(request.headers.get('Idempotency-Key'),/^club-booking\/[a-f0-9]{64}$/);
 sent.push(await request.json());return Response.json({id:randomUUID()});
};
export async function waitFor(check){const end=Date.now()+12000;while(!check()){if(Date.now()>end)throw Error('Timed out');await new Promise(r=>setTimeout(r,25))}}
export async function verifiedSession(mf,origin,club='SPS'){
 const username='test_'+randomUUID().slice(0,8),email=username+'@example.test',password='Test-password-123!';
 const post=(path,data,token)=>mf.dispatchFetch('https://booking.test/api/auth/'+path,{method:'POST',headers:{origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
 const r=await post('register',{username,email,password,club});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));
 await waitFor(()=>sent.some(m=>m.to[0]===email));
 const code=sent.find(m=>m.to[0]===email).text.match(/验证码为：(\d{6})/)[1];
 const verified=await post('verify',{code},data.data.token);assert.equal(verified.status,200,await verified.text());
 return {...data.data,username,email,password};
}
