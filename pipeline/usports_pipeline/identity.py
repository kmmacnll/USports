"""Athlete identity resolution.

U Sports has no stable athlete id: usports.ca player ids change every season
and again for playoff/championship segments, and many box-score rows
(especially early in a season) carry no id at all. Every identifier we see is
recorded in athlete_source_ids and resolved to one athletes row:

  1. usports_player id already known          -> that athlete
  2. name key (<university_id>|<name>) known  -> that athlete, and the new
     player id is attached to it ... unless that athlete already holds a
     *different* player id in the same season segment, which means two
     different people share a name on one team -> new athlete
  3. otherwise                                 -> new athlete
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class IdentityIndex:
    by_key: dict[tuple[str, str], int] = field(default_factory=dict)          # (id_type, id_value) -> athlete_id
    segments: dict[int, dict[str, str]] = field(default_factory=dict)         # athlete_id -> {segment: player_id}
    new_keys: list[tuple[str, str, int, str | None]] = field(default_factory=list)

    @staticmethod
    def name_key(university_id: int, name_norm: str) -> str:
        return f"{university_id}|{name_norm}"

    def add(self, id_type: str, id_value: str, athlete_id: int, segment: str | None, *, new: bool) -> None:
        self.by_key[(id_type, id_value)] = athlete_id
        if id_type == "usports_player" and segment:
            self.segments.setdefault(athlete_id, {})[segment] = id_value
        if new:
            self.new_keys.append((id_type, id_value, athlete_id, segment))

    def resolve(self, university_id: int, name_norm: str, player_id: str | None,
                segment: str | None) -> tuple[int | None, str]:
        """-> (athlete_id or None if a new athlete is needed, reason)."""
        nk = self.name_key(university_id, name_norm)
        if player_id and ("usports_player", player_id) in self.by_key:
            return self.by_key[("usports_player", player_id)], "player_id"
        cand = self.by_key.get(("name_key", nk))
        if cand is None:
            return None, "new"
        if player_id and segment:
            held = self.segments.get(cand, {}).get(segment)
            if held and held != player_id:
                return None, "name_collision"
        return cand, "name_key"

    def register(self, athlete_id: int, university_id: int, name_norm: str,
                 player_id: str | None, segment: str | None, reason: str) -> None:
        nk = self.name_key(university_id, name_norm)
        if player_id and ("usports_player", player_id) not in self.by_key:
            self.add("usports_player", player_id, athlete_id, segment, new=True)
        # On a same-name collision, the name key stays with the first athlete.
        if reason != "name_collision" and ("name_key", nk) not in self.by_key:
            self.add("name_key", nk, athlete_id, None, new=True)
