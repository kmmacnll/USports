import 'server-only';

import { cache } from 'react';

import { getCredentials } from './session';
import type { ApiErrorBody, Me } from './types';

/**
 * Reusable server-side client for the VarsityHQ API.
 *
 * Configured by environment variables (read on the server only, so they are
 * never shipped to the browser):
 *   API_HOSTPORT  host:port of the API on Render's private network (set by render.yaml)
 *   API_BASE_URL  full base URL incl. /api/v1 (local dev, or any other host)
 *
 * The session's bearer token (httpOnly cookie) is attached automatically.
 */
export function apiBaseUrl(): string {
  const hostport = process.env.API_HOSTPORT;
  if (hostport) return `http://${hostport}/api/v1`;
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error('Set API_BASE_URL (e.g. http://localhost:3000/api/v1) or API_HOSTPORT');
  return base.replace(/\/+$/, '');
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody) {
    super(body.message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  /** Send the session's credentials (default true). Public data can skip them. */
  auth?: boolean;
  /** Seconds to cache a GET in Next's data cache; omit for no caching. */
  revalidate?: number;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = new URL(`${apiBaseUrl()}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const creds = await getCredentials();
    if (creds && 'token' in creds) headers.Authorization = `Bearer ${creds.token}`;
    if (creds && 'devUser' in creds) headers['X-Dev-User'] = creds.devUser;
  }

  const cacheable = (opts.method ?? 'GET') === 'GET' && opts.revalidate !== undefined && opts.auth === false;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      ...(cacheable ? { next: { revalidate: opts.revalidate } } : { cache: 'no-store' as const }),
    });
  } catch (err) {
    throw new ApiError(503, { code: 'API_UNREACHABLE', message: `Could not reach the API (${(err as Error).message})` });
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, json?.error ?? { code: 'HTTP_' + res.status, message: res.statusText });
  }
  return json as T;
}

/** Like api(), but resolves to null on 401/404 (signed out, or no access). */
export async function apiOrNull<T>(path: string, opts?: ApiOptions): Promise<T | null> {
  try {
    return await api<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return null;
    throw err;
  }
}

/**
 * The signed-in user, or null. Memoised per request, so the nav and the page
 * share one /me call instead of making two.
 */
export const getMe = cache(async (): Promise<Me | null> =>
  ((await getCredentials()) ? apiOrNull<Me>('/me').catch(() => null) : null));
