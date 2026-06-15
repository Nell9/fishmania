"""Локальный детерминированный движок — фолбэк, когда Claude недоступен.
Повторяет ключевую логику JS (ai-analyst.plausibility, engine.computeBite/
buildTactics) по данным базы знаний SQLite. Всегда даёт честный результат."""
from . import db

SIZE_NAMES = {"tiny": "очень малый", "small": "малый", "medium": "средний",
              "large": "крупный", "huge": "очень крупный", "unknown": "размер неизвестен"}
WATER_NAMES = {"pond": "пруд", "lake": "озеро", "river_small": "малая река",
               "river_big": "большая река", "oxbow": "старица", "reservoir": "водохранилище", "canal": "канал"}
PERIOD_NAMES = {"dawn": "утренняя зорька", "day": "день", "dusk": "вечерняя зорька", "night": "ночь"}
MONTHS = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле",
          "августе", "сентябре", "октябре", "ноябре", "декабре"]
BAIT_NAME = {"worm": "червь", "crawler": "выползок", "maggot": "опарыш", "bloodworm": "мотыль",
             "corn": "кукуруза", "barley": "перловка", "dough": "тесто/болтушка", "bread": "хлеб",
             "pea": "горох", "boilies": "бойлы/пеллетс", "livebait": "живец", "spinner": "вертушка",
             "spoon": "колебалка", "wobbler": "воблер", "jig": "джиг/силикон"}
ANIMAL_BAITS = {"worm", "crawler", "maggot", "bloodworm", "livebait"}

clamp01 = lambda x: max(0.0, min(1.0, x))


def lat_presence(lat, lo, hi):
    if lat is None or lo is None or hi is None:
        return 1.0
    if lo <= lat <= hi:
        return 1.0
    d = (lo - lat) if lat < lo else (lat - hi)
    return max(0.0, 1.0 - d / 4.0)


def temp_score(wt, lo, clo, chi, hi):
    if wt is None or clo is None or chi is None:
        return 0.6
    if clo <= wt <= chi:
        return 1.0
    if wt < clo:
        if lo is None or wt <= lo:
            return 0.08
        return clamp01((wt - lo) / max(1e-6, clo - lo))
    if hi is None or wt >= hi:
        return 0.08
    return clamp01((hi - wt) / max(1e-6, hi - chi))


def season_score(fish, month):
    m = fish.get("months")
    if not m or month is None:
        return 0.6
    return clamp01(float(m[month % 12]))


def time_score(fish, period):
    t = fish.get("times")
    if not t:
        return 0.6
    return clamp01(float(t.get(period, 0.5)))


def pressure_score(trend, mm):
    if isinstance(trend, (int, float)):
        d = trend
        if abs(d) < 2:
            return 0.85
        if d <= -5:
            return 0.35
        if d < 0:
            return 0.7
        if d >= 5:
            return 0.4
        return 0.6
    return {"stable": 0.85, "falling": 0.72, "rising": 0.55,
            "drop_sharp": 0.35, "rise_sharp": 0.4}.get(trend, 0.65)


def wind_score(ms):
    if ms is None:
        return 0.6
    if ms < 1:
        return 0.55
    if ms <= 4:
        return 0.9
    if ms <= 7:
        return 0.7
    if ms <= 10:
        return 0.45
    return 0.25


def sky_score(clouds, precip):
    s = 0.6
    if clouds is not None:
        s = 0.78 if 30 <= clouds <= 85 else (0.55 if clouds < 30 else 0.62)
    if precip and precip > 0.5:
        s *= 0.85
    return clamp01(s)


# ---------- Правдоподобие вида (mirror ai-analyst.plausibility) ----------
def plausibility(sp, water_type, P):
    fish = sp["fish"]
    aff = (fish.get("waters") or {}).get(water_type, sp.get("aff") or 0) or 0
    base = aff * lat_presence(P.get("lat"), sp["lat_min"], sp["lat_max"])
    if base <= 0.02:
        return None
    c = base
    ev, notes = [], []
    rl = sp["river_link"] or 0
    big = (sp["max_len_cm"] or 0) >= 70 or sp["predator"]
    conn = P.get("connectivity") or 0
    if rl >= 0.6:
        if conn >= 0.6:
            c *= 1.18; ev.append("есть связь с рекой — речной вид проходит сюда")
        elif conn <= 0.3:
            c *= 0.16; notes.append("нужен выход в реку, а водоём изолирован")
        else:
            c *= 0.55
    elif rl <= 0.2 and conn <= 0.3:
        c *= 1.08
    sc = P.get("sizeClass") or "unknown"
    if sc == "tiny":
        if big:
            c *= 0.3
        if (sp["max_len_cm"] or 99) <= 30 and rl < 0.3:
            c *= 1.12
    elif sc == "small" and (sp["max_len_cm"] or 0) >= 90:
        c *= 0.6
    if sc == "tiny" and conn < 0.3:
        if sp["o2"] == "low":
            c *= 1.2
        if sp["o2"] == "high":
            c *= 0.45; notes.append("требователен к кислороду — в малом пруду маловероятен")
    if P.get("reeds") and "reeds" in (fish.get("habitat") or []):
        c *= 1.1; ev.append("камыш по берегу — укрытие и нерестилище")
    if sp["stocked"]:
        if water_type in ("pond", "reservoir", "lake"):
            notes.append("встречается только при зарыблении")
        else:
            c *= 0.15
    c = clamp01(c)
    dq = P.get("dataQuality", "inferred")
    if dq == "osm" and base >= 0.55 and c >= 0.45:
        basis, label = "typical", "типичный вид"
    elif c >= 0.3:
        basis, label = "likely", "вероятен"
    else:
        basis, label = "possible", "возможен"
    return {"id": sp["id"], "name": sp["name"], "confidence": c, "base": base,
            "basis": basis, "basisLabel": label, "evidence": ev, "notes": notes}


def _rationale(r, P):
    bits = []
    tn = WATER_NAMES.get(P["type"], "водоём")
    if r["basis"] == "typical":
        bits.append(f"Типичен для водоёма «{tn}» в вашем регионе")
    elif r["basis"] == "likely":
        bits.append("Вероятен для такого водоёма и широты")
    else:
        bits.append("Возможен, но не доминирует")
    return ", ".join(bits) + "."


def _summary(P, species):
    tn = WATER_NAMES.get(P["type"], "водоём")
    parts = [f"{('«'+P['name']+'» — ') if P.get('name') else ''}{tn}, {SIZE_NAMES.get(P.get('sizeClass','unknown'))}."]
    conn = P.get("connectivity") or 0
    if P.get("linear"):
        parts.append("Проточная вода с течением — преобладают речные виды.")
    elif conn >= 0.6:
        parts.append("Водоём соединён с рекой — сюда могут заходить речные рыбы.")
    elif conn <= 0.3:
        parts.append("Связь с рекой не обнаружена: доминируют озёрно-прудовые виды, стойкие к замору.")
    if P.get("reeds"):
        parts.append("По берегу есть камыш — укрытия и кормовая зона.")
    if species:
        parts.append("Наиболее вероятны: " + ", ".join(s["name"].lower() for s in species[:4]) + ".")
    if P.get("dataQuality") != "osm":
        parts.append("Оценка построена по типу водоёма, ареалу и размеру (по аналогии).")
    return " ".join(parts)


def _notes(P, species, res):
    notes = []
    stocked = [s for s in species if any(r["id"] == s["id"] for r in res)]  # placeholder
    if P.get("connectivity", 0) <= 0.3 and not P.get("linear"):
        notes.append("В изолированных прудах нет судака, жереха, сома и другой строго речной рыбы.")
    notes.append("Это вероятностная оценка, а не гарантия: реальный состав уточняется на воде.")
    return notes


def analyze_local(c, P):
    res = []
    for sp in db.all_species(c):
        p = plausibility(sp, P["type"], P)
        if p and p["confidence"] >= 0.08:
            res.append(p)
    res.sort(key=lambda x: -x["confidence"])
    species = [{"id": r["id"], "name": r["name"], "confidence": round(r["confidence"], 2),
                "basis": r["basis"], "basisLabel": r["basisLabel"],
                "rationale": _rationale(r, P), "evidence": r["evidence"]} for r in res]
    return {"provider": "local", "dataQuality": P.get("dataQuality", "inferred"),
            "summary": _summary(P, species), "top": ", ".join(s["name"] for s in species[:4]),
            "species": species, "notes": _notes(P, species, res), "sources": db.sources(c)}


# ---------- Прогноз клёва + тактика ----------
def _rank_baits(sp, water_temp, owned):
    fish = sp["fish"]
    wt = water_temp if water_temp is not None else 15
    cold, warm = wt < 11, wt > 18
    owned = set(owned or [])
    out = []
    for bid, base in (fish.get("baits") or {}).items():
        s = float(base)
        if cold and bid in ANIMAL_BAITS:
            s *= 1.25
        if cold and bid not in ANIMAL_BAITS and bid not in ("jig", "wobbler", "spoon", "spinner", "livebait"):
            s *= 0.7
        if warm and bid in ("corn", "dough", "bread", "pea", "boilies", "barley"):
            s *= 1.12
        if owned and bid in owned:
            s *= 1.15
        why = "животная насадка — холодная вода" if (cold and bid in ANIMAL_BAITS) else \
              ("растительная — тёплая вода" if (warm and bid not in ANIMAL_BAITS) else "рабочий вариант")
        out.append({"name": BAIT_NAME.get(bid, bid), "score": round(clamp01(s), 2), "why": why})
    out.sort(key=lambda x: -x["score"])
    return out[:5]


def bite_chance(sp, P, w, month, period, presence):
    fish = sp["fish"]
    season = season_score(fish, month)
    temp = temp_score(w.get("waterTemp"), sp["temp_lo"], sp["temp_comf_lo"], sp["temp_comf_hi"], sp["temp_hi"])
    timeS = time_score(fish, period)
    aff = (fish.get("waters") or {}).get(P["type"], 0) * lat_presence(P.get("lat"), sp["lat_min"], sp["lat_max"])
    f = [("Сезон", season, 0.20), ("Температура воды", temp, 0.20), ("Время суток", timeS, 0.14),
         ("Водоём для вида", aff, 0.14), ("Давление", pressure_score(w.get("pressureTrend"), w.get("pressureMm")), 0.14),
         ("Ветер", wind_score(w.get("windMs")), 0.09), ("Небо/осадки", sky_score(w.get("clouds"), w.get("precip")), 0.09)]
    total = sum(s * wt for _, s, wt in f) / sum(wt for _, _, wt in f)
    if presence is not None:
        if presence < 0.15:
            total = min(total, 0.14)
        elif presence < 0.35:
            total = min(total, 0.45)
    pct = round(max(3, min(96, total * 100)))
    return pct, f


def verdict_for(pct, presence):
    if presence is not None and presence < 0.15:
        return {"title": "Не та рыба для этого места", "phrase": "Этот вид здесь почти не встречается. Выберите другую рыбу."}
    if pct < 22:
        return {"title": "Шансы слабые", "phrase": "Условия против вас. Ловите на зорях и чаще меняйте насадки."}
    if pct < 42:
        return {"title": "Клёв вялый, но возможен", "phrase": "Рыба малоактивна: подача деликатнее, крючки мельче, прикормка и ожидание выходов."}
    if pct < 62:
        return {"title": "Неплохие шансы", "phrase": "Рабочая обстановка. Правильная точка и насадка сделают рыбалку."}
    if pct < 80:
        return {"title": "Хороший клёв вероятен", "phrase": "Условия складываются удачно — берите запас насадок и не проспите зорьку."}
    return {"title": "Отличные условия!", "phrase": "Редкое совпадение факторов — такой день пропускать нельзя."}


def _tactic_blocks(sp, P, w, period, baits, factors):
    fish = sp["fish"]
    out = []
    fb = {n: s for n, s, _ in factors}
    out.append({"title": "Где искать",
                "text": ("На течении, у струй и на входах/выходах из ям." if sp["flow"] == "rheo"
                         else "В заливах, у зарослей и кромки камыша, на тиховодье." if sp["flow"] == "limno"
                         else "У границ растительности, бровок и укрытий.")})
    best_periods = [PERIOD_NAMES[k] for k, v in (fish.get("times") or {}).items() if v >= 0.8]
    out.append({"title": "Лучшее время", "text": ("Выходы на " + ", ".join(best_periods) + ".") if best_periods else "Активность ровная в течение дня."})
    if baits:
        out.append({"title": "Насадка", "text": f"Начните с: {baits[0]['name']} ({baits[0]['why']}). Запас: " + ", ".join(b["name"] for b in baits[1:3]) + "."})
    if sp["predator"]:
        out.append({"title": "Снасть и подача", "text": "Спиннинг/живцовая снасть; проводка с паузами, облавливайте укрытия и свалы."})
    else:
        out.append({"title": "Прикормка и подача", "text": "Закормите точку, подавайте деликатно; в холодной воде — животные насадки, мельче крючок."})
    if fb.get("Температура воды", 1) < 0.4:
        out.append({"title": "Поправка на воду", "text": "Вода вне комфорта вида — рыба пассивна: медленная подача, точечная прикормка, ждите коротких выходов."})
    if fb.get("Давление", 1) < 0.5:
        out.append({"title": "Поправка на погоду", "text": "Скачок давления — клёв нестабилен; ловите в самые активные часы и меняйте горизонт/точку."})
    return out


def _spot_tips(sp, P, w):
    fish = sp["fish"]
    tips = []
    if P.get("reeds") and ("reeds" in (fish.get("habitat") or []) or "lilies" in (fish.get("habitat") or [])):
        tips.append({"title": "Кромка камыша", "tip": "Заброс вдоль тростника; ветер, прижимающий волну к камышу, сносит сюда корм."})
    if P.get("connectivity", 0) >= 0.6:
        tips.append({"title": "Устье/струя", "tip": "Свежая вода и корм на притоке — особенно в жару и после дождя."})
    if P.get("bridge"):
        tips.append({"title": "У моста/опор", "tip": "Тень и затишье в жаркий полдень и при ярком солнце."})
    if (fish.get("depth") or {}).get("deep", 0) > 0.6 or sp["predator"]:
        tips.append({"title": "Дальше от берега", "tip": "Чистая вода и свалы — когда у берега пусто и при сильном встречном ветре."})
    tips.append({"title": "Под берегом", "tip": "Короткий заброс на зорьке и в тихую погоду — рыба часто у самого берега."})
    return tips[:5]


def tactics_local(c, sid, req):
    sp = db.species_one(c, sid)
    if not sp:
        return None
    P = req["profile"]
    w = req.get("weather") or {}
    month = req.get("month")
    period = req.get("period") or "day"
    p = plausibility(sp, P["type"], P)
    presence = p["confidence"] if p else 0.0  # вид не проходит порог → честно давим шанс
    pct, factors = bite_chance(sp, P, w, month, period, presence)
    baits = _rank_baits(sp, w.get("waterTemp"), req.get("baits"))
    rationale = (f"Прогноз построен по: сезон ({MONTHS[(month or 0) % 12]}), температура воды "
                 f"{w.get('waterTemp')} °C при комфорте {sp['temp_comf_lo']}–{sp['temp_comf_hi']} °C, "
                 f"время суток ({PERIOD_NAMES.get(period, period)}), пригодность водоёма и погода. "
                 + (f"Присутствие вида на этом водоёме ≈ {round(presence*100)}%." if presence is not None else ""))
    return {"provider": "local", "species": {"id": sp["id"], "name": sp["name"]},
            "chancePct": pct, "verdict": verdict_for(pct, presence),
            "tactics": _tactic_blocks(sp, P, w, period, baits, factors), "baits": baits,
            "spots": _spot_tips(sp, P, w), "rationale": rationale, "sources": db.sources(c)}
