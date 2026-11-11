// Response shapes of the VarsityHQ API (backend/README.md).

export interface University { university_id: string; name: string; conference: string | null }

export interface Me {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  university: { university_id: string; name: string } | null;
  teams: { team_id: string; team_name: string; league_id: string; league_name: string; sport: string }[];
}

export interface ApiErrorBody { code: string; message: string; details?: unknown }

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };
