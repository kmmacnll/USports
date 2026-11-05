import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { errorHandler } from '../src/errors.js';
import { pinAuthRouter, pinSubject } from '../src/pin-auth.js';

const SECRET = 'pin-test-secret-pin-test-secret-0123456';
// Dummy PIN for tests only. The real PIN lives in the ACCESS_PIN env var, never in Git.
const PIN = '8020';
let db: Db;

beforeAll(() => { db = createPool(process.env.TEST_DATABASE_URL!, 2); });
afterAll(() => db.end());

const appWith = (env: Record<string, string>) =>
  createApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL!, JWT_SECRET: SECRET, ...env }),
    db, pino({ level: 'silent' }));

describe('PIN sign-in', () => {
  it('is disabled unless ACCESS_PIN is set', async () => {
    const res = await request(appWith({})).post('/api/v1/auth/pin').send({ pin: PIN, name: 'Kieran' }).expect(404);
    expect(res.body.error.code).toBe('PIN_DISABLED');
  });

  it('issues a working token for the right PIN, one account per name', async () => {
    const app = appWith({ ACCESS_PIN: PIN });
    const ok = await request(app).post('/api/v1/auth/pin').send({ pin: PIN, name: 'Kieran MacNeill' }).expect(200);
    expect(ok.body).toMatchObject({ token_type: 'Bearer', subject: 'pin:kieran-macneill', display_name: 'Kieran MacNeill' });

    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${ok.body.token}`).expect(200);
    expect(me.body.display_name).toBe('Kieran MacNeill');

    const again = await request(app).post('/api/v1/auth/pin').send({ pin: PIN, name: 'kieran macneill' }).expect(200);
    const me2 = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${again.body.token}`).expect(200);
    expect(me2.body.user_id).toBe(me.body.user_id);

    const other = await request(app).post('/api/v1/auth/pin').send({ pin: PIN, name: 'Sam' }).expect(200);
    const me3 = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${other.body.token}`).expect(200);
    expect(me3.body.user_id).not.toBe(me.body.user_id);
  });

  it('validates the name', async () => {
    const res = await request(appWith({ ACCESS_PIN: PIN })).post('/api/v1/auth/pin').send({ pin: PIN, name: 'x' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rate limits wrong PINs per client and recovers after the window', async () => {
    let t = 1_000_000;
    const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'x', JWT_SECRET: SECRET, ACCESS_PIN: PIN });
    const app = express().use(express.json()).use(pinAuthRouter(cfg, () => t)).use(errorHandler);
    const attempt = (pin: string) => request(app).post('/auth/pin').send({ pin, name: 'Guesser' });

    for (let i = 4; i >= 1; i--) {
      expect((await attempt('0000')).body.error.message).toBe(`Wrong PIN (${i} attempt${i === 1 ? '' : 's'} left)`);
    }
    expect((await attempt('0000')).status).toBe(401);
    const locked = await attempt(PIN);           // even the right PIN is refused while locked
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    t += 15 * 60_000 + 1;
    expect((await attempt(PIN)).status).toBe(200);
  });

  it('rejects a non-numeric ACCESS_PIN at startup', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x', JWT_SECRET: SECRET, ACCESS_PIN: 'abcd' })).toThrow(/ACCESS_PIN/);
  });

  it('slugs names into stable subjects', () => {
    expect(pinSubject('Zoë  O\'Neil')).toBe('pin:zoe-o-neil');
    expect(pinSubject('...')).toBe('pin:player');
  });
});
