/* ============================================================
   КлёвГид — AI-аналитик водоёма (RAG-пайплайн).

   По выбранной на карте точке собирает РЕАЛЬНЫЕ факты о водоёме
   (тип, размер, связь с рекой, камыш — из OpenStreetMap) и
   объединяет с научной базой по экологии рыб (fishdb), чтобы
   обоснованно предположить, какие виды здесь реально водятся и
   с какой уверенностью. Мало данных — честно переходим к оценке
   «по аналогии» (тип, ареал, размер).

   Провайдеры: local (работает сейчас) и claude (заглушка к
   /api/ai/analyze). analyzeWater() при сбое Claude откатывается на
   local — сайт всегда выдаёт результат.

   Документация: ai/docs/09-ai-analyst.md
   ============================================================ */

import { FISHES, ECOLOGY, KNOWLEDGE, WATERS, SOURCES } from "./fishdb.js";
import { latPresence } from "./engine.js";
import { SIZE_NAMES, fmtHa } from "./osm.js";

export const AI_CONFIG = {
  provider: "auto",                  // "auto" | "backend" | "local"
  base: "",                          // базовый URL бэкенда; пусто = тот же origin (/api/...)
  endpoints: { analyze: "/api/ai/analyze", tactics: "/api/ai/tactics", health: "/api/health" },
};
let _backendOk = null;               // кэш доступности бэкенда на сессию

const firstSentence = (s) => (s || "").split(/(?<=[.!?])\s/)[0];

/* RAG-ШАГ 1 — RETRIEVAL: факты о точке */
export function assembleContext({ profile, weather, month, waterTemp }) {
  const type = profile?.type || "lake";
  return {
    type,
    typeName: WATERS[type]?.name || "водоём",
    name: profile?.name || null,
    linear: !!profile?.linear,
    areaHa: profile?.areaHa ?? null,
    widthM: profile?.widthM ?? null,
    sizeClass: profile?.sizeClass || "unknown",
    connectivity: profile?.connectivity ?? 0,
    inflows: profile?.inflows || [],
    reeds: !!profile?.reeds,
    beach: !!profile?.beach,
    bridge: !!profile?.bridge,
    islands: profile?.islands || 0,
    shorelineComplex: profile?.shorelineComplex ?? null,
    dataQuality: profile?.dataQuality || "inferred",
    lat: profile?.lat ?? weather?.lat ?? 55,
    month: month ?? new Date().getMonth(),
    waterTemp: waterTemp ?? null,
  };
}

/* RAG-ШАГ 2 — REASONING: правдоподобие вида на этом водоёме */
export function plausibility(id, P, lat) {
  const f = FISHES[id], e = ECOLOGY[id];
  if (!f || !e) return null;
  const base = (f.waters[P.type] ?? 0) * latPresence(f, lat);
  if (base <= 0.02) return null;

  let c = base;
  const ev = [], notes = [];
  const big = e.maxLenCm >= 70 || e.predator;

  if (e.riverLink >= 0.6) {
    if (P.connectivity >= 0.6) { c *= 1.18; ev.push("есть связь с рекой — речной вид проходит сюда"); }
    else if (P.connectivity <= 0.3) { c *= 0.16; notes.push("нужен выход в реку, а водоём изолирован"); }
    else c *= 0.55;
  } else if (e.riverLink <= 0.2 && P.connectivity <= 0.3) {
    c *= 1.08;
  }

  if (P.sizeClass === "tiny") {
    if (big) c *= 0.3;
    if (e.maxLenCm <= 30 && e.riverLink < 0.3) c *= 1.12;
  } else if (P.sizeClass === "small" && e.maxLenCm >= 90) {
    c *= 0.6;
  } else if ((P.sizeClass === "large" || P.sizeClass === "huge") && e.maxLenCm <= 18 && !e.gregarious) {
    c *= 0.9;
  }

  if (P.sizeClass === "tiny" && P.connectivity < 0.3) {
    if (e.o2 === "low") { c *= 1.2; }
    if (e.o2 === "high") { c *= 0.45; notes.push("требователен к кислороду — в малом пруду маловероятен"); }
  }

  if (P.reeds && f.habitat.includes("reeds")) { c *= 1.1; ev.push("камыш по берегу — укрытие и нерестилище"); }

  if (e.stocked) {
    if (["pond", "reservoir", "lake"].includes(P.type)) notes.push("встречается только при зарыблении");
    else c *= 0.15;
  }

  c = Math.max(0, Math.min(1, c));

  let basis, basisLabel;
  if (P.dataQuality === "osm" && base >= 0.55 && c >= 0.45) { basis = "typical"; basisLabel = "типичный вид"; }
  else if (c >= 0.3) { basis = "likely"; basisLabel = "вероятен"; }
  else { basis = "possible"; basisLabel = "возможен"; }

  return { id, confidence: c, base, basis, basisLabel, evidence: ev, notes };
}

function rationaleFor(id, P, p) {
  const f = FISHES[id], e = ECOLOGY[id];
  const bits = [];
  if (p.basis === "typical") bits.push(`Типичен для водоёма «${P.typeName.toLowerCase()}» в вашем регионе`);
  else if (p.basis === "likely") bits.push(`Вероятен для такого водоёма и широты`);
  else bits.push(`Возможен, но не доминирует`);

  if (e.riverLink >= 0.6 && P.connectivity >= 0.6) bits.push("водоём связан с рекой");
  if (e.riverLink >= 0.6 && P.connectivity <= 0.3) bits.push("обычно требует выхода в реку");
  if (P.reeds && f.habitat.includes("reeds")) bits.push("есть подходящие заросли");
  if (P.sizeClass === "tiny" && e.o2 === "low") bits.push("переносит бедную кислородом воду малого пруда");

  return bits.join(", ") + ". " + firstSentence(KNOWLEDGE[id] || "");
}

function waterEvidence(P) {
  const ev = [];
  ev.push(`Тип: ${P.typeName.toLowerCase()}${P.dataQuality === "osm" ? " (по данным OSM)" : " (оценка)"}`);
  if (P.name) ev.push(`Название: ${P.name}`);
  if (P.areaHa != null) ev.push(`Площадь: ${fmtHa(P.areaHa)} (${SIZE_NAMES[P.sizeClass]})`);
  else if (P.widthM) ev.push(`Ширина русла: ≈ ${Math.round(P.widthM)} м`);
  if (P.connectivity >= 0.6) ev.push(`Связь с рекой: есть${P.inflows.length ? " (" + P.inflows.join(", ") + ")" : ""}`);
  else if (P.connectivity <= 0.3 && !P.linear) ev.push("Связь с рекой: не обнаружена (изолированный водоём)");
  if (P.reeds) ev.push("Камыш / тростник по берегу");
  if (P.bridge) ev.push("Мост / гидросооружение рядом");
  if (P.islands) ev.push(`Острова: ${P.islands}`);
  return ev;
}

/* ЛОКАЛЬНЫЙ ПРОВАЙДЕР — экспертный синтез */
export function analyzeLocal(input) {
  const P = assembleContext(input);
  const lat = P.lat;

  const species = Object.keys(FISHES)
    .map(id => plausibility(id, P, lat))
    .filter(p => p && p.confidence >= 0.08)
    .sort((a, b) => b.confidence - a.confidence)
    .map(p => ({
      id: p.id,
      name: FISHES[p.id].name,
      confidence: Math.round(p.confidence * 100) / 100,
      basis: p.basis,
      basisLabel: p.basisLabel,
      rationale: rationaleFor(p.id, P, p),
      evidence: p.evidence,
    }));

  const top = species.slice(0, 4).map(s => s.name).join(", ");
  const summary = buildWaterSummary(P, species);
  const notes = buildNotes(P, species);

  return {
    provider: "local",
    dataQuality: P.dataQuality,
    waterProfile: {
      type: P.type, typeName: P.typeName, name: P.name,
      sizeLabel: SIZE_NAMES[P.sizeClass], areaHa: P.areaHa, widthM: P.widthM,
      connectivity: P.connectivity, reeds: P.reeds, bridge: P.bridge, islands: P.islands,
    },
    waterEvidence: waterEvidence(P),
    summary, top, species, notes,
    sources: SOURCES,
  };
}

function buildWaterSummary(P, species) {
  const parts = [];
  const sizeTxt = P.areaHa != null ? `${SIZE_NAMES[P.sizeClass]} (${fmtHa(P.areaHa)})`
    : P.widthM ? `${SIZE_NAMES[P.sizeClass]}, ширина ≈ ${Math.round(P.widthM)} м` : SIZE_NAMES[P.sizeClass];
  parts.push(`${P.name ? "«" + P.name + "» — " : ""}${P.typeName.toLowerCase()}, ${sizeTxt}.`);

  if (P.linear) parts.push("Проточная вода с течением — преобладают речные виды.");
  else if (P.connectivity >= 0.6) parts.push(`Водоём соединён с рекой${P.inflows.length ? " (" + P.inflows.join(", ") + ")" : ""} — сюда могут заходить речные рыбы.`);
  else if (P.connectivity <= 0.3) parts.push("Связь с рекой не обнаружена: это скорее изолированный водоём, где доминируют озёрно-прудовые виды, стойкие к замору.");

  if (P.reeds) parts.push("По берегу есть камыш/тростник — укрытия, нерестилища и кормовая зона.");
  if (P.bridge) parts.push("Рядом мост/гидросооружение — локальные ямы и затишья.");

  if (species.length) parts.push(`Наиболее вероятны: ${species.slice(0, 4).map(s => s.name.toLowerCase()).join(", ")}.`);
  if (P.dataQuality !== "osm") parts.push("Точных данных о видовом составе нет — оценка построена по типу водоёма, ареалу и размеру (по аналогии).");
  return parts.join(" ");
}

function buildNotes(P, species) {
  const notes = [];
  const stockedShown = species.filter(s => ECOLOGY[s.id].stocked);
  if (stockedShown.length) notes.push(`${stockedShown.map(s => s.name.toLowerCase()).join(", ")} — встречаются только если водоём зарыбляют.`);
  if (P.dataQuality !== "osm") notes.push("Видовой состав предполагается по экологии и ареалу, а не по фактическим данным водоёма.");
  if (P.connectivity <= 0.3 && !P.linear) notes.push("В изолированных прудах нет судака, жереха, сома и другой строго речной рыбы.");
  notes.push("Это вероятностная оценка, а не гарантия: реальный состав уточняется только на воде.");
  return notes;
}

/* ПРОВАЙДЕР CLAUDE — RAG-промпт + вызов бэкенда (ЗАГЛУШКА) */
export class AINotConfigured extends Error {}

export function buildClaudePrompt(input) {
  const P = assembleContext(input);
  const candidates = Object.keys(FISHES)
    .map(id => plausibility(id, P, P.lat))
    .filter(p => p && p.confidence >= 0.05)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12);

  const facts = waterEvidence(P).map(e => "- " + e).join("\n");
  const corpus = candidates.map(p =>
    `### ${FISHES[p.id].name} (${FISHES[p.id].latin})\n${KNOWLEDGE[p.id]}`).join("\n\n");

  return `Ты ихтиолог-аналитик рыболовного сервиса. По фактам о водоёме и справке об экологии видов
определи, какие рыбы РЕАЛЬНО могут водиться в этой точке, и оцени уверенность (0–100%).
Опирайся только на приведённые факты; если данных мало — рассуждай по типу водоёма, ареалу,
размеру, связи с рекой и кислородному режиму. Для каждого вида дай краткое обоснование и
эвиденс. Верни строгий JSON: {summary, species:[{name, confidence, rationale, evidence[]}], notes[]}.

## Факты о водоёме (точка ${input.profile?.name || ""} ${P.lat.toFixed(3)})
${facts}
Сезон: месяц ${P.month + 1}${P.waterTemp != null ? ", температура воды ≈ " + P.waterTemp + " °C" : ""}.

## Справка по экологии видов-кандидатов
${corpus}`;
}

/* Доступность бэкенда: один лёгкий пробник на сессию (короткий таймаут). */
export async function backendAvailable(ms = 2000) {
  if (AI_CONFIG.provider === "local") return false;
  if (_backendOk !== null) return _backendOk;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(AI_CONFIG.base + AI_CONFIG.endpoints.health, { signal: ctrl.signal });
    clearTimeout(t);
    _backendOk = res.ok;
  } catch { _backendOk = false; }
  return _backendOk;
}

async function postJSON(url, body, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(AI_CONFIG.base + url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

/* Разбор водоёма через бэкенд (/api/ai/analyze). Бэкенд сам выбирает claude/local. */
async function analyzeBackend(input, ms = 8000) {
  const ctx = assembleContext(input);
  const data = await postJSON(AI_CONFIG.endpoints.analyze,
    { profile: ctx, month: ctx.month, waterTemp: ctx.waterTemp }, ms);
  return { ...data, provider: data.provider || "backend" };
}

/* Тактика + честный прогноз шанса через бэкенд (/api/ai/tactics). */
export async function fetchTactics(payload, ms = 12000) {
  return await postJSON(AI_CONFIG.endpoints.tactics, payload, ms);
}

/* ПУБЛИЧНАЯ ТОЧКА ВХОДА — разбор водоёма (бэкенд при доступности, иначе локально). */
export async function analyzeWater(input) {
  if (AI_CONFIG.provider !== "local" && await backendAvailable()) {
    try {
      return await analyzeBackend(input);
    } catch (e) {
      const local = analyzeLocal(input);
      local.notes = ["AI-бэкенд недоступен — показан локальный экспертный разбор.", ...local.notes];
      return local;
    }
  }
  return analyzeLocal(input);
}
