/* ============================================================
   КлёвГид — логика приложения: мастер шагов, карта, рендер.
   Архитектура описана в ai/docs/02-architecture.md
   ============================================================ */

import { WATERS, FEATURES, DEPTHS, TACKLE, BAITS, FISHES, windDirName } from "./fishdb.js";
import { fetchWeather, reverseGeocode, estimateWaterTemp, waterTempSeries,
         pressureTrend, weatherWord, manualWeather } from "./weather.js";
import { moonPhase, sunTimes, dayPeriod, PERIOD_NAMES } from "./astro.js";
import { fishActivityNow, activityLabel, computeBite, buildTactics, buildSummary, adviseFish } from "./engine.js";
import { gaugeSVG, hourlyChartSVG, pressureChartSVG, tempChartSVG,
         windCompassSVG, moonSVG, fishSVG, waterIconSVG, animateCount } from "./charts.js";
import { selectSpots } from "./spotmaps.js";
import { detectWater, fetchSurroundings, profileWater, realisticCastDistance, SIZE_NAMES, fmtHa } from "./osm.js";
import { analyzeWater } from "./ai-analyst.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const STORE_KEY = "klevgid.v1";

/* ---------- Состояние ---------- */
const state = {
  lat: null, lon: null, placeName: null,
  water: null, autoWater: null, features: [], autoFeatures: [], depth: "mid",
  detect: null, surr: null, waterProfile: null, aiAnalysis: null, castInfo: null,
  weather: null, waterTemp: null,
  fishId: null, tackle: null, baitsOwned: [],
};
let step = 0;          // 0 — хиро
let maxStep = 1;       // максимально открытый шаг
let map = null, marker = null;
let condLoaded = false;
let analyzeToken = 0;  // защита от гонок при быстрой смене точки

/* ============================================================
   Навигация по шагам
   ============================================================ */
function goTo(n) {
  step = n;
  maxStep = Math.max(maxStep, n);
  $$(".step-section").forEach(sec => { sec.hidden = +sec.dataset.step !== n; });
  $("#hero").style.display = n === 0 ? "" : "none";
  if (n === 0) $("#hero").scrollIntoView();

  $$(".snav").forEach(b => {
    const i = +b.dataset.goto;
    b.classList.toggle("active", i === n);
    b.classList.toggle("done", i < n);
    b.disabled = i > maxStep;
  });
  $("#progressFill").style.width = (n / 6 * 100) + "%";

  if (n > 0) {
    const sec = $(`#step${n}`);
    sec.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));
    window.scrollTo({ top: sec.offsetTop - 70, behavior: "smooth" });
  }
  if (n === 1 && map) setTimeout(() => map.invalidateSize(), 250);
  if (n === 3 && !condLoaded) loadConditions();
  if (n === 4) renderFishGrid();
}

$$(".snav").forEach(b => b.addEventListener("click", () => {
  const n = +b.dataset.goto;
  if (n <= maxStep) goTo(n);
}));
$$("[data-back]").forEach(b => b.addEventListener("click", () => goTo(+b.dataset.back)));
$("#startBtn").addEventListener("click", () => goTo(1));

/* ============================================================
   Шаг 1 — карта и точка
   ============================================================ */
function initMap() {
  if (!window.L) { $("#mapHint").textContent = "Карта не загрузилась — введите координаты вручную"; return; }
  const start = [55.75, 37.62];
  map = L.map("map", { zoomControl: true }).setView(start, 9);
  map.attributionControl.setPrefix(false); // без префикса Leaflet (флаг и ссылка); © OpenStreetMap — обязательная пометка лицензии
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: "© OpenStreetMap",
  }).addTo(map);
  map.on("click", e => setPoint(e.latlng.lat, e.latlng.lng));
}

const pinIcon = () => L.divIcon({
  className: "cast-marker",
  html: `<svg width="38" height="48" viewBox="0 0 38 48">
    <path d="M19 1C9 1 2 8.6 2 18.2 2 30 19 47 19 47s17-17 17-28.8C36 8.6 29 1 19 1Z" fill="#d97757" stroke="#fff" stroke-width="2.5"/>
    <circle cx="19" cy="18" r="6.5" fill="#fff"/></svg>`,
  iconSize: [38, 48], iconAnchor: [19, 47],
});

async function setPoint(lat, lon, { silent = false } = {}) {
  state.lat = +lat.toFixed(5);
  state.lon = +lon.toFixed(5);
  condLoaded = false;
  $("#latInput").value = state.lat;
  $("#lonInput").value = state.lon;

  if (map) {
    if (!marker) marker = L.marker([lat, lon], { icon: pinIcon(), draggable: true }).addTo(map)
      .on("dragend", () => { const p = marker.getLatLng(); setPoint(p.lat, p.lng); });
    else marker.setLatLng([lat, lon]);
    if (!silent) map.flyTo([lat, lon], Math.max(map.getZoom(), 11), { duration: .8 });
    $("#mapHint").classList.add("hide");
  }

  $("#placeCard").hidden = false;
  $("#placeName").textContent = "Проверяю, водоём ли это…";
  $("#placeCoords").textContent = `${state.lat}, ${state.lon}`;
  $("#toStep2").disabled = true;
  localStorage.setItem(STORE_KEY, JSON.stringify({ lat: state.lat, lon: state.lon }));
  validateAndAnalyze();
}

/* ---------- Проверка «это вода?» + AI-разбор водоёма ---------- */
async function validateAndAnalyze() {
  const token = ++analyzeToken;
  const report = $("#waterReport");
  report.hidden = false;
  report.innerHTML = `<div class="loader"><span></span><span></span><span></span> Определяю водоём по карте…</div>`;

  reverseGeocode(state.lat, state.lon).then(n => {
    if (token === analyzeToken && n) { state.placeName = n; if (state.detect) $("#placeName").textContent = state.detect.name || n; }
  });

  let detect;
  try { detect = await detectWater(state.lat, state.lon); }
  catch (e) { if (token === analyzeToken) waterUnknown(report, false); return; }
  if (token !== analyzeToken) return;

  if (!detect.isWater) {
    state.detect = state.surr = state.waterProfile = state.aiAnalysis = null;
    state.water = state.autoWater = null;
    $("#toStep2").disabled = true;
    $("#placeName").textContent = "Это не похоже на водоём";
    report.innerHTML = `<div class="water-bad card">
      <b>🚫 По карте здесь нет воды.</b>
      <span>Поставьте точку прямо на реке, озере, пруду или водохранилище. Если водоём маленький и не отмечен — приблизьте карту и кликните точнее по воде, либо <button class="linklike" id="forceWater">продолжить вручную</button>.</span>
    </div>`;
    $("#forceWater")?.addEventListener("click", () => waterUnknown(report, true));
    return;
  }

  state.detect = detect;
  state.water = state.autoWater = detect.type;
  $("#toStep2").disabled = false;
  $("#placeName").textContent = detect.name || state.placeName || WATERS[detect.type].name;

  report.innerHTML = `<div class="loader"><span></span><span></span><span></span> Анализирую рельеф 300 м и видовой состав…</div>`;
  let surr = null, profile;
  try { surr = await fetchSurroundings(state.lat, state.lon, 300); profile = profileWater(detect, surr, state.lat); }
  catch (e) { profile = profileWater(detect, null, state.lat); }
  if (token !== analyzeToken) return;
  profile.lat = state.lat;
  state.surr = surr; state.waterProfile = profile;
  state.autoFeatures = deriveFeatures(profile);

  const ai = await analyzeWater({ profile, month: new Date().getMonth(), waterTemp: null, weather: { lat: state.lat } });
  if (token !== analyzeToken) return;
  state.aiAnalysis = ai;
  renderWaterReport(ai);
}

function waterUnknown(report, forced) {
  state.detect = state.surr = state.waterProfile = state.aiAnalysis = null;
  state.water = state.autoWater = forced ? state.water : null;
  $("#toStep2").disabled = false;
  report.hidden = false;
  report.innerHTML = `<div class="water-warn card">
    <b>${forced ? "Продолжаем вручную." : "Не удалось проверить водоём — нет связи с картографическим сервисом."}</b>
    <span>Тип водоёма выберите на следующем шаге сами. Остальной расчёт (погода, вода, клёв, схемы) работает как обычно.</span></div>`;
}

/* Признаки места из профиля OSM → ключи FEATURES */
function deriveFeatures(profile) {
  const f = [];
  if (profile?.reeds) f.push("reeds");
  if (profile?.bridge) f.push("bridge");
  if (profile?.beach) f.push("flat");
  return f;
}

function renderWaterReport(ai) {
  const report = $("#waterReport");
  const dq = ai.dataQuality === "osm"
    ? `<span class="dq dq-osm">данные карты OSM</span>`
    : `<span class="dq dq-inf">оценка по аналогии</span>`;
  const prov = `<span class="dq dq-ai">${ai.provider === "claude" ? "AI · Claude" : "авто-аналитик"}</span>`;
  const chips = ai.species.slice(0, 6).map(s => {
    const c = Math.round(s.confidence * 100);
    const cls = c >= 55 ? "good" : c >= 30 ? "warn" : "bad";
    return `<span class="sp-chip">${s.name}<i class="dot ${cls}"></i>${c}%</span>`;
  }).join("");
  const ev = ai.waterEvidence.map(e => `<li>${e}</li>`).join("");
  report.innerHTML = `
    <div class="card water-card">
      <div class="wc-head"><h4>🔬 Разбор водоёма</h4><div class="dq-row">${dq}${prov}</div></div>
      <p class="wc-sum">${ai.summary}</p>
      <div class="sp-chips" title="вероятность обитания вида здесь">${chips}</div>
      <details class="wc-ev"><summary>Что учтено в анализе (${ai.waterEvidence.length})</summary>
        <ul>${ev}</ul>${ai.notes.map(n => `<p class="wc-note">• ${n}</p>`).join("")}</details>
    </div>`;
}

$("#geoBtn").addEventListener("click", () => {
  if (!navigator.geolocation) { alert("Браузер не поддерживает геолокацию — кликните по карте."); return; }
  $("#geoBtn").textContent = "Определяю…";
  navigator.geolocation.getCurrentPosition(
    p => { setPoint(p.coords.latitude, p.coords.longitude); resetGeoBtn(); },
    () => { alert("Не удалось получить местоположение. Разрешите доступ или поставьте точку на карте."); resetGeoBtn(); },
    { enableHighAccuracy: true, timeout: 12000 },
  );
});
function resetGeoBtn() {
  $("#geoBtn").innerHTML = `<svg viewBox="0 0 24 24" class="ic"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3h-2.07A7 7 0 0 0 13 5.07V3h-2v2.07A7 7 0 0 0 5.07 11H3v2h2.07A7 7 0 0 0 11 18.93V21h2v-2.07A7 7 0 0 0 18.93 13H21v-2Z" fill="currentColor"/></svg> Моё местоположение`;
}

$("#coordApplyBtn").addEventListener("click", () => {
  const lat = parseFloat($("#latInput").value), lon = parseFloat($("#lonInput").value);
  if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    alert("Проверьте координаты: широта −90…90, долгота −180…180."); return;
  }
  setPoint(lat, lon);
});
$("#toStep2").addEventListener("click", () => goTo(2));

/* ============================================================
   Шаг 2 — водоём, ориентиры, глубина
   ============================================================ */
function renderWaterStep() {
  const tiles = $("#waterTiles");
  tiles.innerHTML = "";
  for (const [key, w] of Object.entries(WATERS)) {
    const b = document.createElement("button");
    b.className = "tile reveal in";
    const auto = key === state.autoWater;
    b.innerHTML = `${waterIconSVG(w.icon)}<b>${w.name}${auto ? ' <span class="auto-tag">по карте</span>' : ""}</b><span>${w.desc}</span>`;
    if (key === state.water) b.classList.add("selected");
    b.addEventListener("click", () => {
      state.water = key; condLoaded = false;
      $$(".tile", tiles).forEach(t => t.classList.toggle("selected", t === b));
      $("#toStep3").disabled = false;
    });
    tiles.appendChild(b);
  }
  $("#toStep3").disabled = !state.water;
  $("#waterAutoNote")?.remove();
  if (state.autoWater) {
    const note = document.createElement("p");
    note.id = "waterAutoNote"; note.className = "subnote auto-note";
    note.innerHTML = `✓ Тип определён по карте как «${WATERS[state.autoWater].name.toLowerCase()}». Если ошиблись — выберите другой.`;
    tiles.after(note);
  }

  state.features = [...new Set([...(state.autoFeatures || [])])];
  const chips = $("#featureChips");
  chips.innerHTML = "";
  for (const [key, f] of Object.entries(FEATURES)) {
    const c = document.createElement("button");
    const on = state.features.includes(key);
    c.className = "chip" + (on ? " selected" : "");
    c.innerHTML = `<span class="em">${f.em}</span>${f.name}${on ? ' <span class="auto-tag">по карте</span>' : ""}`;
    c.addEventListener("click", () => {
      c.classList.toggle("selected");
      state.features = $$(".chip.selected", chips).map(x => x.dataset.key);
    });
    c.dataset.key = key;
    chips.appendChild(c);
  }

  const seg = $("#depthSeg");
  seg.innerHTML = "";
  for (const [key, d] of Object.entries(DEPTHS)) {
    const b = document.createElement("button");
    b.textContent = d.name;
    b.classList.toggle("selected", key === state.depth);
    b.addEventListener("click", () => {
      state.depth = key;
      $$("button", seg).forEach(x => x.classList.toggle("selected", x === b));
    });
    seg.appendChild(b);
  }
}
$("#toStep3").addEventListener("click", () => goTo(3));

/* ============================================================
   Шаг 3 — условия
   ============================================================ */
async function loadConditions() {
  $("#condLoader").style.display = "flex";
  $("#condGrid").hidden = true;
  $("#condExtra").hidden = true;
  $("#manualCond").hidden = true;
  $("#toStep4").disabled = true;

  try {
    const w = await fetchWeather(state.lat, state.lon);
    state.weather = w;
    state.waterTemp = estimateWaterTemp(w.hours, w.nowIdx, state.water, state.lat);
    condLoaded = true;
    renderConditions();
  } catch (e) {
    console.warn("Метео недоступно:", e);
    $("#condLoader").style.display = "none";
    $("#manualCond").hidden = false;
  }
}

$("#condRefresh").addEventListener("click", () => { condLoaded = false; loadConditions(); });
$("#manualApply").addEventListener("click", () => {
  state.weather = manualWeather({
    air: +$("#mAir").value, water: +$("#mWater").value,
    pressure: +$("#mPressure").value, wind: +$("#mWind").value,
    windDir: +$("#mWindDir").value, clouds: +$("#mClouds").value,
  }, state.lat, state.lon);
  state.waterTemp = +$("#mWater").value;
  condLoaded = true;
  renderConditions(true);
});

function condCard(label, icon, valueHTML, sub, tag) {
  return `<div class="card cond-card">
    <div class="cond-label">${icon}${label}</div>
    <div class="cond-value">${valueHTML}</div>
    ${sub ? `<div class="cond-sub">${sub}</div>` : ""}
    ${tag ? `<span class="cond-tag ${tag.cls}">${tag.text}</span>` : ""}
  </div>`;
}
const I = {
  air: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v10m0 0a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/></svg>`,
  water: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z"/></svg>`,
  press: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 12l4-4"/></svg>`,
  wind: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8a3 3 0 1 1-3 3"/></svg>`,
  sky: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18a4 4 0 0 1 0-8 6 6 0 0 1 11.6 1.6A3.5 3.5 0 0 1 17 18H6Z"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10Z"/></svg>`,
  time: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
};

function renderConditions(manual = false) {
  const w = state.weather, c = w.current;
  const trend = pressureTrend(w.hours, w.nowIdx);
  const moon = moonPhase(c.time);
  const st = w.daily.sunrise.length
    ? { sunrise: w.daily.sunrise[7] ?? w.daily.sunrise[0], sunset: w.daily.sunset[7] ?? w.daily.sunset[0] }
    : sunTimes(new Date(), state.lat, state.lon);
  const period = dayPeriod(c.time, st.sunrise, st.sunset);
  const fmt = d => d ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";

  const wt = state.waterTemp;
  const wtTag = wt == null ? null
    : wt < 8 ? { cls: "bad", text: "холодная вода" }
    : wt < 14 ? { cls: "warn", text: "прохладная" }
    : wt <= 22 ? { cls: "good", text: "комфортная" }
    : { cls: "warn", text: "тёплая, ищите глубину" };

  const grid = $("#condGrid");
  grid.innerHTML =
    condCard("Воздух", I.air, `${fmtT(c.t)}<small> °C</small>`,
      `ощущается как ${fmtT(c.feels)} °C · ${weatherWord(c.code)}`,
      { cls: "info", text: manual ? "введено вручную" : "реальные данные" }) +
    condCard("Вода (модель)", I.water, wt != null ? `${wt.toFixed(1)}<small> °C</small>` : "—",
      manual ? "указана вами" : `оценка для: ${WATERS[state.water].name.toLowerCase()} · точность ±2 °C`,
      wtTag) +
    condCard("Давление", I.press, `${Math.round(c.pressureMm)}<small> мм</small>`,
      `за сутки: ${trend.delta > 0 ? "+" : ""}${trend.delta} мм`,
      { cls: trend.cls, text: trend.label }) +
    `<div class="card cond-card">
      <div class="cond-label">${I.wind}Ветер</div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:6px">
        ${windCompassSVG(c.windDir, c.windMs)}
        <div><div class="cond-value" style="margin:0">${c.windMs.toFixed(1)}<small> м/с</small></div>
        <div class="cond-sub">${windDirName(c.windDir)} · порывы до ${Math.round(c.gusts)} м/с</div></div>
      </div>
    </div>` +
    condCard("Небо", I.sky, `${Math.round(c.clouds)}<small> %</small>`,
      `облачность · осадки ${c.precip > 0.05 ? c.precip.toFixed(1) + " мм/ч" : "нет"}`) +
    `<div class="card cond-card">
      <div class="cond-label">${I.moon}Луна</div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:6px">
        ${moonSVG(moon.frac)}
        <div><b style="font-size:.95rem">${moon.name}</b>
        <div class="cond-sub">освещённость ${Math.round(moon.illum * 100)}%</div></div>
      </div>
    </div>` +
    condCard("Время на точке", I.time, fmt(c.time),
      st.sunrise ? `восход ${fmt(st.sunrise)} · закат ${fmt(st.sunset)}` : "полярный день/ночь",
      { cls: period === "dawn" || period === "dusk" ? "good" : "info", text: "сейчас " + PERIOD_NAMES[period] });

  $("#condLoader").style.display = "none";
  grid.hidden = false;

  if (!manual) {
    $("#pressureChart").innerHTML = pressureChartSVG(w.hours, w.nowIdx);
    $("#tempChart").innerHTML = tempChartSVG(waterTempSeries(w.hours, w.nowIdx, state.water));
    $("#condExtra").hidden = false;
    $$("#condExtra .reveal").forEach(el => el.classList.add("in"));
  } else {
    $("#condExtra").hidden = true;
  }
  $("#toStep4").disabled = false;
}
const fmtT = v => (v > 0 ? "+" : "") + Math.round(v * 10) / 10;

$("#toStep4").addEventListener("click", () => goTo(4));

/* ============================================================
   Шаг 4 — рыба
   ============================================================ */
function fishCtx() {
  const w = state.weather;
  const st = w.daily.sunrise.length
    ? { sunrise: w.daily.sunrise[7] ?? w.daily.sunrise[0], sunset: w.daily.sunset[7] ?? w.daily.sunset[0] }
    : sunTimes(new Date(), state.lat, state.lon);
  return {
    water: state.water, lat: state.lat,
    month: w.current.time.getMonth(),
    waterTemp: state.waterTemp, now: w.current.time,
    sunrise: st.sunrise, sunset: st.sunset,
  };
}

function renderFishGrid() {
  const ctx = fishCtx();
  const grid = $("#fishGrid");
  grid.innerHTML = "";

  let list, aiMode = false;
  if (state.aiAnalysis?.species?.length) {
    aiMode = true;
    list = state.aiAnalysis.species.map(s => ({
      id: s.id, f: FISHES[s.id], ai: s, a: fishActivityNow(s.id, ctx) || { score: 0, why: "" },
    }));
  } else {
    list = Object.entries(FISHES)
      .map(([id, f]) => ({ id, f, ai: null, a: fishActivityNow(id, ctx) }))
      .filter(x => x.a).sort((a, b) => b.a.score - a.a.score);
  }

  renderAiPanel(aiMode);

  $("#fishIntro").textContent = aiMode
    ? `AI-аналитик разобрал ваш водоём и оценил ${list.length} вероятных видов. Процент — шанс, что вид здесь водится; бейдж — активность прямо сейчас.`
    : `В водоёме «${WATERS[state.water].name.toLowerCase()}» в вашем регионе реально ловятся ${list.length} видов. Отсортированы по активности прямо сейчас.`;

  list.forEach(({ id, f, a, ai }, i) => {
    const lab = activityLabel(a.score);
    const card = document.createElement("button");
    card.className = "fish-card";
    card.style.animationDelay = (i * 50) + "ms";
    const conf = ai ? Math.round(ai.confidence * 100) : null;
    const confCls = conf == null ? "" : conf >= 55 ? "good" : conf >= 30 ? "warn" : "bad";
    const why = ai ? ai.rationale : (a.why[0].toUpperCase() + a.why.slice(1) + ".");
    card.innerHTML = `
      <div class="fish-art">${fishSVG(f.shape, f.hue)}</div>
      <b>${f.name}</b><span class="latin">${f.latin}</span>
      <div class="fish-badges">
        ${conf != null ? `<span class="conf-badge ${confCls}" title="вероятность обитания здесь">${conf}% здесь</span>` : ""}
        <span class="act-badge ${lab.cls}">${lab.label}</span>
      </div>
      <div class="fish-why">${why}</div>`;
    card.addEventListener("click", () => {
      state.fishId = id;
      $$(".fish-card", grid).forEach(x => x.classList.toggle("selected", x === card));
      $("#toStep5").disabled = false;
    });
    grid.appendChild(card);
  });

  if (state.fishId && !list.some(x => x.id === state.fishId)) { state.fishId = null; $("#toStep5").disabled = true; }
}

function renderAiPanel(aiMode) {
  const panel = $("#aiPanel");
  if (!panel) return;
  if (!aiMode || !state.aiAnalysis) { panel.innerHTML = ""; panel.classList.remove("in"); return; }
  const ai = state.aiAnalysis;
  const dq = ai.dataQuality === "osm"
    ? `<span class="dq dq-osm">по карте OSM</span>` : `<span class="dq dq-inf">по аналогии</span>`;
  const prov = `<span class="dq dq-ai">${ai.provider === "claude" ? "AI · Claude" : "авто-аналитик"}</span>`;
  panel.innerHTML = `
    <div class="card ai-card">
      <div class="wc-head"><h4>🔬 Что говорит анализ водоёма</h4><div class="dq-row">${dq}${prov}</div></div>
      <p class="wc-sum">${ai.summary}</p>
    </div>`;
  panel.classList.add("in");
}

$("#autoFish").addEventListener("click", () => {
  const best = adviseFish(state, Object.keys(FISHES));
  if (!best) return;
  state.fishId = best;
  $$("#fishGrid .fish-card").forEach(c => {
    const isIt = c.querySelector("b").textContent === FISHES[best].name;
    c.classList.toggle("selected", isIt);
    if (isIt) c.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#toStep5").disabled = false;
});
$("#toStep5").addEventListener("click", () => { goTo(5); renderTackleStep(); });

/* ============================================================
   Шаг 5 — снасть и насадки
   ============================================================ */
function renderTackleStep() {
  const fish = FISHES[state.fishId];
  const tiles = $("#tackleTiles");
  tiles.innerHTML = "";
  for (const [key, t] of Object.entries(TACKLE)) {
    const fit = fish.tackle[key] ?? 0;
    const b = document.createElement("button");
    b.className = "tile";
    const fitTxt = fit >= 0.8 ? ["good", "отлично подходит"] : fit >= 0.4 ? ["warn", "рабочий вариант"] : ["bad", `слабо подходит для: ${fish.name.toLowerCase()}`];
    b.innerHTML = `<span style="font-size:2rem">${t.em}</span><b>${t.name}</b><span>${t.desc} · ${t.dist}</span>
      <span class="cond-tag ${fitTxt[0]}" style="margin-top:8px">${fitTxt[1]}</span>`;
    b.addEventListener("click", () => {
      state.tackle = key;
      $$(".tile", tiles).forEach(x => x.classList.toggle("selected", x === b));
      renderBaitChips();
      $("#toResult").disabled = false;
    });
    tiles.appendChild(b);
  }
  renderBaitChips();
}

function renderBaitChips() {
  const chips = $("#baitChips");
  chips.innerHTML = "";
  for (const [key, b] of Object.entries(BAITS)) {
    if (state.tackle && !b.tackle.includes(state.tackle)) continue;
    const c = document.createElement("button");
    c.className = "chip" + (state.baitsOwned.includes(key) ? " selected" : "");
    c.innerHTML = `<span class="em">${b.em}</span>${b.name}`;
    c.addEventListener("click", () => {
      c.classList.toggle("selected");
      state.baitsOwned = $$(".chip.selected", chips).map(x => x.dataset.key);
    });
    c.dataset.key = key;
    chips.appendChild(c);
  }
  state.baitsOwned = state.baitsOwned.filter(k => !state.tackle || BAITS[k].tackle.includes(state.tackle));
}

$("#toResult").addEventListener("click", () => { renderResult(); goTo(6); });

/* ============================================================
   Шаг 6 — результат
   ============================================================ */
function renderResult() {
  const bite = computeBite(state);
  const fish = FISHES[state.fishId];

  $("#resultTitle").textContent = `${fish.name}: ${bite.verdict.title.toLowerCase()}`;
  $("#resultSubtitle").textContent =
    `${state.placeName || "Ваша точка"} · ${WATERS[state.water].name} · ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} · ${TACKLE[state.tackle].name.toLowerCase()}`;

  /* Индикатор */
  const g = $("#gaugeCard");
  g.innerHTML = gaugeSVG(bite.pct) +
    `<div class="gauge-verdict">${bite.verdict.title}</div>
     <p class="gauge-phrase">${bite.verdict.phrase}</p>`;
  animateCount(g.querySelector("[data-gauge-num]"), bite.pct, 1500, "%");

  /* Факторы */
  const fb = $("#factorBars");
  fb.innerHTML = bite.factors.map(f => {
    const pct = Math.round(f.score * 100);
    const col = pct >= 62 ? "var(--good)" : pct >= 40 ? "var(--warn)" : "var(--bad)";
    return `<div class="fbar">
      <div class="fbar-head"><b>${f.name}</b><span style="color:${col}">${pct}%</span></div>
      <div class="fbar-track"><div class="fbar-fill" data-w="${pct}" style="background:${col}"></div></div>
      <div class="fbar-note">${f.note}</div>
    </div>`;
  }).join("");
  requestAnimationFrame(() => setTimeout(() =>
    $$(".fbar-fill", fb).forEach((el, i) => setTimeout(() => el.style.width = el.dataset.w + "%", i * 90)), 80));

  /* Почасовой график */
  $("#hourlyChart").innerHTML = hourlyChartSVG(bite.hourly);

  /* Насадки */
  const compat = bite.baits.filter(b => b.compat).slice(0, 5);
  const incompat = bite.baits.filter(b => !b.compat).slice(0, 1);
  $("#baitList").innerHTML = compat.map((b, i) => `
    <div class="bait-item ${i === 0 ? "top" : ""}">
      <div class="bait-rank">${i + 1}</div>
      <div><b>${b.em} ${b.name}${b.owned ? `<span class="have">есть у вас</span>` : ""}</b>
      <p>${b.why[0].toUpperCase() + b.why.slice(1)}.</p></div>
    </div>`).join("") +
    (incompat.length && incompat[0].score > 0.5 ? `
    <div class="bait-item" style="opacity:.65">
      <div class="bait-rank">!</div>
      <div><b>${incompat[0].em} ${incompat[0].name}</b>
      <p>Очень уловиста по этой рыбе, но требует другой снасти.</p></div>
    </div>` : "");

  /* Тактика */
  $("#tacticsList").innerHTML = buildTactics(state, bite).map(t => `
    <div class="tactic-item">
      <div class="tactic-icon">${t.icon}</div>
      <div><b>${t.title}</b><p>${t.text}</p></div>
    </div>`).join("");

  /* Схемы точек — с реальным рельефом OSM и реалистичной дистанцией */
  state.castInfo = state.waterProfile ? realisticCastDistance(state.tackle, state.waterProfile) : null;
  const spots = selectSpots({ ...state, osm: state.surr });
  const noteEl = $("#spotsNote");
  if (noteEl) {
    noteEl.textContent = state.surr
      ? `Первая схема — реальный рельеф вашей точки по карте (радиус 300 м). ✕ — реалистичная точка заброса для вашей снасти${state.castInfo ? ": " + state.castInfo.label : ""}.`
      : `Типовые рабочие точки для вашего водоёма и рыбы. ✕ — куда забрасывать${state.castInfo ? " (" + state.castInfo.label + ")" : ""}.`;
  }
  $("#spotsGrid").innerHTML = spots.map(s => `
    <div class="card spot-card${s.real ? " spot-real" : ""}">
      <div class="spot-svg-wrap">${s.svg}</div>
      <div class="spot-body">
        <b>${s.real ? "📍 " : ""}${s.title}</b>
        <p>${s.desc}</p>
        <div class="spot-meta">${s.meta.map(m => `<span>${m}</span>`).join("")}</div>
        ${s.profileSvg}
      </div>
    </div>`).join("");

  /* Сводка */
  const sum = buildSummary(state, bite);
  const fmt = d => d ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";
  $("#summaryCard").innerHTML = `
    <h4>Сводка одним взглядом</h4>
    <div class="summary-grid">
      <div class="sum-item"><b>Цель</b><span>${sum.fish}</span></div>
      <div class="sum-item"><b>Шанс клёва</b><span>${sum.pct}%</span></div>
      <div class="sum-item"><b>Лучший час</b><span>${sum.bestHour}</span></div>
      <div class="sum-item"><b>Насадка №1</b><span>${sum.bait}</span></div>
      <div class="sum-item"><b>Снасть</b><span>${sum.tackle}</span></div>
      <div class="sum-item"><b>Зорьки</b><span>${fmt(bite.sunrise)} / ${fmt(bite.sunset)}</span></div>
    </div>`;
}

$("#printBtn").addEventListener("click", () => window.print());
$("#restartBtn").addEventListener("click", () => {
  // точка и её AI-разбор сохраняются; сбрасываем только выбор рыбака
  state.water = state.autoWater; state.features = [...(state.autoFeatures || [])];
  state.fishId = null; state.tackle = null; state.baitsOwned = [];
  state.castInfo = null; condLoaded = false;
  maxStep = state.water ? 2 : 1;
  renderWaterStep();
  $("#toStep4").disabled = true; $("#toStep5").disabled = true; $("#toResult").disabled = true;
  goTo(state.water ? 2 : 1);
});

/* ============================================================
   Появление при скролле + счётчики хиро
   ============================================================ */
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    if (e.target.hasAttribute("data-count")) animateCount(e.target, +e.target.dataset.count, 1200);
    io.unobserve(e.target);
  });
}, { threshold: 0.15 });
$$(".reveal, [data-count]").forEach(el => io.observe(el));

/* ============================================================
   Старт
   ============================================================ */
initMap();
renderWaterStep();
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  if (saved?.lat) {
    setPoint(saved.lat, saved.lon, { silent: true });
    if (map) map.setView([saved.lat, saved.lon], 10);
  }
} catch { /* пусто */ }
goTo(0);
