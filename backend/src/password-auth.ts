import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

import { Router } from 'express';
import { SignJWT } from 'jose';
import { z } from 'zod';

import type { Config } from './config.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';

/**
 * Email + password accounts, stored in users.password_hash (scrypt).
 *
 *   POST /api/v1/auth/signup { email, password, password_confirmation } -> 201 token
 *   POST /api/v1/auth/login  { email, password }                        -> 200 token
 *
 * Tokens are 30-day HS256 JWTs signed with JWT_SECRET, for the subject
 * "local:<uuid>" stored in users.auth_subject. Failed logins are rate limited
 * per client IP (PER_IP_FAILURES per window); the limiter is in memory, so it
 * resets on restart and assumes a single API instance.
 */
const WINDOW_MS = 15 * 60_000;
const PER_IP_FAILURES = 10;
const TOKEN_TTL_S = 30 * 24 * 3600;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'));
const SignupBody = z.object({
  email,
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password must be at most 128 characters'),
  password_confirmation: z.string(),
}).refine((b) => b.password === b.password_confirmation, { message: 'Passwords do not match', path: ['password_confirmation'] });
const LoginBody = z.object({ email, password: z.string().min(1, 'Enter your password').max(128) });

/** Like schema.parse, but the error message is the first problem, ready to show in a form. */
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  throw new HttpError(400, 'VALIDATION_ERROR', r.error.issues[0]?.message ?? 'Invalid request', r.error.issues);
}

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((res, rej) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? rej(err) : res(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const key = await scrypt(password, salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length,
    { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

// Checked against when the email is unknown, so both cases take as long.
let dummyHash: Promise<string> | undefined;

/** "kieran.macneill@example.com" -> "kieran.macneill" */
export const nameFromEmail = (e: string) => e.split('@')[0]!.slice(0, 40) || 'Player';

export function passwordAuthRouter(cfg: Config, db: Db, now: () => number = Date.now): Router {
  const r = Router();
  const failures = new Map<string, number[]>();
  const recent = (list: number[]) => list.filter((t) => now() - t < WINDOW_MS);

  const issue = async (subject: string, userEmail: string, displayName: string) => {
    const token = await new SignJWT({ email: userEmail, amr: ['pwd'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL_S}s`)
      .sign(new TextEncoder().encode(cfg.JWT_SECRET));
    return { token, token_type: 'Bearer', expires_in: TOKEN_TTL_S, email: userEmail, display_name: displayName };
  };

  const requireSecret = () => {
    if (!cfg.JWT_SECRET) throw new HttpError(404, 'AUTH_DISABLED', 'Email sign-in is not enabled on this server');
  };

  r.post('/auth/signup', async (req, res) => {
    requireSecret();
    const body = parse(SignupBody, req.body);
    const subject = `local:${randomUUID()}`;
    const displayName = nameFromEmail(body.email);
    try {
      await db.query(
        'INSERT INTO users (auth_subject, email, display_name, password_hash) VALUES ($1, $2, $3, $4)',
        [subject, body.email, displayName, await hashPassword(body.password)],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw err;
    }
    res.status(201).json(await issue(subject, body.email, displayName));
  });

  r.post('/auth/login', async (req, res) => {
    requireSecret();
    const ip = req.ip ?? 'unknown';
    const mine = recent(failures.get(ip) ?? []);
    if (mine.length >= PER_IP_FAILURES) {
      const retry = Math.max(1, Math.ceil((Math.min(...mine) + WINDOW_MS - now()) / 1000));
      res.set('Retry-After', String(retry));
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', `Too many failed sign-ins. Try again in ${Math.ceil(retry / 60)} min.`);
    }

    const body = parse(LoginBody, req.body);
    const { rows } = await db.query<{ auth_subject: string; display_name: string; password_hash: string | null }>(
      'SELECT auth_subject, display_name, password_hash FROM users WHERE email = $1', [body.email]);
    const user = rows[0];
    const ok = await verifyPassword(body.password, user?.password_hash ?? await (dummyHash ??= hashPassword(randomUUID())));
    if (!user?.password_hash || !ok) {
      failures.set(ip, [...mine, now()]);
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Wrong email or password');
    }

    failures.delete(ip);
    res.json(await issue(user.auth_subject, body.email, user.display_name));
  });

  return r;
}
