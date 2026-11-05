// Only the booking Worker calls this endpoint. It authenticates to the fixed
// schedule origin, which checks the current SPS membership on each request.
const IDENTITY_URL = 'https://sps-club-api.sysu-physics-clubs.workers.dev/integrations/booking/identity';
export type SpsIdentity = {id:string; username:string; verifiedEmail:string; revision:number};
export class IdentityError extends Error {
  constructor(public status:number, message:string) { super(message); }
}
type IdentityRequest = {operation:'login';username:string;password:string}
  | {operation:'check';id:string} | {operation:'redeem'|'preview';code:string};

export async function scheduleIdentity(key:string | undefined, request:IdentityRequest) {
  const unavailable = () => new IdentityError(503,'暂时无法连接 SPS 日程，请稍后重试');
  if (!key) throw unavailable();
  const response = await fetch(IDENTITY_URL, {
    method:'POST', headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify(request), redirect:'manual', signal:AbortSignal.timeout(10000)
  }).catch(() => { throw unavailable(); });
  if (!response.ok) {
    if (response.status === 401) throw new IdentityError(401, request.operation==='login'?'日程用户名或密码不正确':'日程跳转凭证已过期，请从日历重新打开');
    if (response.status === 403) throw new IdentityError(403,'仅 SPS 在籍成员和管理员可以使用日程账号登录');
    if (response.status === 429) throw new IdentityError(429,'尝试过于频繁，请稍后再试');
    throw unavailable();
  }
  const data = (await response.json() as {ok:boolean;data?:SpsIdentity});
  const p = data.data;
  if (!data.ok || !p || !/^[a-z0-9_]{3,30}$/.test(p.username)) throw unavailable();
  if (request.operation!=='preview' && (!/^[a-f0-9]{64}$/.test(p.id) || !Number.isSafeInteger(p.revision) ||
      typeof p.verifiedEmail!=='string' || p.verifiedEmail.length>254 || (request.operation==='check' && p.id!==request.id))) throw unavailable();
  return p;
}
