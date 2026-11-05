import { pino } from 'pino';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';

const base = { NODE_ENV: 'production', DATABASE_URL: process.env.TEST_DATABASE_URL!, JWT_SECRET: 'x'.repeat(40) };

describe('config', () => {
  it('treats blank optional variables as unset (hosts set sync:false keys to "")', () => {
    const cfg = loadConfig({ ...base, JWT_JWKS_URL: '', JWT_ISSUER: '', JWT_AUDIENCE: ' ', MIGRATE_ON_START: '' });
    expect(cfg.JWT_JWKS_URL).toBeUndefined();
    expect(cfg.JWT_AUDIENCE).toBeUndefined();
    expect(cfg.MIGRATE_ON_START).toBe(false);
  });

  it('still rejects a malformed non-blank value', () => {
    expect(() => loadConfig({ ...base, JWT_JWKS_URL: 'not a url' })).toThrow(/JWT_JWKS_URL/);
  });
});

describe('readiness gate', () => {
  const db = createPool(process.env.TEST_DATABASE_URL!, 2);
  afterAll(() => db.end());

  it('answers 503 until ready, then serves normally', async () => {
    let ready = false;
    const app = createApp(loadConfig(base), db, pino({ level: 'silent' }), () => ready);
    expect((await request(app).get('/healthz')).status).toBe(503);
    const api = await request(app).get('/api/v1/sports');
    expect(api.status).toBe(503);
    expect(api.body.error.code).toBe('STARTING');
    ready = true;
    expect((await request(app).get('/healthz')).body).toEqual({ status: 'ok' });
    expect((await request(app).get('/api/v1/sports')).status).toBe(200);
  });
});
