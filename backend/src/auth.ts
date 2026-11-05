import type { RequestHandler } from 'express';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

import type { Config } from './config.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';

export interface AuthUser {
  id: string;
  authSubject: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Authenticates the request and provisions a `users` row on first sight.
 *
 *  - `Authorization: Bearer <jwt>` verified with JWT_SECRET (HS256) or JWT_JWKS_URL.
 *  - `X-Dev-User: <subject>` when AUTH_DEV_HEADER=true (never in production).
 */
export function authenticate(cfg: Config, db: Db): RequestHandler {
  const secret = cfg.JWT_SECRET ? new TextEncoder().encode(cfg.JWT_SECRET) : undefined;
  const jwks: JWTVerifyGetKey | undefined = cfg.JWT_JWKS_URL ? createRemoteJWKSet(new URL(cfg.JWT_JWKS_URL)) : undefined;
  const verifyOpts = {
    ...(cfg.JWT_ISSUER ? { issuer: cfg.JWT_ISSUER } : {}),
    ...(cfg.JWT_AUDIENCE ? { audience: cfg.JWT_AUDIENCE } : {}),
  };

  async function verify(token: string): Promise<JWTPayload> {
    try {
      // HS256 tokens are minted by this API itself (PIN sign-in, npm run token)
      // and are always checked against JWT_SECRET, even when an identity
      // provider (JWKS) is also configured.
      const alg = decodeProtectedHeader(token).alg;
      if (alg === 'HS256' && secret) {
        return (await jwtVerify(token, secret, { algorithms: ['HS256'] })).payload;
      }
      if (jwks) return (await jwtVerify(token, jwks, verifyOpts)).payload;
    } catch {
      throw new HttpError(401, 'INVALID_TOKEN', 'Invalid or expired token');
    }
    throw new HttpError(401, 'UNAUTHENTICATED', 'Bearer tokens are not configured on this server');
  }

  return async (req, _res, next) => {
    let subject: string | undefined;
    let displayName: string | undefined;
    let email: string | undefined;

    const header = req.get('authorization');
    const devUser = cfg.AUTH_DEV_HEADER ? req.get('x-dev-user') : undefined;
    if (header?.startsWith('Bearer ')) {
      const claims = await verify(header.slice(7).trim());
      subject = claims.sub;
      displayName = typeof claims.name === 'string' ? claims.name : undefined;
      email = typeof claims.email === 'string' ? claims.email : undefined;
    } else if (devUser) {
      subject = devUser;
    }
    if (!subject) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
    if (subject.length > 255) throw new HttpError(401, 'INVALID_TOKEN', 'Subject too long');

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (auth_subject, display_name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (auth_subject) DO UPDATE
          SET display_name = coalesce($4, users.display_name),
              email        = coalesce(EXCLUDED.email, users.email)
        WHERE $4 IS NOT NULL OR (EXCLUDED.email IS NOT NULL AND EXCLUDED.email IS DISTINCT FROM users.email)
       RETURNING id`,
      [subject, displayName ?? 'Player', email ?? null, displayName ?? null],
    );
    const id = rows[0]?.id ?? (await db.query<{ id: string }>(
      'SELECT id FROM users WHERE auth_subject = $1', [subject])).rows[0]?.id;
    if (!id) throw new HttpError(500, 'INTERNAL', 'Could not load user');
    req.user = { id, authSubject: subject };
    next();
  };
}

export function requireUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
  return req.user;
}
