from usports_pipeline.identity import IdentityIndex


def _resolve_or_create(idx, next_id, uid, name, pid, seg):
    aid, reason = idx.resolve(uid, name, pid, seg)
    if aid is None:
        aid = next_id[0]
        next_id[0] += 1
    idx.register(aid, uid, name, pid, seg, reason)
    return aid, reason


def test_no_id_then_id_links_to_same_athlete():
    idx, nid = IdentityIndex(), [1]
    a1, r1 = _resolve_or_create(idx, nid, 10, "cj evans", None, "2026-27")
    a2, r2 = _resolve_or_create(idx, nid, 10, "cj evans", "pid1", "2026-27")
    a3, r3 = _resolve_or_create(idx, nid, 10, "cj evans", "pid1", "2026-27")
    assert a1 == a2 == a3 and (r1, r2, r3) == ("new", "name_key", "player_id")


def test_new_season_and_playoff_ids_attach_to_same_athlete():
    idx, nid = IdentityIndex(), [1]
    a1, _ = _resolve_or_create(idx, nid, 10, "cj evans", "reg", "2025-26")
    a2, _ = _resolve_or_create(idx, nid, 10, "cj evans", "playoff", "2025-26p")
    a3, _ = _resolve_or_create(idx, nid, 10, "cj evans", "next", "2026-27")
    assert a1 == a2 == a3


def test_same_name_same_team_same_segment_is_two_people():
    idx, nid = IdentityIndex(), [1]
    a1, _ = _resolve_or_create(idx, nid, 10, "tyler brown", "idA", "2025-26")
    a2, reason = _resolve_or_create(idx, nid, 10, "tyler brown", "idB", "2025-26")
    assert a1 != a2 and reason == "name_collision"
    assert _resolve_or_create(idx, nid, 10, "tyler brown", "idB", "2025-26")[0] == a2


def test_same_name_different_university_is_two_people():
    idx, nid = IdentityIndex(), [1]
    assert _resolve_or_create(idx, nid, 10, "sam lee", None, None)[0] != \
           _resolve_or_create(idx, nid, 11, "sam lee", None, None)[0]
