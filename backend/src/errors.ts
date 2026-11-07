import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found`);

/**
 * Database rules raise SQLSTATE 23514 with a stable HINT (see db/README.md);
 * those map straight to API error codes.
 */
const HINT_STATUS: Record<string, number> = {
  LEAGUE_FULL: 409,
  INVALID_SLOT: 422,
  INELIGIBLE_POSITION: 422,
  WRONG_SPORT: 422,
};

const UNIQUE_CODES: Record<string, [string, string]> = {
  roster_spots_league_athlete_key: ['ATHLETE_ALREADY_ROSTERED', 'That athlete is already on a roster in this league'],
  roster_spots_slot_key: ['SLOT_OCCUPIED', 'That roster slot is already filled'],
  fantasy_teams_league_user_key: ['ALREADY_IN_LEAGUE', 'You already have a team in this league'],
  fantasy_teams_league_name_key: ['TEAM_NAME_TAKEN', 'Another team in this league already uses that name'],
};

interface PgError {
  code: string;
  hint?: string;
  constraint?: string;
  message: string;
}

function isPgError(err: unknown): err is PgError {
  return typeof err === 'object' && err !== null && typeof (err as PgError).code === 'string'
    && /^[0-9A-Z]{5}$/.test((err as PgError).code);
}

export function toHttpError(err: unknown): HttpError | undefined {
  if (err instanceof HttpError) return err;
  if (err instanceof ZodError) {
    return new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  if (!isPgError(err)) return undefined;
  switch (err.code) {
    case '23514': {
      const status = err.hint ? HINT_STATUS[err.hint] : undefined;
      if (status && err.hint) return new HttpError(status, err.hint, err.message);
      return new HttpError(422, 'CONSTRAINT_VIOLATION', 'The request breaks a data rule',
        err.constraint ? { constraint: err.constraint } : undefined);
    }
    case '23505': {
      const known = err.constraint ? UNIQUE_CODES[err.constraint] : undefined;
      return known
        ? new HttpError(409, known[0], known[1])
        : new HttpError(409, 'CONFLICT', 'That already exists', { constraint: err.constraint });
    }
    case '23503':
      return new HttpError(422, 'INVALID_REFERENCE', 'A referenced record does not exist');
    case '22P02':
    case '22003':
      return new HttpError(400, 'INVALID_INPUT', 'Invalid value in request');
    default:
      return undefined;
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const http = toHttpError(err);
  if (!http) {
    req.log?.error({ err }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
    return;
  }
  if (http.status >= 500) req.log?.error({ err }, http.message);
  res.status(http.status).json({
    error: { code: http.code, message: http.message, ...(http.details ? { details: http.details } : {}) },
  });
};
