import {readSession,saveSession} from './auth-session';
declare global {
  interface Window {
    __BOOKING_API_BASE__?: string;
  }
}

export function bookingApiUrl(resource = 'bookings') {
  const base = typeof window === 'undefined' ? '' : window.__BOOKING_API_BASE__ || '';
  return `${base}/api/${resource}`;
}

// uniCloud may briefly route a newly deployed function to a gateway that has not
// received its URL mapping. Only retry this explicit pre-execution rejection;
// never retry an ambiguous network failure or a response from the application.
export async function bookingApiFetch(resource = 'bookings', init: RequestInit = {}) {
  const headers=new Headers(init.headers);
  const session=readSession();if(session&&!headers.has('Authorization'))headers.set('Authorization','Bearer '+session.token);
  for(let attempt=0;;attempt++){
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    let timedOut = false;
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    let response: Response;
    try {
      response = await fetch(bookingApiUrl(resource), { ...init, headers, signal: controller.signal });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      const mutation = !resource.startsWith('auth/')&&!['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase());
      throw new Error(mutation
        ? '网络连接异常，请刷新日历确认是否成功后再试'
        : timedOut ? '连接超时，请检查网络后重试' : '暂时无法连接，请检查网络后重试');
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
    }
    if(response.status===401&&session&&['bookings','curriculum','auth/me','auth/live-ticket'].includes(resource))saveSession(null,'expired');
    if(response.status!==404 || attempt>=2)return response;
    const body=await response.clone().json().catch(()=>null) as {error?: {code?: string; message?: string}} | null;
    if(body?.error?.code!=='InternalBizError' || typeof body.error.message!=='string' || !body.error.message.startsWith('no_matching_function_for_path '))return response;
    await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
  }
}
