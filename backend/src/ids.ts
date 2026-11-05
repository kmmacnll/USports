import { HttpError } from './errors.js';

/** Public id prefixes. Internal ids are BIGINTs (strings in node-postgres). */
const PREFIX = {
  athlete: 'usports_ath_',
  league: 'lg_',
  user: 'usr_',
  team: 'tm_',
} as const;

export type IdKind = keyof typeof PREFIX;

export const encodeId = (kind: IdKind, id: string | number | bigint): string => `${PREFIX[kind]}${id}`;

/** Accepts the prefixed public id (or a bare numeric id) and returns the internal id. */
export function decodeId(kind: IdKind, value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new HttpError(400, 'INVALID_ID', `Expected a ${kind} id`);
  }
  let v = String(value);
  if (v.startsWith(PREFIX[kind])) v = v.slice(PREFIX[kind].length);
  if (!/^[1-9]\d{0,17}$/.test(v)) {
    throw new HttpError(400, 'INVALID_ID', `'${value}' is not a valid ${kind} id (expected ${PREFIX[kind]}<number>)`);
  }
  return v;
}
