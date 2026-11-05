'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { api, ApiError } from './api';
import { clearSession, devSignInEnabled, rememberName, setDevUser, setToken } from './session';
import type { ActionResult, AthleteDetail, Athlete, League, Paginated, Roster } from './types';

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.body };
    throw err;
  }
}

// ---- session

export async function signInWithPin(_: unknown, form: FormData): Promise<ActionResult> {
  const name = String(form.get('name') ?? '').trim();
  const pin = String(form.get('pin') ?? '').trim();
  const result = await run(() => api<{ token: string }>('/auth/pin', { method: 'POST', auth: false, body: { name, pin } }));
  if (!result.ok) return result;
  await setToken(result.data.token);
  await rememberName(name);
  redirect('/');
}

export async function signInWithToken(_: unknown, form: FormData): Promise<ActionResult> {
  const token = String(form.get('token') ?? '').trim();
  if (!token) return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Paste a token' } };
  await setToken(token);
  const check = await run(() => api('/me'));
  if (!check.ok) {
    await clearSession();
    return check;
  }
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

// ---- terms

export async function acceptTerms(_: unknown, form: FormData): Promise<ActionResult> {
  const isAthlete = form.get('is_usports_athlete') === 'yes';
  const result = await run(() => api('/me/terms', {
    method: 'PUT',
    body: {
      terms_version: String(form.get('terms_version')),
      is_usports_athlete: isAthlete,
      athlete_sports: isAthlete ? form.getAll('athlete_sports').map(String) : [],
    },
  }));
  if (result.ok) revalidatePath('/');
  return result.ok ? { ok: true, data: undefined } : result;
}

// ---- leagues

export async function createLeague(_: unknown, form: FormData): Promise<ActionResult<League>> {
  const result = await run(() => api<League>('/leagues', {
    method: 'POST',
    body: {
      league_name: String(form.get('league_name') ?? ''),
      sport: String(form.get('sport') ?? ''),
      max_teams: Number(form.get('max_teams') ?? 10),
      team_name: String(form.get('team_name') ?? '') || undefined,
    },
  }));
  if (result.ok) redirect(`/leagues/${result.data.league_id}`);
  return result;
}

export async function joinLeague(_: unknown, form: FormData): Promise<ActionResult> {
  const leagueId = String(form.get('league_id') ?? '').trim();
  const result = await run(() => api(`/leagues/${encodeURIComponent(leagueId)}/teams`, {
    method: 'POST',
    body: { team_name: String(form.get('team_name') ?? ''), invite_code: String(form.get('invite_code') ?? '') || undefined },
  }));
  if (result.ok) redirect(`/leagues/${leagueId}`);
  return result.ok ? { ok: true, data: undefined } : result;
}

// ---- rosters

export async function swapSlot(leagueId: string, athleteId: string, slot: string, slotIndex: number) {
  const result = await run(() => api<Roster>(`/leagues/${leagueId}/roster/swap`, {
    method: 'POST', body: { athlete_id: athleteId, target_slot: slot, target_slot_index: slotIndex },
  }));
  if (result.ok) revalidatePath(`/leagues/${leagueId}`);
  return result;
}

export async function addAthlete(leagueId: string, athleteId: string) {
  const result = await run(() => api<Roster>(`/leagues/${leagueId}/roster`, {
    method: 'POST', body: { athlete_id: athleteId },
  }));
  if (result.ok) revalidatePath(`/leagues/${leagueId}`);
  return result;
}

export async function dropAthlete(leagueId: string, athleteId: string) {
  const result = await run(() => api<Roster>(`/leagues/${leagueId}/roster/${athleteId}`, { method: 'DELETE' }));
  if (result.ok) revalidatePath(`/leagues/${leagueId}`);
  return result;
}

export async function searchAvailable(leagueId: string, q: string, position: string) {
  return run(() => api<Paginated<Athlete>>(`/leagues/${leagueId}/available`, {
    query: { q: q.trim() || undefined, position: position || undefined, page_size: 10 },
  }));
}

// ---- athletes (popovers)

export async function loadAthlete(athleteId: string) {
  return run(() => api<AthleteDetail>(`/athletes/${athleteId}`, { auth: false }));
}
