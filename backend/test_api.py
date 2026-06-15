"""Смоук-тесты бэкенда в local-режиме (без ключа Claude).
Запуск:  KLEVGID_DB=/tmp/klevgid.db python test_api.py
Требует: fastapi, httpx (см. requirements.txt). База: python build_db.py."""
import os
os.environ.setdefault("KLEVGID_DB", "/tmp/klevgid.db")
os.environ.pop("ANTHROPIC_API_KEY", None)  # форсируем local-режим

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
P, F = 0, 0
def ok(name, cond, extra=""):
    global P, F
    P, F = (P + 1, F) if cond else (P, F + 1)
    print(f"{'OK  ' if cond else 'FAIL'} {name}" + (f" — {extra}" if extra else ""))

# health
h = client.get("/api/health").json()
ok("health ok + db loaded", h["ok"] and h.get("species") == 22 and h["claude"] is False, str(h))

# analyze: изолированный малый пруд → без судака/сома/жереха, есть карась
pond = {"profile": {"type": "pond", "lat": 55.7, "sizeClass": "tiny", "connectivity": 0.0,
                    "reeds": True, "dataQuality": "osm"}, "month": 5, "waterTemp": 19}
a = client.post("/api/ai/analyze", json=pond).json()
ids = [s["id"] for s in a["species"]]
ok("analyze provider local", a["provider"] == "local")
ok("analyze pond excludes zander/catfish/asp", not ({"zander", "catfish", "asp"} & set(ids)), f"top={ids[:5]}")
ok("analyze pond includes crucian", "crucian" in ids)
ok("analyze percentages in (0,1]", all(0 < s["confidence"] <= 1 for s in a["species"]))

# analyze: большая река → есть судак/жерех
river = {"profile": {"type": "river_big", "lat": 51.5, "sizeClass": "large", "connectivity": 1.0,
                     "linear": True, "dataQuality": "osm"}, "month": 5, "waterTemp": 18}
ar = client.post("/api/ai/analyze", json=river).json()
rids = [s["id"] for s in ar["species"]]
ok("analyze river includes zander & asp", "zander" in rids and "asp" in rids, f"top={rids[:5]}")

# tactics: судак в большой реке — осмысленный прогноз
t = client.post("/api/ai/tactics", json={"species": "zander", "profile": river["profile"],
        "weather": {"waterTemp": 16, "pressureMm": 748, "pressureTrend": -1, "windMs": 3, "clouds": 60},
        "month": 8, "period": "dusk", "tackle": "spinning"}).json()
ok("tactics chance 3..96", 3 <= t["chancePct"] <= 96, f"pct={t['chancePct']}")
ok("tactics has verdict+tactics+baits+spots", t["verdict"]["title"] and t["tactics"] and t["baits"] and t["spots"])
ok("tactics baits ranked", t["baits"][0]["score"] >= t["baits"][-1]["score"])

# tactics honesty: судак в изолированном пруду → шанс задавлен
tp = client.post("/api/ai/tactics", json={"species": "zander", "profile": pond["profile"],
        "weather": {"waterTemp": 19, "pressureMm": 748, "pressureTrend": 0}, "month": 6, "period": "day"}).json()
ok("tactics honesty: zander in pond pct<=14", tp["chancePct"] <= 14, f"pct={tp['chancePct']}")
ok("tactics verdict flags wrong fish", "Не та рыба" in tp["verdict"]["title"], tp["verdict"]["title"])

# unknown species → 404
ok("tactics unknown species 404", client.post("/api/ai/tactics", json={"species": "nessie", "profile": pond["profile"]}).status_code == 404)

print(f"\n{'ALL PASS' if F == 0 else 'HAS FAILURES'}: {P} passed, {F} failed")
raise SystemExit(1 if F else 0)
