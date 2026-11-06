/**
 * Realtime layer: one WebSocket per client at /api/v1/realtime.
 *
 * Auth: POST /api/v1/realtime/ticket (normal bearer auth) returns a one-time
 * ticket valid for 60 s; connect with ?ticket=<ticket>. Browsers can't set
 * headers on a WebSocket, so the token itself never goes in a URL. With
 * AUTH_DEV_HEADER=true, ?dev_user=<subject> also works (local only).
 *
 * Every connection is subscribed to its own `user:<usr_id>` channel
 * (invites, notifications, queue matches). Clients subscribe to more:
 *   -> {"op":"subscribe","channel":"battle:bt_12"}     (participants only)
 *   -> {"op":"unsubscribe","channel":"battle:bt_12"}
 *   -> {"op":"ping"}
 * Server messages: {"channel","type","data","ts"}. Subscribing to a battle
 * first sends a `battle.sync` snapshot (state, picks, and every match event
 * already due), so a reconnecting client resumes at the right point and then
 * continues with live events.
 *
 * Single-process hub. Running more than one API instance needs a shared bus
 * (e.g. Postgres LISTEN/NOTIFY) behind publish(); see the README.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';

import type { Logger } from 'pino';
import { WebSocket, WebSocketServer } from 'ws';

import { encodeId } from '../ids.js';

export interface RealtimeMessage {
  channel: string;
  type: string;
  data: unknown;
  ts: string;
}

interface Conn {
  ws: WebSocket;
  userId: string;
  channels: Set<string>;
}

export interface ChannelPolicy {
  /** May `userId` (internal id) subscribe to `channel`? */
  authorize(userId: string, channel: string): Promise<boolean>;
  /** Messages to send right after subscribing (snapshot for resuming). */
  onSubscribe?(userId: string, channel: string): Promise<Array<{ type: string; data: unknown }>>;
}

export const userChannel = (userId: string) => `user:${encodeId('user', userId)}`;
export const battleChannel = (battleId: string) => `battle:bt_${battleId}`;

export class RealtimeHub {
  private conns = new Set<Conn>();
  private byChannel = new Map<string, Set<Conn>>();
  private tickets = new Map<string, { userId: string; expires: number }>();
  private policy: ChannelPolicy = { authorize: async () => false };
  private wss?: WebSocketServer;
  /** Every published message, for tests/observability (bounded). */
  readonly recent: RealtimeMessage[] = [];

  constructor(private logger?: Logger, private devHeader = false) {}

  setPolicy(p: ChannelPolicy) { this.policy = p; }

  issueTicket(userId: string, ttlMs = 60_000): { ticket: string; expires_in: number } {
    const ticket = randomBytes(24).toString('base64url');
    this.tickets.set(ticket, { userId, expires: Date.now() + ttlMs });
    for (const [k, v] of this.tickets) if (v.expires < Date.now()) this.tickets.delete(k);
    return { ticket, expires_in: Math.round(ttlMs / 1000) };
  }

  private redeem(ticket: string): string | undefined {
    const t = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return t && t.expires >= Date.now() ? t.userId : undefined;
  }

  isOnline(userId: string): boolean {
    return (this.byChannel.get(userChannel(userId))?.size ?? 0) > 0;
  }

  publish(channel: string, type: string, data: unknown) {
    const msg: RealtimeMessage = { channel, type, data, ts: new Date().toISOString() };
    this.recent.push(msg);
    if (this.recent.length > 2000) this.recent.splice(0, 1000);
    const subs = this.byChannel.get(channel);
    if (!subs) return;
    const raw = JSON.stringify(msg);
    for (const c of subs) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(raw);
  }

  toUser(userId: string, type: string, data: unknown) { this.publish(userChannel(userId), type, data); }

  private join(c: Conn, channel: string) {
    c.channels.add(channel);
    if (!this.byChannel.has(channel)) this.byChannel.set(channel, new Set());
    this.byChannel.get(channel)!.add(c);
  }

  private leave(c: Conn, channel: string) {
    c.channels.delete(channel);
    const s = this.byChannel.get(channel);
    s?.delete(c);
    if (s && s.size === 0) this.byChannel.delete(channel);
  }

  private send(c: Conn, channel: string, type: string, data: unknown) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ channel, type, data, ts: new Date().toISOString() }));
  }

  /** Handle upgrades on `path` of an http.Server. */
  attach(server: Server, resolveDevUser: (subject: string) => Promise<string>, path = '/api/v1/realtime') {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    server.on('upgrade', (req: IncomingMessage, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== path) return;
      void (async () => {
        let userId = url.searchParams.get('ticket') ? this.redeem(url.searchParams.get('ticket')!) : undefined;
        const dev = url.searchParams.get('dev_user');
        if (!userId && dev && this.devHeader) userId = await resolveDevUser(dev).catch(() => undefined);
        if (!userId) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        this.wss!.handleUpgrade(req, socket, head, (ws) => this.accept(ws, userId!));
      })();
    });
  }

  private accept(ws: WebSocket, userId: string) {
    const c: Conn = { ws, userId, channels: new Set() };
    this.conns.add(c);
    const own = userChannel(userId);
    this.join(c, own);
    this.send(c, own, 'hello', { user_id: encodeId('user', userId), channels: [own] });
    ws.on('message', (raw) => {
      void (async () => {
        let msg: { op?: string; channel?: string };
        try { msg = JSON.parse(String(raw)); } catch { return this.send(c, own, 'error', { message: 'invalid JSON' }); }
        if (msg.op === 'ping') return this.send(c, own, 'pong', {});
        if (typeof msg.channel !== 'string' || msg.channel.length > 64) return this.send(c, own, 'error', { message: 'channel required' });
        if (msg.op === 'unsubscribe') return this.leave(c, msg.channel);
        if (msg.op !== 'subscribe') return this.send(c, own, 'error', { message: `unknown op ${msg.op}` });
        if (msg.channel === own) return;
        if (!(await this.policy.authorize(userId, msg.channel).catch(() => false))) {
          return this.send(c, own, 'error', { message: `not allowed to subscribe to ${msg.channel}`, channel: msg.channel });
        }
        this.join(c, msg.channel);
        for (const m of (await this.policy.onSubscribe?.(userId, msg.channel).catch((err) => {
          this.logger?.warn({ err }, 'realtime snapshot failed');
          return [];
        })) ?? []) this.send(c, msg.channel, m.type, m.data);
        this.send(c, msg.channel, 'subscribed', { channel: msg.channel });
      })();
    });
    ws.on('close', () => {
      for (const ch of [...c.channels]) this.leave(c, ch);
      this.conns.delete(c);
    });
    ws.on('error', () => ws.close());
  }

  close() {
    for (const c of this.conns) c.ws.close(1001, 'server shutting down');
    this.wss?.close();
  }
}
