"""RAG-извлечение: кандидаты по региону+типу водоёма и факторные факты для промпта."""
from . import db

ANALYZE_FACTORS = ["connectivity", "oxygen", "flow", "feeding", "temperature", "stocking"]
TACTICS_FACTORS = ["temperature", "feeding", "daytime", "season", "oxygen", "flow", "connectivity", "size"]


def candidates(c, water_type, lat, k=12):
    """Виды, реально вероятные для типа водоёма и широты (по убыванию правдоподобия)."""
    scored = []
    for sp in db.species_for_water(c, water_type, min_aff=0.05):
        pres = 1.0
        lo, hi = sp["lat_min"], sp["lat_max"]
        if lo is not None and hi is not None and lat is not None and not (lo <= lat <= hi):
            d = (lo - lat) if lat < lo else (lat - hi)
            pres = max(0.0, 1.0 - d / 4.0)
        score = (sp["aff"] or 0) * pres
        if score >= 0.04:
            scored.append((score, sp))
    scored.sort(key=lambda x: -x[0])
    return [sp for _, sp in scored[:k]]


def corpus_for_analyze(c, cands):
    blocks = []
    for sp in cands:
        beh = db.behavior(c, sp["id"], ANALYZE_FACTORS)
        facts = "; ".join(b["rule"] for b in beh)
        blocks.append(f"### {sp['name']} ({sp['latin']}) [id={sp['id']}]\n{sp['knowledge']}\nКлюч. факты: {facts}")
    return "\n\n".join(blocks)


def corpus_for_tactics(c, sid):
    sp = db.species_one(c, sid)
    if not sp:
        return ""
    beh = db.behavior(c, sid, TACTICS_FACTORS)
    facts = "\n".join(f"- [{b['factor']}] {b['rule']}" for b in beh)
    bait_names = ", ".join(b["bait"] for b in db.baits(c, sid))
    return f"{sp['name']} ({sp['latin']}). {sp['knowledge']}\nФакторные правила:\n{facts}\nРабочие насадки: {bait_names}"
