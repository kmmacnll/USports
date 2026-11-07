'use server';

import { redirect } from 'next/navigation';

import { api, ApiError } from './api';
import { clearSession, devSignInEnabled, setDevUser, setToken } from './session';
import type { ActionResult } from './types';

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.body };
    throw err;
  }
}

// ---- session

export async function signUp(_: unknown, form: FormData): Promise<ActionResult> {
  const password = String(form.get('password') ?? '');
  const confirmation = String(form.get('password_confirmation') ?? '');
  if (password !== confirmation) return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Passwords do not match' } };
  const result = await run(() => api<{ token: string }>('/auth/signup', {
    method: 'POST', auth: false,
    body: {
      name: String(form.get('name') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      password,
      password_confirmation: confirmation,
      university: String(form.get('university') ?? '') || undefined,
    },
  }));
  if (!result.ok) return result;
  await setToken(result.data.token);
  redirect('/');
}

export async function signIn(_: unknown, form: FormData): Promise<ActionResult> {
  const result = await run(() => api<{ token: string }>('/auth/login', {
    method: 'POST', auth: false,
    body: { email: String(form.get('email') ?? '').trim(), password: String(form.get('password') ?? '') },
  }));
  if (!result.ok) return result;
  await setToken(result.data.token);
  redirect('/');
}

export async function signInAsDevUser(_: unknown, form: FormData): Promise<ActionResult> {
  if (!devSignInEnabled()) return { ok: false, error: { code: 'DISABLED', message: 'Dev sign-in is disabled' } };
  const name = String(form.get('name') ?? '').trim();
  if (!/^[\w.-]{2,40}$/.test(name)) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Use 2-40 letters, digits, dots or dashes' } };
  }
  await setDevUser(name);
  redirect('/');
}

export async function signOut() {
  await clearSession();
  redirect('/');
}
