/* ============================================================
   КлёвГид — движок рекомендаций.
   Скоринг клёва, ранжирование насадок, генерация тактики.
   Формулы и веса описаны в ai/docs/05-algorithms.md
   ============================================================ */

import { FISHES, BAITS, WATERS, FEATURES, DEPTHS, TACKLE, windDirName } from "./fishdb.js";
import { moonPhase, sunTimes, dayPeriod, PERIOD_NAMES } from "./astro.js";
import { pressureTrend } from "./weather.js";

/* ---------- Вспомогательные ---------- */

/* Трапециевидная функция: 0 за пределами [a,d], 1 внутри [b,c] */
function trapezoid(x, [a, b, c, d]) {
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x > c) return (d - x) / (d - c);
  return 1;
}

/* Присутствие вида на данной широте (плавный спад за границами ареала) */
export function latPresence(fish, lat) {
  const [s, n] = fish.lat;
  if (lat >= s && lat <= n) return 1;
  const over = lat < s ? s - lat : lat - n;
  return Math.max(0, 1 - over / 3);
}

/* Сезонная активность с поправкой на широту:
   севернее 55° сезон сдвигается позже, южнее — раньше и длиннее */
export function seasonActivity(fish, month, lat) {
  const m = fish.months;
  const shift = (lat - 55) * 0.06;               // в «месяцах», ±0.9 на краях
  const idx = ((month - shift) % 12 + 12) % 12;
  const lo = Math.floor(idx), hi = (lo + 1) % 12, f = idx - lo;
  return m[lo] * (1 - f) + m[hi] * f;
}

/* Соответствие температуры воды виду */
export function tempScore(fish, waterT) {
  if (waterT == null) return 0.6;
  return trapezoid(waterT, fish.temp);
}

/* ---------- Факторы погоды (общие для всех видов) ---------- */

function windScore(windMs, windDirDeg, fish) {
  let s;
  if (windMs < 0.7) s = 0.72;                    // полный штиль — хуже среднего
  else if (windMs <= 5) s = 1;                   // лёгкая рябь — идеал
  else if (windMs <= 8) s = 0.7;
  else if (windMs <= 12) s = 0.45;
  else s = 0.25;
  const dir = ((windDirDeg % 360) + 360) % 360;  // откуда дует
  if (dir >= 315 || dir <= 90) s *= 0.85;        // северный/восточный — минус
  else if (dir >= 180 && dir <= 270) s *= 1.05;  // южный/западный — плюс
  return Math.min(1, s);
}

function skyScore(clouds, precip, waterT) {
  let s;
  const warm = waterT != null && waterT >= 16;
  if (warm) s = clouds >= 60 ? 1 : clouds >= 30 ? 0.88 : 0.72;   // летом пасмурно лучше
  else s = clouds >= 85 ? 0.8 : 0.95;                            // в холод — стабильная ясность
  if (precip > 4) s *= 0.35;                                     // ливень
  else if (precip > 1) s *= 0.75;                                // дождь
  else if (precip > 0.1) s *= warm ? 1.05 : 0.9;                 // морось летом — плюс
  return Math.min(1, s);
}

function pressureScore(trend, pressureMm) {
  let s;
  switch (trend.label) {
    case "стабильно":     s = 1; break;
    case "падает":        s = 0.8; break;
    case "растёт":        s = 0.72; break;
    case "резко падает":  s = 0.45; break;
    default:              s = 0.5;                // резко растёт
  }
  if (pressureMm < 728 || pressureMm > 778) s *= 0.8; // экстремумы
  return s;
}

/* ---------- Активность вида «прямо сейчас» (бейджи шага 4) ---------- */
export function fishActivityNow(fishId, ctx) {
  const fish = FISHES[fishId];
  const wAff = fish.waters[ctx.water] ?? 0;
  const pres = latPresence(fish, ctx.lat);
  if (wAff < 0.05 || pres <= 0) return null;     // вида здесь нет — не показываем

  const season = seasonActivity(fish, ctx.month, ctx.lat);
  const temp = tempScore(fish, ctx.waterTemp);
  const period = dayPeriod(ctx.now, ctx.sunrise, ctx.sunset);
  const time = fish.times[period] ?? 0.5;
  const score = wAff * pres * (0.45 * season + 0.35 * temp + 0.2 * time);

  const why = [];
  if (wAff >= 0.75) why.push("типичный обитатель такого водоёма");
  else if (wAff >= 0.4) why.push("встречается здесь регулярно");
  else why.push("заходит сюда нечасто");
  if (season >= 0.75) why.push("сезон активного клёва");
  else if (season <= 0.25) why.push("не сезон");
  if (temp >= 0.8) why.push("вода комфортной температуры");
  else if (temp <= 0.3) why.push(ctx.waterTemp < fish.temp[1] ? "вода ещё холодна" : "вода слишком тёплая");

  return { score, why: why.join(", "), season, temp, wAff };
}

export function activityLabel(score) {
  if (score >= 0.55) return { cls: "act-high", label: "Высокая активность" };
  if (score >= 0.3)  return { cls: "act-mid",  label: "Средняя активность" };
  return { cls: "act-low", label: "Низкая активность" };
}

/* ---------- Главный расчёт: шанс клёва ---------- */
export function computeBite(state) {
  const { weather, water, fishId, lat, lon } = state;
  const fish = FISHES[fishId];
  const cur = weather.current;
  const now = cur.time;
  const month = now.getMonth();
  const waterT = state.waterTemp;

  const sr = weather.daily.sunrise[7] || weather.daily.sunrise[0] || sunTimes(now, lat, lon).sunrise;
  const ss = weather.daily.sunset[7] || weather.daily.sunset[0] || sunTimes(now, lat, lon).sunset;

  const trend = pressureTrend(weather.hours, weather.nowIdx);
  const moon = moonPhase(now);
  const period = dayPeriod(now, sr, ss);

  const wAff = fish.waters[water] ?? 0;
  const pres = latPresence(fish, lat);

  /* Лучший балл насадки из имеющихся (или из всех, если не отмечали) */
  const baitRank = rankBaits(state);
  const baitBest = baitRank.length ? baitRank[0].score : 0.4;

  const F = [];
  const add = (key, name, score, weight, note) =>
    F.push({ key, name, score: Math.max(0, Math.min(1, score)), weight, note });

  add("season", "Сезон и календарь клёва", seasonActivity(fish, month, lat), 0.18,
      seasonNote(fish, month, lat));
  add("water", "Водоём для этой рыбы", wAff * pres, 0.13,
      wAff >= 0.7 ? "родная среда обитания" : wAff >= 0.35 ? "встречается, но не основная среда" : "здесь этот вид редок");
  add("temp", "Температура воды", tempScore(fish, waterT), 0.16,
      waterT != null ? `${waterT.toFixed(1)} °C при комфорте ${fish.temp[1]}–${fish.temp[2]} °C` : "оценка недоступна");
  add("time", "Время суток", fish.times[period] ?? 0.5, 0.12,
      `сейчас ${PERIOD_NAMES[period]}`);
  add("pressure", "Атмосферное давление", pressureScore(trend, cur.pressureMm), 0.14,
      `${Math.round(cur.pressureMm)} мм, ${trend.label} (${trend.delta > 0 ? "+" : ""}${trend.delta} мм/сутки)`);
  add("wind", "Ветер", windScore(cur.windMs, cur.windDir, fish), 0.09,
      `${cur.windMs.toFixed(1)} м/с, ${windDirName(cur.windDir)}`);
  add("sky", "Облачность и осадки", skyScore(cur.clouds, cur.precip, waterT), 0.08,
      `облачность ${Math.round(cur.clouds)}%${cur.precip > 0.1 ? ", осадки" : ""}`);
  add("moon", "Фаза Луны", moon.score, 0.05, `${moon.em} ${moon.name.toLowerCase()}`);
  add("bait", "Насадка", baitBest, 0.05,
      baitRank.length ? `лучшая — ${baitRank[0].name.toLowerCase()}` : "—");

  let total = F.reduce((s, f) => s + f.score * f.weight, 0) /
              F.reduce((s, f) => s + f.weight, 0);

  /* Жёсткий потолок, если вида в водоёме практически нет.
     Если AI-аналитик оценил правдоподобие вида на конкретном водоёме
     (по реальному рельефу OSM), используем его как более точную оценку
     присутствия — иначе падаем на базовое waters×latPresence. */
  const aiConf = state.aiAnalysis?.species?.find(s => s.id === fishId)?.confidence;
  const presence = aiConf != null ? aiConf : wAff * pres;
  if (presence < 0.15) total = Math.min(total, 0.14);
  else if (presence < 0.35) total = Math.min(total, 0.45);

  const pct = Math.round(Math.max(3, Math.min(96, total * 100)));

  return {
    pct,
    factors: F,
    verdict: verdictFor(pct, presence),
    moon, trend, period,
    sunrise: sr, sunset: ss,
    hourly: hourlyForecast(state, fish, sr, ss),
    baits: baitRank,
  };
}

function verdictFor(pct, presence) {
  if (presence < 0.15) return { title: "Не та рыба для этого места", phrase: "Этот вид здесь почти не встречается. Выберите другую рыбу — подскажем, кто тут реально клюёт." };
  if (pct < 22) return { title: "Шансы слабые", phrase: "Условия против вас. Если ехать всё равно — ловите на зорях и меняйте насадки чаще." };
  if (pct < 42) return { title: "Клёв вялый, но возможен", phrase: "Рыба малоактивна: подача деликатнее, крючки мельче, точку прикармливайте и ждите выходы." };
  if (pct < 62) return { title: "Неплохие шансы", phrase: "Рабочая обстановка. Правильная точка и насадка сделают рыбалку." };
  if (pct < 80) return { title: "Хороший клёв вероятен", phrase: "Условия складываются удачно — берите запас насадок и не проспите зорьку." };
  return { title: "Отличные условия!", phrase: "Редкое совпадение факторов. Бросайте дела — такой день пропускать нельзя." };
}

function seasonNote(fish, month, lat) {
  const a = seasonActivity(fish, month, lat);
  const names = ["январе","феврале","марте","апреле","мае","июне","июле","августе","сентябре","октябре","ноябре","декабре"];
  if (a >= 0.8) return `пик сезона в ${names[month]}`;
  if (a >= 0.5) return `рабочий месяц для этого вида`;
  if (a >= 0.25) return `в ${names[month]} клёв слабее обычного`;
  return `${names[month]} — не сезон`;
}

/* ---------- Почасовой прогноз активности на ближайшие сутки ---------- */
function hourlyForecast(state, fish, sr, ss) {
  const { weather, lat, lon } = state;
  const out = [];
  const month = weather.current.time.getMonth();
  const season = seasonActivity(fish, month, lat);
  const temp = tempScore(fish, state.waterTemp);
  const moon = moonPhase(weather.current.time).score;

  for (let i = weather.nowIdx; i < Math.min(weather.hours.length, weather.nowIdx + 24); i++) {
    const h = weather.hours[i];
    /* восход/закат соответствующего дня */
    let sunR = sr, sunS = ss;
    for (let d = 0; d < weather.daily.time?.length; d++) {
      if (weather.daily.time[d] === h.time.slice(0, 10)) {
        sunR = weather.daily.sunrise[d]; sunS = weather.daily.sunset[d]; break;
      }
    }
    if (!sunR) { const st = sunTimes(h.date, lat, lon); sunR = st.sunrise; sunS = st.sunset; }

    const periodS = fish.times[dayPeriod(h.date, sunR, sunS)] ?? 0.5;
    const prev = weather.hours[Math.max(0, i - 24)];
    const trendH = { delta: h.pressureMm - prev.pressureMm,
      label: Math.abs(h.pressureMm - prev.pressureMm) < 2 ? "стабильно" :
             h.pressureMm - prev.pressureMm <= -5 ? "резко падает" :
             h.pressureMm - prev.pressureMm < 0 ? "падает" :
             h.pressureMm - prev.pressureMm >= 5 ? "резко растёт" : "растёт" };

    const score =
      0.30 * periodS +
      0.20 * season +
      0.16 * temp +
      0.14 * pressureScore(trendH, h.pressureMm) +
      0.10 * windScore(h.wind, weather.current.windDir, fish) +
      0.06 * skyScore(h.clouds, h.precip, state.waterTemp) +
      0.04 * moon;

    out.push({
      date: h.date,
      hour: h.date.getHours(),
      score: Math.round(score * 100),
      isDawn: sunR && Math.abs(h.date - sunR) < 5400000,
      isDusk: sunS && Math.abs(h.date - sunS) < 5400000,
    });
  }
  return out;
}

/* ---------- Ранжирование насадок ---------- */
export function rankBaits(state) {
  const fish = FISHES[state.fishId];
  const waterT = state.waterTemp ?? 15;
  const cold = waterT < 11, warm = waterT > 18;
  const owned = new Set(state.baitsOwned || []);
  const list = [];

  for (const [id, base] of Object.entries(fish.baits)) {
    const bait = BAITS[id];
    if (!bait) continue;
    let s = base;

    /* Сезонно-температурная поправка по категории */
    if (bait.cat === "animal") s *= cold ? 1.3 : warm ? 0.85 : 1.05;
    if (bait.cat === "plant")  s *= cold ? 0.55 : warm ? 1.18 : 0.95;
    if (bait.cat === "live")   s *= cold ? 1.15 : 1;
    if (bait.cat === "artificial") {
      /* активному хищнику в тёплой воде — быстрее и ярче, в холодной — джиг */
      if (cold && (id === "spinner" || id === "wobbler")) s *= 0.8;
      if (cold && id === "jig") s *= 1.15;
    }

    /* Совместимость со снастью */
    const compat = bait.tackle.includes(state.tackle);
    if (!compat) s *= 0.15;

    /* Имеющиеся у рыбака — лёгкий приоритет при равных */
    if (owned.size && owned.has(id)) s *= 1.12;

    s = Math.min(1, s);
    list.push({
      id, name: bait.name, em: bait.em, cat: bait.cat,
      score: s, owned: owned.has(id), compat,
      why: baitWhy(bait, fish, cold, warm, compat),
    });
  }

  list.sort((a, b) => b.score - a.score);
  return list;
}

function baitWhy(bait, fish, cold, warm, compat) {
  if (!compat) return `рабочая по ${fish.name.toLowerCase()}, но под другую снасть`;
  if (bait.cat === "animal") return cold ? "в холодной воде животная насадка вне конкуренции" : "стабильная классика по этой рыбе";
  if (bait.cat === "plant") return warm ? "тёплая вода — время растительных насадок" : "рабочий вариант, докармливайте точку";
  if (bait.cat === "live") return "естественный корм хищника — максимум доверия";
  return cold ? "в холодной воде — медленная ступенька у дна" : "по активной рыбе — то, что нужно";
}

/* ---------- «Посоветуйте сами»: лучшие виды для условий ---------- */
export function adviseFish(state, candidates) {
  const scored = candidates
    .map(id => ({ id, a: fishActivityNow(id, {
      water: state.water, lat: state.lat, month: state.weather.current.time.getMonth(),
      waterTemp: state.waterTemp, now: state.weather.current.time,
      sunrise: state.weather.daily.sunrise[7] || null, sunset: state.weather.daily.sunset[7] || null,
    })}))
    .filter(x => x.a)
    .sort((a, b) => b.a.score - a.a.score);
  return scored.length ? scored[0].id : null;
}

/* ---------- Тактика ---------- */
export function buildTactics(state, bite) {
  const fish = FISHES[state.fishId];
  const cur = state.weather.current;
  const t = [];
  const fmt = (d) => d ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";

  /* Место */
  const liked = fish.habitat.filter(h => state.features.includes(h));
  const habNames = { reeds: "у стены камыша", lilies: "у кувшинок и окон травы", snags: "возле коряг",
    dropoff: "на бровке у свала в яму", flat: "на ровном поливе", bridge: "у опор и укрытий" };
  let placeTxt;
  if (liked.length) {
    placeTxt = `Вы отметили подходящие ориентиры: ловите ${liked.map(h => habNames[h]).join(" или ")}. `;
  } else {
    placeTxt = `Ищите ${fish.habitat.map(h => habNames[h]).slice(0, 2).join(" или ")}. `;
  }
  const dPref = fish.depth[state.depth] ?? 0.5;
  if (dPref < 0.35) {
    const best = Object.entries(fish.depth).sort((a, b) => b[1] - a[1])[0][0];
    placeTxt += `Выбранная глубина (${DEPTHS[state.depth].short}) — не лучшая для ${fish.name.toLowerCase()}: при возможности сместитесь на ${DEPTHS[best].short.replace("место","")}.`;
  } else {
    placeTxt += `Глубина выбрана удачно.`;
  }
  t.push({ icon: "📍", title: "Точка", text: placeTxt });

  /* Время */
  const top = [...bite.hourly].sort((a, b) => b.score - a.score).slice(0, 3)
    .sort((a, b) => a.date - b.date);
  const windows = top.map(h => `${String(h.hour).padStart(2, "0")}:00`).join(", ");
  t.push({ icon: "⏰", title: "Лучшее время",
    text: `Пики активности в ближайшие сутки: ${windows}. Восход ${fmt(bite.sunrise)}, закат ${fmt(bite.sunset)} — зорьки у ${fish.name.toLowerCase()} ${fish.times.dawn >= 0.8 || fish.times.dusk >= 0.8 ? "обязательны к облову" : "работают слабее, чем у других рыб"}.` });

  /* Прикормка / подача по снасти */
  if (state.tackle === "float" || state.tackle === "feeder") {
    const heavy = state.water === "river_big" || state.water === "canal" || state.water === "river_small";
    t.push({ icon: "🥣", title: "Прикормка",
      text: `Стартовый закорм — ${state.tackle === "feeder" ? "8–10 кормушек в темпе" : "5–6 шаров с горохом и грунтом"}${heavy ? ", смесь тяжёлая и вязкая — течение размывает лёгкую" : ", смесь рассыпчатая, пылящая"}. Докорм каждые 15–20 минут малыми порциями${state.waterTemp != null && state.waterTemp < 11 ? "; в холодной воде корма меньше, ароматики почти ноль" : ""}.` });
  }
  const presentTxt = {
    float: `Спуск выставьте так, чтобы насадка касалась дна или висела в 2–3 см. Перезабрасывайте каждые 5–7 минут, играйте насадкой — лёгкое подтягивание часто провоцирует поклёвку.`,
    feeder: `Заклипсуйтесь по ориентиру и кладите кормушку в одну точку. Перезаброс каждые 5–8 минут, поводок начните с 60 см и удлиняйте при пустых поклёвках.`,
    spinning: state.waterTemp != null && state.waterTemp < 11
      ? `Вода холодная: медленная ступенчатая проводка у дна, паузы до 3–4 секунд. Облавливайте бровки и коряги веером, не задерживаясь на пустом месте дольше 15 минут.`
      : `Рыба активна: начните с равномерной проводки и агрессивного твичинга вдоль травы, затем — ступенька по свалам. Смена приманки каждые 15–20 забросов без контакта.`,
    livebait: `Живца ставьте в полводы у кромки травы или на верхней границе свала. Проверяйте бодрость живца каждые 30–40 минут, поклёвку не форсируйте — дайте размотать.`,
  };
  t.push({ icon: "🎯", title: "Подача", text: presentTxt[state.tackle] });

  /* Погодная поправка */
  let wTxt;
  const warmWater = state.waterTemp != null && state.waterTemp >= 15;
  if (cur.windMs >= 3) {
    wTxt = warmWater
      ? `Ветер ${cur.windMs.toFixed(0)} м/с (${windDirName(cur.windDir)}): волна сносит корм к прибойному берегу — летом бель часто кормится именно там, попробуйте ловить «в ветер», накоротке.`
      : `Ветер ${cur.windMs.toFixed(0)} м/с (${windDirName(cur.windDir)}): в холодной воде ищите затишье — подветренный берег и заливы, там рыбе комфортнее.`;
  } else {
    wTxt = `Почти штиль: вода прозрачнее обычного — тоньше поводки, дальше точка, тише на берегу.`;
  }
  if (bite.trend.label.includes("резко")) {
    wTxt += ` Давление ${bite.trend.label} — клёв может выключаться: ловите выходы, а не ждите равномерного клёва.`;
  }
  t.push({ icon: "🌬", title: "Поправка на погоду", text: wTxt });

  /* Честное предупреждение */
  if (bite.pct < 30) {
    t.push({ icon: "💡", title: "Честный совет",
      text: `Прогноз слабый. Реальнее всего сейчас ${altFishText(state)}. Либо перенесите выезд на ближайший пик из графика выше.` });
  }
  return t;
}

function altFishText(state) {
  const ids = Object.keys(FISHES).filter(id => id !== state.fishId);
  const best = adviseFish(state, ids);
  return best ? `сменить цель на ${FISHES[best].name.toLowerCase()}` : "сменить водоём";
}

/* ---------- Сводка ---------- */
export function buildSummary(state, bite) {
  const fish = FISHES[state.fishId];
  const bait = bite.baits.find(b => b.compat) || bite.baits[0];
  const top = [...bite.hourly].sort((a, b) => b.score - a.score)[0];
  return {
    fish: fish.name,
    water: WATERS[state.water].name,
    bait: bait ? `${bait.em} ${bait.name}` : "—",
    tackle: TACKLE[state.tackle].name,
    bestHour: top ? `${String(top.hour).padStart(2, "0")}:00` : "—",
    pct: bite.pct,
  };
}
