import { bookingApiUrl,bookingApiFetch } from '../app/booking-api';
import { updateRevision, type SubscribeUpdates } from '../app/live-updates';

export const subscribeUpdates: SubscribeUpdates = callbacks => {
  let socket: WebSocket | undefined;
  let stopped = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lastPong = 0;
  let authorizing=false;
  const clearHeartbeat = () => { clearInterval(heartbeat); heartbeat = undefined; };
  const connect = async () => {
    clearTimeout(retry);
    if (stopped || !navigator.onLine || authorizing) return;
    if (socket && socket.readyState < WebSocket.CLOSING) return;
    callbacks.status('connecting');
    const url = new URL(bookingApiUrl('updates'), location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    authorizing=true;
    try {
      const response=await bookingApiFetch('auth/live-ticket',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if(!response.ok)throw Error('Authentication required');
      const value=await response.json() as {data:{ticket:string}};if(!/^[a-f0-9]{64}$/.test(value.data?.ticket))throw Error('Invalid ticket');
      url.searchParams.set('ticket',value.data.ticket);
    }catch{
      if(!stopped){callbacks.status('disconnected');retry=setTimeout(()=>void connect(),Math.min(30000,1000*2**Math.min(attempt++,5)))}
      return;
    }finally{authorizing=false}
    if(stopped||!navigator.onLine)return;
    const current = new WebSocket(url);
    socket = current;
    current.onopen = () => {
      if (stopped || socket !== current) { current.close(); return; }
      attempt = 0;
      lastPong = Date.now();
      callbacks.status('connected');
      callbacks.connected();
      heartbeat = setInterval(() => {
        if (Date.now() - lastPong > 75000) { current.close(); return; }
        if (current.readyState === WebSocket.OPEN) current.send('ping');
      }, 30000);
    };
    current.onmessage = event => {
      if (stopped || socket !== current) return;
      if (event.data === 'pong') { lastPong = Date.now(); return; }
      const revision = updateRevision(event.data);
      if (revision !== null) callbacks.change(revision);
    };
    current.onerror = () => current.close();
    current.onclose = () => {
      if (socket !== current) return;
      socket = undefined;
      clearHeartbeat();
      if (stopped) return;
      callbacks.status('disconnected');
      retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)));
    };
  };
  const resume = () => {
    if (document.hidden) return;
    if (socket?.readyState === WebSocket.OPEN && Date.now() - lastPong > 75000) socket.close();
    else connect();
  };
  const offline = () => { socket?.close(); callbacks.status('disconnected'); };
  window.addEventListener('online', resume);
  window.addEventListener('offline', offline);
  document.addEventListener('visibilitychange', resume);
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    clearHeartbeat();
    socket?.close();
    window.removeEventListener('online', resume);
    window.removeEventListener('offline', offline);
    document.removeEventListener('visibilitychange', resume);
  };
};
