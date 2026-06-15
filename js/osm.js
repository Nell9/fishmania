/* ============================================================
   КлёвГид — работа с OpenStreetMap через Overpass API.
   • detectWater(lat,lon)      — точка на водоёме? какой тип?
   • fetchSurroundings(...)     — реальный рельеф в радиусе R (вода,
                                  камыш, притоки, мосты, острова)
   • profileWater(...)          — научный профиль водоёма для аналитика
   • realisticCastDistance(...) — реалистичная дистанция заброса
   Чистые парсеры/геометрия экспортируются и покрыты тестами.
   Документация: ai/docs/10-osm-terrain.md
   ============================================================ */

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/* ---------- Низкоуровневый запрос с перебором зеркал ---------- */
export async function overpass(query, ms = 25000) {
  let lastErr;
  for (const url of ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query), signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) { lastErr = new Error("HTTP " + res.status); continue; }
      return await res.json();
    } catch (e) { clearTimeout(timer); lastErr = e; }
  }
  throw lastErr || new Error("Overpass недоступен");
}

/* ============================================================
   ПРОЕКЦИЯ lat/lon → локальные метры (равнопромежуточная).
   y направлен вниз (север — вверх на экране).
   ============================================================ */
export function projector(lat0, lon0) {
  const mPerLat = 111320;
  const mPerLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  return {
    mPerLat, mPerLon,
    toXY: (lat, lon) => [(lon - lon0) * mPerLon, (lat0 - lat) * mPerLat],
  };
}

/* Площадь кольца (м²) по спроецированным точкам — формула шнурков */
export function polygonAreaM2(geom, proj) {
  if (!geom || geom.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < geom.length; i++) {
    const [x1, y1] = proj.toXY(geom[i].lat, geom[i].lon);
    const j = (i + 1) % geom.length;
    const [x2, y2] = proj.toXY(geom[j].lat, geom[j].lon);
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/* Минимальная дистанция от точки до полилинии/кольца, м */
export function distToGeomM(lat, lon, geom, proj) {
  if (!geom || !geom.length) return Infinity;
  const [px, py] = proj.toXY(lat, lon);
  let best = Infinity;
  for (let i = 0; i < geom.length - 1; i++) {
    const [ax, ay] = proj.toXY(geom[i].lat, geom[i].lon);
    const [bx, by] = proj.toXY(geom[i + 1].lat, geom[i + 1].lon);
    best = Math.min(best, segDist(px, py, ax, ay, bx, by));
  }
  if (geom.length === 1) {
    const [ax, ay] = proj.toXY(geom[0].lat, geom[0].lon);
    best = Math.hypot(px - ax, py - ay);
  }
  return best;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* Точка внутри кольца (ray casting) по спроецированным координатам */
export function pointInRing(lat, lon, geom, proj) {
  if (!geom || geom.length < 3) return false;
  const [px, py] = proj.toXY(lat, lon);
  let inside = false;
  for (let i = 0, j = geom.length - 1; i < geom.length; j = i++) {
    const [xi, yi] = proj.toXY(geom[i].lat, geom[i].lon);
    const [xj, yj] = proj.toXY(geom[j].lat, geom[j].lon);
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

/* ============================================================
   КЛАССИФИКАЦИЯ типа водоёма из тегов OSM → ключ WATERS
   ============================================================ */
export function classifyWater(tags = {}, areaHa = 0) {
  const name = (tags.name || "").toLowerCase();
  const ww = tags.waterway;
  const w = tags.water;

  if (/стариц|ерик|курья/.test(name)) return "oxbow";
  if (/водохранилищ|вдхр|вусл/.test(name)) return "reservoir";
  if (/\bканал\b/.test(name)) return "canal";

  if (ww === "river") return areaHa > 8 ? "river_big" : "river_small";
  if (ww === "stream") return "river_small";
  if (ww === "canal" || ww === "ditch" || ww === "drain") return "canal";

  if (w === "pond") return "pond";
  if (w === "lake") return areaHa > 0 && areaHa < 1.5 ? "pond" : "lake";
  if (w === "reservoir" || w === "basin" || tags.landuse === "reservoir") return "reservoir";
  if (w === "oxbow") return "oxbow";
  if (w === "canal") return "canal";
  if (w === "river") return areaHa > 8 ? "river_big" : "river_small";
  if (w === "lagoon" || w === "lake;pond") return "lake";

  if (tags.natural === "water" || w) {
    if (areaHa > 0 && areaHa < 1.2) return "pond";
    if (areaHa < 60) return "lake";
    return "reservoir";
  }
  return "lake";
}

/* ---------- Запрос: точка на воде? ---------- */
export async function detectWater(lat, lon) {
  const q =
`[out:json][timeout:25];
is_in(${lat},${lon})->.a;
( area.a["natural"="water"]; area.a["water"]; area.a["landuse"="reservoir"]; );
out tags;
( way(around:30,${lat},${lon})["waterway"~"^(river|stream|canal|ditch|drain)$"]; );
out tags geom;`;
  const data = await overpass(q);
  return parseDetect(data, lat, lon);
}

/* Чистый парсер ответа detectWater (тестируемый) */
export function parseDetect(data, lat, lon) {
  const els = data?.elements || [];
  const areas = els.filter(e => e.type === "area" && e.tags &&
    (e.tags.natural === "water" || e.tags.water || e.tags.landuse === "reservoir"));
  const lines = els.filter(e => e.type === "way" && e.tags && e.tags.waterway);

  if (areas.length) {
    const a = areas[0];
    return { isWater: true, kind: "area", tags: a.tags, name: a.tags.name || null,
      type: classifyWater(a.tags), source: "osm-area" };
  }
  if (lines.length) {
    const proj = projector(lat, lon);
    let best = lines[0], bestD = Infinity;
    for (const l of lines) {
      const d = l.geometry ? distToGeomM(lat, lon, l.geometry, proj) : 0;
      if (d < bestD) { bestD = d; best = l; }
    }
    return { isWater: true, kind: "line", tags: best.tags, name: best.tags.name || null,
      type: classifyWater(best.tags), distM: isFinite(bestD) ? Math.round(bestD) : null, source: "osm-line" };
  }
  return { isWater: false };
}

/* ---------- Запрос: рельеф в радиусе ---------- */
export async function fetchSurroundings(lat, lon, radius = 300) {
  const q =
`[out:json][timeout:30];
( way(around:${radius},${lat},${lon})["natural"="water"];
  relation(around:${radius},${lat},${lon})["natural"="water"];
  way(around:${radius},${lat},${lon})["water"];
  way(around:${radius},${lat},${lon})["waterway"~"^(river|stream|canal|ditch|drain)$"];
  way(around:${radius},${lat},${lon})["natural"="wetland"];
  way(around:${radius},${lat},${lon})["natural"="reedbed"];
  way(around:${radius},${lat},${lon})["man_made"="pier"];
  way(around:${radius},${lat},${lon})["bridge"];
  way(around:${radius},${lat},${lon})["natural"="beach"]; );
out tags geom;`;
  const data = await overpass(q);
  return parseSurroundings(data, lat, lon, radius);
}

/* Чистый парсер рельефа (тестируемый) */
export function parseSurroundings(data, lat, lon, radius = 300) {
  const proj = projector(lat, lon);
  const els = (data?.elements || []).filter(e => e.geometry && e.geometry.length);
  const waters = [], waterways = [], reeds = [], beaches = [], bridges = [];

  for (const e of els) {
    const t = e.tags || {};
    const closed = e.geometry.length > 2 &&
      e.geometry[0].lat === e.geometry.at(-1).lat && e.geometry[0].lon === e.geometry.at(-1).lon;
    const item = { id: e.id, tags: t, geom: e.geometry, closed };
    if (t.natural === "water" || t.water) {
      item.areaHa = polygonAreaM2(e.geometry, proj) / 10000;
      waters.push(item);
    } else if (t.waterway) {
      waterways.push(item);
    } else if (t.natural === "wetland" || t.natural === "reedbed") {
      reeds.push(item);
    } else if (t.natural === "beach") {
      beaches.push(item);
    } else if (t.bridge || t.man_made === "pier") {
      bridges.push(item);
    }
  }
  let main = null;
  for (const w of waters) {
    if (pointInRing(lat, lon, w.geom, proj)) { main = w; break; }
  }
  if (!main && waters.length) main = waters.slice().sort((a, b) => (b.areaHa || 0) - (a.areaHa || 0))[0];

  return { point: { lat, lon }, radius, proj, waters, waterways, reeds, beaches, bridges, main };
}

/* ============================================================
   ПРОФИЛЬ ВОДОЁМА — научная сводка для аналитика
   ============================================================ */
export function profileWater(detect, surr, lat) {
  const proj = surr?.proj || projector(lat, surr?.point?.lon ?? 0);
  const main = surr?.main;
  const tags = main?.tags || detect?.tags || {};
  const name = main?.tags?.name || detect?.name || null;
  const areaHa = main?.areaHa ?? null;

  const type = detect?.type || classifyWater(tags, areaHa || 0);
  const linear = detect?.kind === "line" || ["river_small", "river_big", "canal"].includes(type);

  let sizeClass = "unknown";
  let widthM;
  if (linear) {
    const width = parseFloat(tags.width) || (type === "river_big" ? 60 : type === "canal" ? 15 : 8);
    sizeClass = width > 80 ? "huge" : width > 30 ? "large" : width > 10 ? "medium" : "small";
    widthM = width;
  } else if (areaHa != null) {
    sizeClass = areaHa < 0.5 ? "tiny" : areaHa < 5 ? "small" : areaHa < 50 ? "medium" : areaHa < 500 ? "large" : "huge";
  }

  const rivers = (surr?.waterways || []).filter(w => /^(river|stream|canal)$/.test(w.tags.waterway));
  let connectivity = 0, inflows = [];
  if (linear) {
    connectivity = 1;
  } else if (main) {
    for (const r of rivers) {
      const near = minDistGeomToGeom(r.geom, main.geom, proj) < 25;
      if (near) { connectivity = 1; if (r.tags.name) inflows.push(r.tags.name); }
    }
    if (!connectivity && rivers.length) connectivity = 0.4;
  }

  const reeds = (surr?.reeds || []).length > 0;
  const beach = (surr?.beaches || []).length > 0;
  const bridge = (surr?.bridges || []).length > 0;
  const islands = (surr?.waters || []).filter(w => w !== main && pointInsideAny(w, main, proj)).length;

  return {
    type, name, linear, areaHa, widthM: typeof widthM === "number" ? widthM : null,
    sizeClass, connectivity, inflows: [...new Set(inflows)].slice(0, 4),
    reeds, beach, bridge, islands,
    shorelineComplex: main ? shorelineComplexity(main.geom, proj) : null,
    dataQuality: main || detect?.tags ? "osm" : "inferred",
  };
}

function minDistGeomToGeom(g1, g2, proj) {
  let best = Infinity;
  for (const p of g1) best = Math.min(best, distToGeomM(p.lat, p.lon, g2, proj));
  return best;
}
function pointInsideAny(small, big, proj) {
  if (!big || !small?.geom?.length) return false;
  const c = small.geom[0];
  return pointInRing(c.lat, c.lon, big.geom, proj);
}
function shorelineComplexity(geom, proj) {
  if (!geom || geom.length < 4) return null;
  let per = 0;
  for (let i = 0; i < geom.length - 1; i++) {
    const [x1, y1] = proj.toXY(geom[i].lat, geom[i].lon);
    const [x2, y2] = proj.toXY(geom[i + 1].lat, geom[i + 1].lon);
    per += Math.hypot(x2 - x1, y2 - y1);
  }
  const area = polygonAreaM2(geom, proj) || 1;
  const ratio = (per * per) / (4 * Math.PI * area);
  return Math.round(ratio * 10) / 10;
}

/* ============================================================
   РЕАЛИСТИЧНАЯ ДИСТАНЦИЯ ЗАБРОСА
   ============================================================ */
const COMFORT = {
  float:    { min: 5,  rec: 12, max: 22 },
  feeder:   { min: 25, rec: 40, max: 60 },
  spinning: { min: 12, rec: 30, max: 50 },
  livebait: { min: 5,  rec: 12, max: 20 },
};

export function realisticCastDistance(tackle, profile) {
  const c = COMFORT[tackle] || COMFORT.feeder;
  let reach = Infinity, reason = "";
  if (profile?.linear && profile.widthM) {
    reach = profile.widthM;
    reason = `ширина русла ≈ ${Math.round(profile.widthM)} м`;
  } else if (profile?.areaHa) {
    const R = Math.sqrt((profile.areaHa * 10000) / Math.PI);
    reach = R * 1.5;
    reason = `водоём ≈ ${fmtHa(profile.areaHa)}`;
  }
  let min = c.min, rec = c.rec, max = c.max, clamped = false;
  if (isFinite(reach)) {
    const usableMax = Math.max(6, Math.round(reach * 0.9));
    if (usableMax < c.max) {
      clamped = true;
      max = usableMax;
      min = Math.min(c.min, Math.max(5, Math.round(reach * 0.3)));
      rec = Math.max(min, Math.min(Math.round(reach * 0.55), max));
    }
  }
  const label = `${min}–${max} м` + (rec ? ` (оптимум ~${rec} м)` : "");
  let note;
  if (clamped && (profile?.sizeClass === "tiny" || profile?.sizeClass === "small")) {
    note = `Водоём небольшой (${reason}) — дальний заброс не нужен, рыба часто под самым берегом.`;
  } else if (profile?.linear) {
    note = `Малая/средняя река (${reason}): ловят накоротке, важнее точка, чем дальность.`;
  } else {
    note = `Комфортная дистанция для снасти; на большой воде дальше уже непродуктивно.`;
  }
  return { minM: min, recM: rec, maxM: max, label, note, reachM: isFinite(reach) ? Math.round(reach) : null };
}

export function fmtHa(ha) {
  if (ha == null) return "—";
  if (ha < 1) return Math.round(ha * 10000) + " м²";
  if (ha < 100) return (Math.round(ha * 10) / 10) + " га";
  return Math.round(ha / 100 * 10) / 10 + " км²";
}

export const SIZE_NAMES = {
  tiny: "очень малый", small: "малый", medium: "средний",
  large: "крупный", huge: "очень крупный", unknown: "размер неизвестен",
};
