"""КлёвГид AI backend — FastAPI.

Эндпоинты:
  GET  /api/health          — статус, доступность Claude, размер базы
  POST /api/ai/analyze      — какая рыба водится (RAG + Claude, фолбэк local)
  POST /api/ai/tactics      — тактика + честный прогноз шанса по виду+условиям

Ключ ANTHROPIC_API_KEY — в окружении. Без ключа всё работает в local-режиме.
Документация: ai/docs/12-backend.md
"""
import datetime
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import claude_client, db, engine, rag
from .schemas import AnalyzeRequest, AnalyzeResponse, TacticsRequest, TacticsResponse

app = FastAPI(title="КлёвГид AI", version="1.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("KLEVGID_CORS", "*").split(",")],
    allow_credentials=False, allow_methods=["*"], allow_headers=["*"],
)


def _month(m):
    return m if m is not None else datetime.date.today().month - 1


def _profile(req_profile, water_temp=None):
    P = req_profile.model_dump()
    if not P.get("typeName"):
        P["typeName"] = engine.WATER_NAMES.get(P["type"], "водоём")
    if water_temp is not None:
        P["waterTemp"] = water_temp
    return P


@app.get("/api/health")
def health():
    info = {"ok": True, "claude": claude_client.available(), "transport": claude_client.transport(), "db": db.DB_PATH}
    try:
        c = db.connect()
        info["species"] = c.execute("SELECT COUNT(*) FROM species").fetchone()[0]
        c.close()
    except Exception as e:  # noqa: BLE001
        info["ok"] = False
        info["error"] = str(e)
    return info


@app.post("/api/ai/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    c = db.connect()
    P = _profile(req.profile, req.waterTemp)
    use_claude = (req.provider != "local") and claude_client.available()
    if use_claude:
        try:
            cands = rag.candidates(c, P["type"], P["lat"])
            corpus = rag.corpus_for_analyze(c, cands)
            data = claude_client.analyze(P, corpus)
            species = _normalize_species(c, data.get("species", []))
            return AnalyzeResponse(
                provider="claude", dataQuality=P["dataQuality"], summary=data.get("summary", ""),
                top=", ".join(s["name"] for s in species[:4]), species=species,
                notes=data.get("notes", []), sources=db.sources(c))
        except Exception as e:  # noqa: BLE001 — любой сбой → честный локальный разбор
            res = engine.analyze_local(c, P)
            res["notes"] = [f"AI-бэкенд недоступен ({type(e).__name__}) — показан локальный экспертный разбор."] + res["notes"]
            return res
    return engine.analyze_local(c, P)


def _normalize_species(c, species):
    rows = list(c.execute("SELECT id, name FROM species"))
    ids = {r["id"] for r in rows}
    name2id = {r["name"].lower(): r["id"] for r in rows}
    out = []
    for s in species:
        sid = s.get("id")
        if not sid or sid not in ids:
            sid = name2id.get((s.get("name") or "").lower())
        out.append({
            "id": sid or (s.get("name") or ""),
            "name": s.get("name") or sid or "",
            "confidence": float(s.get("confidence", 0) or 0),
            "rationale": s.get("rationale"),
            "evidence": s.get("evidence", []) or [],
        })
    out.sort(key=lambda x: -x["confidence"])
    return out


def _conditions_text(reqd):
    w = reqd["weather"]
    bits = [f"Сезон: месяц {(_month(reqd['month']) + 1)}", f"Время суток: {reqd['period']}"]
    if w.get("waterTemp") is not None:
        bits.append(f"Температура воды: {w['waterTemp']} °C")
    if w.get("airTemp") is not None:
        bits.append(f"Воздух: {w['airTemp']} °C")
    if w.get("pressureMm") is not None:
        bits.append(f"Давление: {w['pressureMm']} мм рт. ст. (тренд {w.get('pressureTrend')})")
    if w.get("windMs") is not None:
        bits.append(f"Ветер: {w['windMs']} м/с")
    if w.get("clouds") is not None:
        bits.append(f"Облачность: {w['clouds']}%")
    if reqd.get("tackle"):
        bits.append(f"Снасть: {reqd['tackle']}")
    if reqd.get("baits"):
        bits.append("Насадки у рыбака: " + ", ".join(reqd["baits"]))
    return "; ".join(bits) + "."


@app.post("/api/ai/tactics", response_model=TacticsResponse)
def tactics(req: TacticsRequest):
    c = db.connect()
    sp = db.species_one(c, req.species)
    if not sp:
        raise HTTPException(status_code=404, detail=f"Неизвестный вид: {req.species}")
    P = _profile(req.profile, req.weather.waterTemp)
    reqd = {"profile": P, "weather": req.weather.model_dump(), "month": _month(req.month),
            "period": req.period or "day", "baits": req.baits, "tackle": req.tackle}
    use_claude = (req.provider != "local") and claude_client.available()
    if use_claude:
        try:
            corpus = rag.corpus_for_tactics(c, req.species)
            data = claude_client.tactics(sp["name"], P, _conditions_text(reqd), corpus)
            return TacticsResponse(
                provider="claude", species={"id": sp["id"], "name": sp["name"]},
                chancePct=int(data.get("chancePct", 0)), verdict=data.get("verdict", {"title": "", "phrase": ""}),
                tactics=data.get("tactics", []), baits=data.get("baits", []), spots=data.get("spots", []),
                rationale=data.get("rationale"), sources=db.sources(c))
        except Exception as e:  # noqa: BLE001
            res = engine.tactics_local(c, req.species, reqd)
            res["rationale"] = f"AI-бэкенд недоступен ({type(e).__name__}) — локальный расчёт. " + (res.get("rationale") or "")
            return res
    return engine.tactics_local(c, req.species, reqd)
