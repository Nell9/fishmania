"""Аналитика посещений: запись событий, геолокация по IP, агрегаты, экспорт/импорт JSON."""
import datetime as _dt
import json
import urllib.request

from . import appdb


def _now():
    return _dt.datetime.utcnow().replace(microsecond=0).isoformat()


def geo(ip: str) -> dict:
    """Гео по IP с кэшем в БД. Внешний сервис ip-api.com (без ключа, ~45 rpm)."""
    empty = {"country": None, "region": None, "city": None, "isp": None}
    if not ip or ip.startswith(("127.", "10.", "192.168.", "172.")) or ip in ("::1", "unknown"):
        return {**empty, "country": "—", "city": "локально"}
    c = appdb.connect()
    row = c.execute("SELECT country, region, city, isp FROM geo_cache WHERE ip=?", (ip,)).fetchone()
    if row:
        return dict(row)
    data = dict(empty)
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,country,regionName,city,isp&lang=ru"
        with urllib.request.urlopen(url, timeout=4) as r:
            j = json.loads(r.read().decode("utf-8"))
        if j.get("status") == "success":
            data = {"country": j.get("country"), "region": j.get("regionName"),
                    "city": j.get("city"), "isp": j.get("isp")}
    except Exception:
        pass
    c.execute("INSERT OR REPLACE INTO geo_cache(ip,country,region,city,isp,ts) VALUES(?,?,?,?,?,?)",
              (ip, data["country"], data["region"], data["city"], data["isp"], _now()))
    c.commit()
    return data


def touch_visitor(anon_id, ip, ua, referrer, user=None):
    """Обновляет/создаёт запись посетителя; подтягивает гео при первом визите."""
    if not anon_id:
        return
    c = appdb.connect()
    now = _now()
    uid = user["id"] if user else None
    email = user["email"] if user else None
    exists = c.execute("SELECT anon_id FROM visitors WHERE anon_id=?", (anon_id,)).fetchone()
    if exists:
        c.execute("""UPDATE visitors SET last_seen=?, ip=?, user_agent=COALESCE(?,user_agent),
                     user_id=COALESCE(?,user_id), email=COALESCE(?,email) WHERE anon_id=?""",
                  (now, ip, ua, uid, email, anon_id))
    else:
        g = geo(ip)
        c.execute("""INSERT INTO visitors(anon_id,first_seen,last_seen,ip,country,region,city,isp,
                     user_agent,referrer,user_id,email,total_ms,events)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,0)""",
                  (anon_id, now, now, ip, g["country"], g["region"], g["city"], g["isp"],
                   ua, referrer, uid, email))
    c.commit()


def record(anon_id, ip, ua, referrer, events, user=None):
    """Пишет пачку событий от клиента. events: [{type,label,path,meta,ms}]."""
    touch_visitor(anon_id, ip, ua, referrer, user)
    c = appdb.connect()
    uid = user["id"] if user else None
    email = user["email"] if user else None
    n = 0
    add_ms = 0
    for e in (events or [])[:200]:
        meta = e.get("meta")
        c.execute("""INSERT INTO events(ts,anon_id,user_id,email,ip,type,label,path,meta)
                     VALUES(?,?,?,?,?,?,?,?,?)""",
                  (_now(), anon_id, uid, email, ip, str(e.get("type", ""))[:40],
                   str(e.get("label", ""))[:200], str(e.get("path", ""))[:200],
                   json.dumps(meta, ensure_ascii=False) if meta is not None else None))
        n += 1
        try:
            add_ms += int(e.get("ms") or 0)
        except Exception:
            pass
    if anon_id:
        c.execute("UPDATE visitors SET events=events+?, total_ms=total_ms+?, last_seen=? WHERE anon_id=?",
                  (n, max(0, add_ms), _now(), anon_id))
    c.commit()
    return n


def stats() -> dict:
    """Сводка для админки."""
    c = appdb.connect()
    one = lambda q, *a: (c.execute(q, a).fetchone() or [0])[0]
    rows = lambda q, *a: [dict(r) for r in c.execute(q, a)]
    return {
        "generated_at": _now(),
        "totals": {
            "visitors": one("SELECT COUNT(*) FROM visitors"),
            "events": one("SELECT COUNT(*) FROM events"),
            "users": one("SELECT COUNT(*) FROM users"),
            "countries": one("SELECT COUNT(DISTINCT country) FROM visitors WHERE country IS NOT NULL"),
            "avg_minutes": round((one("SELECT AVG(total_ms) FROM visitors") or 0) / 60000.0, 1),
        },
        "by_country": rows("""SELECT COALESCE(country,'?') country, COUNT(*) n FROM visitors
                              GROUP BY country ORDER BY n DESC LIMIT 30"""),
        "by_city": rows("""SELECT COALESCE(city,'?') city, COALESCE(country,'?') country, COUNT(*) n
                          FROM visitors GROUP BY city,country ORDER BY n DESC LIMIT 30"""),
        "top_events": rows("""SELECT type, label, COUNT(*) n FROM events
                             GROUP BY type,label ORDER BY n DESC LIMIT 40"""),
        "by_type": rows("SELECT type, COUNT(*) n FROM events GROUP BY type ORDER BY n DESC"),
        "users": rows("""SELECT id,email,role,created_at,last_login FROM users
                        ORDER BY created_at DESC LIMIT 200"""),
        "visitors": rows("""SELECT anon_id,ip,country,region,city,isp,user_agent,referrer,email,
                           first_seen,last_seen,total_ms,events FROM visitors
                           ORDER BY last_seen DESC LIMIT 500"""),
        "recent_events": rows("""SELECT ts,ip,country_lookup AS country,type,label,path,email FROM
                           (SELECT e.ts,e.ip,v.country country_lookup,e.type,e.label,e.path,e.email
                            FROM events e LEFT JOIN visitors v ON v.anon_id=e.anon_id
                            ORDER BY e.id DESC LIMIT 200)"""),
    }


def export_json() -> dict:
    """Полный дамп аналитики для скачивания (можно потом импортировать обратно)."""
    c = appdb.connect()
    rows = lambda q: [dict(r) for r in c.execute(q)]
    return {
        "schema": "klevgid-stats-v1",
        "exported_at": _now(),
        "visitors": rows("SELECT * FROM visitors"),
        "events": rows("SELECT * FROM events"),
        "geo_cache": rows("SELECT * FROM geo_cache"),
        "users": rows("SELECT id,email,role,created_at,last_login FROM users"),
    }


def import_json(data: dict) -> dict:
    """Импорт ранее выгруженной статистики (merge). Пароли пользователей НЕ импортируются."""
    if not isinstance(data, dict) or data.get("schema") != "klevgid-stats-v1":
        raise ValueError("Не тот формат: ожидается klevgid-stats-v1 (файл из экспорта)")
    c = appdb.connect()
    counts = {"visitors": 0, "events": 0, "geo_cache": 0}
    for v in data.get("visitors", []):
        c.execute("""INSERT OR REPLACE INTO visitors(anon_id,first_seen,last_seen,ip,country,region,city,
                     isp,user_agent,referrer,user_id,email,total_ms,events)
                     VALUES(:anon_id,:first_seen,:last_seen,:ip,:country,:region,:city,:isp,
                     :user_agent,:referrer,:user_id,:email,:total_ms,:events)""",
                  {**{k: None for k in ("anon_id","first_seen","last_seen","ip","country","region","city",
                     "isp","user_agent","referrer","user_id","email","total_ms","events")}, **v})
        counts["visitors"] += 1
    for e in data.get("events", []):
        e2 = {**{k: None for k in ("ts","anon_id","user_id","email","ip","type","label","path","meta")}, **e}
        c.execute("""INSERT INTO events(ts,anon_id,user_id,email,ip,type,label,path,meta)
                     VALUES(:ts,:anon_id,:user_id,:email,:ip,:type,:label,:path,:meta)""", e2)
        counts["events"] += 1
    for g in data.get("geo_cache", []):
        c.execute("INSERT OR REPLACE INTO geo_cache(ip,country,region,city,isp,ts) "
                  "VALUES(:ip,:country,:region,:city,:isp,:ts)",
                  {**{k: None for k in ("ip","country","region","city","isp","ts")}, **g})
        counts["geo_cache"] += 1
    c.commit()
    return counts
