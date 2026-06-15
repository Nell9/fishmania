"""Доступ к базе знаний SQLite (только чтение)."""
import json, os, sqlite3

DEFAULT_DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "klevgid.db")
DB_PATH = os.environ.get("KLEVGID_DB", DEFAULT_DB)


def connect():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def _to_species(row):
    d = dict(row)
    try:
        d["fish"] = json.loads(d.get("raw") or "{}")
    except Exception:
        d["fish"] = {}
    lat = d["fish"].get("lat") or [None, None]
    d.setdefault("lat_min", lat[0])
    d.setdefault("lat_max", lat[1])
    return d


def all_species(c):
    return [_to_species(r) for r in c.execute("SELECT * FROM species")]


def species_one(c, sid):
    r = c.execute("SELECT * FROM species WHERE id=?", (sid,)).fetchone()
    return _to_species(r) if r else None


def affinity(c, sid, water_type):
    r = c.execute("SELECT affinity FROM waters_affinity WHERE species_id=? AND water_type=?",
                  (sid, water_type)).fetchone()
    return r["affinity"] if r else 0.0


def species_for_water(c, water_type, min_aff=0.05):
    rows = c.execute(
        """SELECT s.*, w.affinity AS aff FROM species s
           JOIN waters_affinity w ON w.species_id=s.id
           WHERE w.water_type=? AND w.affinity>=? ORDER BY w.affinity DESC""",
        (water_type, min_aff))
    out = []
    for r in rows:
        d = _to_species(r)
        d["aff"] = r["aff"]
        out.append(d)
    return out


def behavior(c, sid, factors=None):
    if factors:
        q = "SELECT factor, rule, weight, source_id FROM behavior WHERE species_id=? AND factor IN (%s) ORDER BY weight DESC" % \
            ",".join("?" * len(factors))
        rows = c.execute(q, (sid, *factors))
    else:
        rows = c.execute("SELECT factor, rule, weight, source_id FROM behavior WHERE species_id=? ORDER BY weight DESC", (sid,))
    return [dict(r) for r in rows]


def baits(c, sid):
    return [dict(r) for r in c.execute("SELECT bait, base FROM baits WHERE species_id=? ORDER BY base DESC", (sid,))]


def sources(c):
    return [r["ref"] for r in c.execute("SELECT ref FROM sources ORDER BY id")]
