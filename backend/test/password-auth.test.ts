import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { errorHandler } from '../src/errors.js';
import { hashPassword, passwordAuthRouter, verifyPassword } from '../src/password-auth.js';

const SECRET = 'pwd-test-secret-pwd-test-secret-0123456';
let db: Db;

beforeAll(() => { db = createPool(process.env.TEST_DATABASE_URL!, 2); });
afterAll(() => db.end());

const appWith = (env: Record<string, string> = { JWT_SECRET: SECRET }) =>
  createApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL!, AUTH_DEV_HEADER: 'true', ...env }),
    db, pino({ level: 'silent' }));

const signup = (app: express.Express, email: string, password = 'correct horse', confirm = password, extra: object = {}) =>
  request(app).post('/api/v1/auth/signup').send({ name: 'Test Person', email, password, password_confirmation: confirm, ...extra });

describe('email + password sign-up', () => {
  it('creates an account, stores a hash, and issues a working token', async () => {
    const app = appWith();
    const res = await signup(app, ' Kieran@Example.com ').expect(201);
    expect(res.body).toMatchObject({ token_type: 'Bearer', email: 'kieran@example.com', display_name: 'Test Person' });

    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
    expect(me.body).toMatchObject({ display_name: 'Test Person', university: null });

    const { rows } = await db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = 'kieran@example.com'");
    expect(rows[0]!.password_hash).toMatch(/^scrypt\$/);
    expect(rows[0]!.password_hash).not.toContain('correct horse');

    const login = await request(app).post('/api/v1/auth/login')
      .send({ email: 'KIERAN@example.com', password: 'correct horse' }).expect(200);
    const me2 = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${login.body.token}`).expect(200);
    expect(me2.body.user_id).toBe(me.body.user_id);
  });

  it('stores the chosen name and optional university', async () => {
    const app = appWith();
    const res = await signup(app, 'uni@example.com', 'password1', 'password1', { name: '  Sam Lee ', university: 'alpha' }).expect(201);
    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
    expect(me.body).toMatchObject({ display_name: 'Sam Lee', university: { university_id: 'alpha', name: 'Alpha U' } });

    const blank = await signup(app, 'nouni@example.com', 'password1', 'password1', { university: '' }).expect(201);
    expect((await request(app).get('/api/v1/me').set('Authorization', `Bearer ${blank.body.token}`)).body.university).toBeNull();

    expect((await signup(app, 'bad@example.com', 'password1', 'password1', { university: 'nowhere' }).expect(400)).body.error.message)
      .toBe('Unknown university');
    expect((await signup(app, 'noname@example.com', 'password1', 'password1', { name: 'x' }).expect(400)).body.error.message)
      .toMatch(/Name/);
  });

  it('rejects a duplicate email', async () => {
    const app = appWith();
    await signup(app, 'dup@example.com').expect(201);
    const res = await signup(app, 'DUP@example.com').expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates email, password length and confirmation', async () => {
    const app = appWith();
    expect((await signup(app, 'not-an-email').expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await signup(app, 'short@example.com', 'abc').expect(400)).body.error.message).toMatch(/8 characters/);
    expect((await signup(app, 'mismatch@example.com', 'password1', 'password2').expect(400)).body.error.message)
      .toMatch(/do not match/);
  });

  it('rejects a wrong password or unknown email the same way', async () => {
    const app = appWith();
    await signup(app, 'wrong@example.com').expect(201);
    const bad = await request(app).post('/api/v1/auth/login').send({ email: 'wrong@example.com', password: 'nope' }).expect(401);
    const none = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'nope' }).expect(401);
    expect(bad.body.error).toEqual(none.body.error);
  });

  it('is disabled without JWT_SECRET', async () => {
    const res = await signup(appWith({}), 'nosecret@example.com').expect(404);
    expect(res.body.error.code).toBe('AUTH_DISABLED');
  });

  it('rate limits failed logins per client and recovers after the window', async () => {
    let t = 1_000_000;
    const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'x', JWT_SECRET: SECRET });
    await signup(appWith(), 'limited@example.com', 'right-password').expect(201);
    const app = express().use(express.json()).use(passwordAuthRouter(cfg, db, () => t)).use(errorHandler);
    const attempt = (password: string) => request(app).post('/auth/login').send({ email: 'limited@example.com', password });

    for (let i = 0; i < 10; i++) expect((await attempt('wrong')).status).toBe(401);
    const locked = await attempt('right-password');
    expect(locked.status).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    t += 15 * 60_000 + 1;
    expect((await attempt('right-password')).status).toBe(200);
  });

  it('hashes with a random salt', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('other', a)).toBe(false);
  });
});
