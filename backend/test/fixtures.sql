-- Synthetic fixtures for API tests (not real athletes).
INSERT INTO universities (name, slug, conference, is_usports_member) VALUES
  ('Alpha U', 'alpha', 'OUA', TRUE), ('Beta U', 'beta', 'CW', TRUE);

INSERT INTO athletes (first_name, last_name, university_id, sport_id, position, positions)
SELECT v.f, v.l, u.id, s.id, v.pos, v.toks
  FROM (VALUES
    ('Gary',   'Guard',    'alpha', 'usports_mbk', 'G',   '{G}'::text[]),
    ('Gina',   'Guardson', 'alpha', 'usports_mbk', 'G',   '{G}'),
    ('Carl',   'Centre',   'beta',  'usports_mbk', 'C',   '{C}'),
    ('Fred',   'Forward',  'beta',  'usports_mbk', 'F',   '{F}'),
    ('Nora',   'Noposition','beta', 'usports_mbk', NULL,  '{}'),
    ('Quinn',  'Back',     'alpha', 'usports_fb',  'QB',  '{QB}')
  ) v(f, l, uslug, scode, pos, toks)
  JOIN universities u ON u.slug = v.uslug
  JOIN sports s ON s.code = v.scode;

INSERT INTO games (sport_id, source_game_id, season, season_segment, game_date,
                   home_university_id, away_university_id, status, home_score, away_score)
SELECT s.id, g.id, '2026-27', '2026-27', g.d::date, a.id, b.id, 'FINAL', 80, 70
  FROM (VALUES ('t1', '2026-11-01'), ('t2', '2026-11-03')) g(id, d), sports s, universities a, universities b
 WHERE s.code = 'usports_mbk' AND a.slug = 'alpha' AND b.slug = 'beta';
INSERT INTO games (sport_id, source_game_id, season, season_segment, game_date,
                   home_university_id, away_university_id, status, is_exhibition)
SELECT s.id, 'x1', '2026-27', '2026-27', '2026-08-01', a.id, b.id, 'FINAL', TRUE
  FROM sports s, universities a, universities b
 WHERE s.code = 'usports_mbk' AND a.slug = 'alpha' AND b.slug = 'beta';

-- Gary: 20/5 and 10/5 in league games, 50 points in an exhibition (must be ignored).
INSERT INTO game_stats (athlete_id, game_id, game_date, university_id, opponent_id, raw_stats_json)
SELECT a.id, g.id, g.game_date, g.home_university_id, g.away_university_id, v.stats::jsonb
  FROM (VALUES ('Guard', 't1', '{"points":20,"rebounds":5}'),
               ('Guard', 't2', '{"points":10,"rebounds":5}'),
               ('Guard', 'x1', '{"points":50}'),
               ('Centre','t1', '{"points":4,"rebounds":10,"blocks":2}')) v(last, gid, stats)
  JOIN athletes a ON a.last_name = v.last
  JOIN games g ON g.source_game_id = v.gid;
UPDATE game_stats gs SET university_id = g.away_university_id, opponent_id = g.home_university_id
  FROM games g, athletes a WHERE g.id = gs.game_id AND a.id = gs.athlete_id AND a.last_name = 'Centre';

-- Same scoring step the pipeline runs (usports_pipeline/sync.py: rescore).
INSERT INTO game_stat_fantasy_points (game_stat_id, competition_id, points)
SELECT gs.id, c.id, fantasy_score(gs.raw_stats_json, c.scoring_rules_json)
  FROM game_stats gs JOIN games g ON g.id = gs.game_id
  JOIN competitions c ON c.sport_id = g.sport_id AND c.season = g.season
 WHERE c.count_exhibitions OR NOT g.is_exhibition;
UPDATE game_stats gs SET fantasy_points_calculated = fantasy_score(gs.raw_stats_json, c.scoring_rules_json)
  FROM games g, competitions c
 WHERE g.id = gs.game_id AND c.sport_id = g.sport_id AND c.season = g.season AND c.is_default;
