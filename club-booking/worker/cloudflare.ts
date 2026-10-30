import { DurableObject } from 'cloudflare:workers';
import { createHandler, type State } from '../app/booking-handler';
import { validateCurriculum } from '../app/curriculum';
import { cancellationId } from '../app/schedule';

type Env = {
  BOOKINGS: DurableObjectNamespace<BookingState>;
  ASSETS: Fetcher;
  ALLOWED_ORIGINS: string;
  MIGRATION_TOKEN?: string;
  BOOKING_MAINTENANCE?: string;
};
type Snapshot = { revision: number; state: State };
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export function validateSnapshot(value: unknown): Snapshot {
  const data = value as Snapshot;
  if (!data || !Number.isSafeInteger(data.revision) || data.revision < 0 || !data.state ||
      !Array.isArray(data.state.bookings) || data.state.bookings.length > 10000) throw new Error('Invalid snapshot');
  validateCurriculum(data.state.curriculum);
  const ids = new Set<string>();
  for (const b of data.state.bookings) {
    // Historical bookings must survive migration, including past dates and clubs.
    if (!b || !cancellationId({ id: b.id, confirmed: true }) || ids.has(b.id) ||
        !['club', 'activity', 'location'].every(k => typeof b[k as keyof typeof b] === 'string') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.end) || b.start >= b.end) throw new Error('Invalid booking');
    ids.add(b.id);
  }
  return data;
}

export class BookingState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS booking_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL
    )`);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private read(): Snapshot {
    const rows = this.ctx.storage.sql.exec<{ revision: number; payload: string }>(
      'SELECT revision, payload FROM booking_state WHERE id = 1'
    ).toArray();
    if (!rows.length) throw new Error('Migration has not initialized the database');
    return { revision: rows[0].revision, state: JSON.parse(rows[0].payload) as State };
  }

  private broadcast(revision: number) {
    const message = JSON.stringify({ type: 'booking-state-changed', revision });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(message); } catch { try { socket.close(1011, 'Reconnect'); } catch {} }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const origins = this.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
    if (path === '/__migration') {
      // Temporary operator-only import/export. Removing the secret disables it.
      if (!this.env.MIGRATION_TOKEN || request.headers.get('authorization') !== `Bearer ${this.env.MIGRATION_TOKEN}`)
        return json({ error: 'Not found' }, 404);
      if (request.method === 'GET') {
        try { return json(this.read()); } catch { return json({ error: 'Not initialized' }, 404); }
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 5_000_000) return json({ error: 'Snapshot too large' }, 413);
      let snapshot: Snapshot;
      try { snapshot = validateSnapshot(JSON.parse(raw)); } catch { return json({ error: 'Invalid snapshot' }, 400); }
      const rows = this.ctx.storage.sql.exec(
        'INSERT INTO booking_state (id, revision, payload) VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING id',
        snapshot.revision, JSON.stringify(snapshot.state)
      ).toArray();
      if (!rows.length) return json({ error: 'Already initialized; refusing to overwrite data' }, 409);
      return json({ revision: snapshot.revision, imported: true }, 201);
    }

    if (path === '/api/updates') {
      if (!origins.includes(request.headers.get('origin') || '')) return json({ error: '请求来源无效' }, 403);
      if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
        return json({ error: 'WebSocket required' }, 426);
      let revision: number;
      try { revision = this.read().revision; } catch { return json({ error: '正在迁移数据，请稍后刷新再试' }, 503); }
      if (this.ctx.getWebSockets().length >= 500) return json({ error: '连接过多，请稍后重试' }, 503);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: 'booking-state-changed', revision }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (this.env.BOOKING_MAINTENANCE === 'true' && ['POST', 'DELETE', 'PUT', 'PATCH'].includes(request.method)) {
      const response = json({ error: '正在迁移数据，请稍后刷新再试' }, 503);
      const origin = request.headers.get('origin');
      if (origin && origins.includes(origin)) response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
      return response;
    }
    const handler = createHandler({
      read: async () => this.read(),
      compareAndSet: async (revision, state) => {
        // One conditional SQL statement decides the winner. The shared handler
        // reloads and checks all conflicts again when a competing writer wins.
        const result = this.ctx.storage.sql.exec(
          'UPDATE booking_state SET revision = ?, payload = ? WHERE id = 1 AND revision = ? RETURNING id',
          revision + 1, JSON.stringify(state), revision
        );
        return result.toArray().length === 1;
      },
    }, async revision => this.broadcast(revision), origins);
    const result = await handler({
      path, httpMethod: request.method,
      headers: Object.fromEntries(request.headers),
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
    });
    return new Response(result.body, { status: result.statusCode, headers: result.headers });
  }

  webSocketMessage(socket: WebSocket) { socket.close(1008, 'Read-only connection'); }
  webSocketClose(socket: WebSocket, code: number) { socket.close(code === 1005 ? 1000 : code); }
  webSocketError(socket: WebSocket) { socket.close(1011, 'Reconnect'); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api/health' && request.method === 'GET') {
      const response = json({ ok: true, service: 'club-booking-connectivity', backend: 'cloudflare' });
      const origin = request.headers.get('origin');
      if (origin && env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).includes(origin)) response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
      return response;
    }
    if (path.startsWith('/api/') || path === '/__migration') {
      return env.BOOKINGS.get(env.BOOKINGS.idFromName('club-booking-production')).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
