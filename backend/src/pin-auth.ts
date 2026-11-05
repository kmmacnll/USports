import { createHash, timingSafeEqual } from 'node:crypto';

import { Router } from 'express';
import { SignJWT } from 'jose';
import { z } from 'zod';

import type { Config } from './config.js';
import { HttpError } from './errors.js';

/**
 * Shared-PIN sign-in for the web app: POST /api/v1/auth/pin { pin, name }.
 * A correct PIN returns a 30-day HS256 token for the user "pin:<name>", so
 * each person who signs in with their own name gets their own account and teams.
 *
 * A 4-digit PIN has only 10,000 values, so failures are rate limited:
 * PER_IP_FAILURES per client IP and GLOBAL_FAILURES across all clients per
 * window. The limiter is in memory, so it resets on restart and assumes a
 * single API instance.
 */
const WINDOW_MS = 15 * 60_000;
const PER_IP_FAILURES = 5;
const GLOBAL_FAILURES = 50;
const TOKEN_TTL = '30d';

const Body = z.object({
  pin: z.string().trim().regex(/^\d{1,12}$/, 'PIN must be digits'),
  name: z.string().trim().min(2, 'Enter your name (2-40 characters)').max(40)
    .regex(/^[\p{L}\p{N} .'-]+$/u, 'Names can use letters, numbers, spaces, dots, apostrophes and dashes'),
});

const digest = (s: string) => createHash('sha256').update(s).digest();

/** "Kieran MacNeill" -> "pin:kieran-macneill" (accents stripped). */
export function pinSubject(name: string): string {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `pin:${slug || 'player'}`;
}

export function pinAuthRouter(cfg: Config, now: () => number = Date.now): Router {
  const r = Router();
  const failures = new Map<string, number[]>();
  let global: number[] = [];
  const recent = (list: number[]) => list.filter((t) => now() - t < WINDOW_MS);

  r.post('/auth/pin', async (req, res) => {
    if (!cfg.ACCESS_PIN || !cfg.JWT_SECRET) {
      throw new HttpError(404, 'PIN_DISABLED', 'PIN sign-in is not enabled on this server');
    }
    const ip = req.ip ?? 'unknown';
    const mine = recent(failures.get(ip) ?? []);
    global = recent(global);
    if (mine.length >= PER_IP_FAILURES || global.length >= GLOBAL_FAILURES) {
      const oldest = Math.min(...(mine.length >= PER_IP_FAILURES ? mine : global));
      const retry = Math.max(1, Math.ceil((oldest + WINDOW_MS - now()) / 1000));
      res.set('Retry-After', String(retry));
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', `Too many wrong PINs. Try again in ${Math.ceil(retry / 60)} min.`);
    }

    const body = Body.parse(req.body);
    if (!timingSafeEqual(digest(body.pin), digest(cfg.ACCESS_PIN))) {
      failures.set(ip, [...mine, now()]);
      global.push(now());
      const left = PER_IP_FAILURES - mine.length - 1;
      throw new HttpError(401, 'WRONG_PIN', left > 0 ? `Wrong PIN (${left} attempt${left === 1 ? '' : 's'} left)` : 'Wrong PIN');
    }

    failures.delete(ip);
    const subject = pinSubject(body.name);
    const token = await new SignJWT({ name: body.name, amr: ['pin'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime(TOKEN_TTL)
      .sign(new TextEncoder().encode(cfg.JWT_SECRET));
    res.json({ token, token_type: 'Bearer', expires_in: 30 * 24 * 3600, subject, display_name: body.name });
  });

  return r;
}
