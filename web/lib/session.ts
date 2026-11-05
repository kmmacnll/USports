import 'server-only';

import { cookies } from 'next/headers';

const TOKEN_COOKIE = 'vhq_token';
const DEV_COOKIE = 'vhq_dev_user';
const NAME_COOKIE = 'vhq_name';

export const devSignInEnabled = () =>
  process.env.NODE_ENV !== 'production' && process.env.DEV_SIGN_IN === 'true';

export type Credentials = { token: string } | { devUser: string } | null;

export async function getCredentials(): Promise<Credentials> {
  const jar = await cookies();
  const token = jar.get(TOKEN_COOKIE)?.value;
  if (token) return { token };
  const devUser = devSignInEnabled() ? jar.get(DEV_COOKIE)?.value : undefined;
  return devUser ? { devUser } : null;
}

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};

export async function setToken(token: string) {
  const jar = await cookies();
  jar.delete(DEV_COOKIE);
  jar.set(TOKEN_COOKIE, token, cookieOpts);
}

export async function setDevUser(name: string) {
  const jar = await cookies();
  jar.delete(TOKEN_COOKIE);
  jar.set(DEV_COOKIE, name, cookieOpts);
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(TOKEN_COOKIE);
  jar.delete(DEV_COOKIE);
}

/** The name last used with PIN sign-in, to prefill the form on this device. */
export async function getRememberedName(): Promise<string | undefined> {
  return (await cookies()).get(NAME_COOKIE)?.value;
}

export async function rememberName(name: string) {
  (await cookies()).set(NAME_COOKIE, name, { ...cookieOpts, maxAge: 60 * 60 * 24 * 365 });
}
