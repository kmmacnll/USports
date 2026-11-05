# Terms & Conditions — §Athlete Eligibility (draft)

> Draft wording for legal review. It describes the rule the platform enforces;
> it is not legal advice.

**Version:** 2026-11-01 (`terms_versions.version`)

1. **Declaration.** Before creating or joining a league, every user must accept
   these Terms and answer whether they are a current U Sports student-athlete.
   If so, they must declare each sport in which they are on a varsity roster.

2. **Own-sport restriction.** A U Sports student-athlete may take part in
   fantasy competitions in **any sport except a sport they compete in**.
   They may not create, commission or join a league, or hold a team, in their
   own sport. For example, a men's basketball player may play fantasy football
   or women's hockey, but not men's basketball.

3. **Changes in status.** A user who joins a varsity roster must update their
   declaration before taking part in any league in that sport, and must first
   leave any league they already hold in that sport.

4. **Verification and enforcement.** We may check declarations against
   published U Sports rosters. We may remove teams, cancel league
   participation, or suspend accounts that break this section.

## How the platform enforces it

| Clause | Mechanism |
|---|---|
| 1 | `users.terms_version_accepted` must equal the current `terms_versions` row, and `users.is_usports_athlete` must be answered, before a user can commission or join a league |
| 1, 3 | `user_athlete_declarations (user_id, sport_id)` |
| 2 | `assert_user_may_play_sport()` runs on `leagues` (commissioner) and `fantasy_teams` (member) writes, and raises `check_violation` with hint `ATHLETE_OWN_SPORT` |
| 3 | A declaration is rejected while the user still commissions or plays in a league for that sport. The error names the leagues to leave |
| 4 | `user_athlete_declarations.athlete_id` and `source = 'VERIFIED'` link a declaration to an ingested roster record |

**Why exactly their own sport:** the rule exists so an athlete can't profit
from their own performance. That includes deliberately playing badly to help
a fantasy opponent, or to sink players on a rival's roster. An athlete can
only influence games in the sport they play. A men's basketball player has
no effect on a women's basketball game, so "own sport" means the exact sport
(`sports.id`), and every other sport, including the same discipline in the
other gender, stays open.
