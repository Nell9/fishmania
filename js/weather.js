/* ============================================================
   КлёвГид — метеоданные (Open-Meteo) и модель температуры воды.
   API бесплатный, без ключей: https://open-meteo.com/
   Формат запроса и модель воды описаны в ai/docs/04-api.md
   и ai/docs/05-algorithms.md
   ============================================================ */

import { WATERS } from "./fishdb.js";

const HPA_TO_MM = 0.750062;
const API = "https://api.open-meteo.com/v1/forecast";
const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";

/* fetch с таймаутом */
async function getJSON(url, ms = 14000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/* ---------- Основной запрос погоды ----------
   past_days=7 нужен модели температуры воды (тепловая инерция). */
export async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: "temperature_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m",
    hourly: "temperature_2m,surface_pressure,cloud_cover,precipitation,wind_speed_10m,is_day",
    daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min",
    past_days: "7",
    forecast_days: "2",
    timezone: "auto",
    wind_speed_unit: "ms",
  });
  const d = await getJSON(`${API}?${params}`);

  /* Нормализация почасовых рядов */
  const H = d.hourly;
  const hours = H.time.map((t, i) => ({
    time: t,                                  // локальное время точки, ISO без зоны
    date: new Date(t),
    t: H.temperature_2m[i],
    pressureMm: H.surface_pressure[i] * HPA_TO_MM,
    clouds: H.cloud_cover[i],
    precip: H.precipitation[i],
    wind: H.wind_speed_10m[i],
    isDay: H.is_day ? H.is_day[i] : 1,
  }));

  const nowIso = d.current.time;
  const nowIdx = Math.max(0, H.time.findIndex(t => t >= nowIso));

  return {
    source: "api",
    timezone: d.timezone,
    utcOffsetSec: d.utc_offset_seconds,
    current: {
      time: new Date(d.current.time),
      t: d.current.temperature_2m,
      feels: d.current.apparent_temperature,
      humidity: d.current.relative_humidity_2m,
      isDay: !!d.current.is_day,
      precip: d.current.precipitation,
      code: d.current.weather_code,
      clouds: d.current.cloud_cover,
      pressureMm: d.current.surface_pressure * HPA_TO_MM,
      windMs: d.current.wind_speed_10m,
      windDir: d.current.wind_direction_10m,
      gusts: d.current.wind_gusts_10m,
    },
    hours,
    nowIdx,
    daily: {
      sunrise: d.daily.sunrise.map(t => new Date(t)),
      sunset: d.daily.sunset.map(t => new Date(t)),
      tMax: d.daily.temperature_2m_max,
      tMin: d.daily.temperature_2m_min,
      time: d.daily.time,
    },
  };
}

/* ---------- Обратное геокодирование (название места) ---------- */
export async function reverseGeocode(lat, lon) {
  try {
    const url = `${NOMINATIM}?lat=${lat}&lon=${lon}&format=jsonv2&zoom=12&accept-language=ru`;
    const d = await getJSON(url, 8000);
    const a = d.address || {};
    const parts = [
      a.village || a.hamlet || a.town || a.city || a.municipality,
      a.district || a.county,
      a.state || a.region,
    ].filter(Boolean);
    return parts.slice(0, 2).join(", ") || d.display_name?.split(",").slice(0, 2).join(",") || null;
  } catch { return null; }
}

/* ---------- Модель температуры воды ----------
   Вода — тепловой аккумулятор: следует за воздухом с запаздыванием.
   Экспоненциальное сглаживание почасовой T воздуха с постоянной
   времени tau (сутки) по типу водоёма + поправка на солнце для
   мелких водоёмов + физические ограничители. Это ОЦЕНКА (±2 °C). */
export function estimateWaterTemp(hours, nowIdx, waterType, lat = 55) {
  const w = WATERS[waterType] || WATERS.lake;
  const past = hours.slice(0, nowIdx + 1);
  if (!past.length) return null;

  const alpha = 1 / (w.tau * 24);          // шаг — 1 час
  let ema = past[0].t;
  let cloudSum = 0, cloudN = 0;
  for (const h of past) {
    ema += alpha * (h.t - ema);
    if (h.isDay) { cloudSum += h.clouds; cloudN++; }
  }

  let water = ema;

  /* Солнечный прогрев мелководных водоёмов в светлое полугодие */
  const month = past[past.length - 1].date.getMonth(); // 0..11
  const warmSeason = month >= 3 && month <= 8;
  if (warmSeason) {
    const avgClouds = cloudN ? cloudSum / cloudN : 60;
    const sunBoost = (1 - avgClouds / 100) * 2.2 * (w.sun - 0.94); // макс ~+1.5° для пруда
    water += Math.max(0, sunBoost);
  }

  /* Течение чуть охлаждает летом и сглаживает зимой */
  if (w.flow === 2 && water > 20) water -= 0.6;

  /* Физика: не ниже 0.2 °C; весной вода не теплее воздуха в среднем */
  water = Math.max(0.2, Math.min(water, 30));
  return Math.round(water * 10) / 10;
}

/* Ряд температуры воды по дням (для графика «вода и воздух, 7 дней») */
export function waterTempSeries(hours, nowIdx, waterType) {
  const w = WATERS[waterType] || WATERS.lake;
  const alpha = 1 / (w.tau * 24);
  let ema = hours[0]?.t ?? 10;
  const out = [];
  for (let i = 0; i <= nowIdx; i++) {
    ema += alpha * (hours[i].t - ema);
    out.push({ date: hours[i].date, water: Math.max(0.2, ema), air: hours[i].t });
  }
  return out;
}

/* ---------- Тренд давления за 24 часа ---------- */
export function pressureTrend(hours, nowIdx) {
  const now = hours[nowIdx]?.pressureMm;
  const prev = hours[Math.max(0, nowIdx - 24)]?.pressureMm;
  if (now == null || prev == null) return { delta: 0, label: "стабильно", cls: "good" };
  const delta = now - prev;
  let label, cls;
  if (delta <= -5)      { label = "резко падает";  cls = "bad"; }
  else if (delta <= -2) { label = "падает";        cls = "warn"; }
  else if (delta < 2)   { label = "стабильно";     cls = "good"; }
  else if (delta < 5)   { label = "растёт";        cls = "warn"; }
  else                  { label = "резко растёт";  cls = "bad"; }
  return { delta: Math.round(delta * 10) / 10, label, cls };
}

/* ---------- Словесное описание погоды по WMO-коду ---------- */
const WMO = {
  0: "ясно", 1: "почти ясно", 2: "переменная облачность", 3: "пасмурно",
  45: "туман", 48: "изморозь", 51: "лёгкая морось", 53: "морось", 55: "сильная морось",
  61: "небольшой дождь", 63: "дождь", 65: "сильный дождь", 66: "ледяной дождь", 67: "ледяной дождь",
  71: "небольшой снег", 73: "снег", 75: "сильный снег", 77: "снежные зёрна",
  80: "ливень местами", 81: "ливень", 82: "сильный ливень",
  85: "снегопад", 86: "сильный снегопад", 95: "гроза", 96: "гроза с градом", 99: "гроза с градом",
};
export function weatherWord(code) { return WMO[code] || "—"; }

/* ---------- Ручной режим (без интернета) ---------- */
export function manualWeather({ air, water, pressure, wind, windDir, clouds }, lat, lon) {
  const now = new Date();
  const hours = [];
  for (let i = -48; i <= 24; i++) {
    hours.push({
      time: new Date(now.getTime() + i * 3600000).toISOString(),
      date: new Date(now.getTime() + i * 3600000),
      t: air, pressureMm: pressure, clouds, precip: 0, wind, isDay: 1,
    });
  }
  return {
    source: "manual",
    timezone: "местное",
    utcOffsetSec: -now.getTimezoneOffset() * 60,
    current: {
      time: now, t: air, feels: air, humidity: 60, isDay: true, precip: 0,
      code: clouds > 80 ? 3 : clouds > 40 ? 2 : 0, clouds,
      pressureMm: pressure, windMs: wind, windDir, gusts: wind * 1.5,
    },
    hours, nowIdx: 48,
    daily: { sunrise: [], sunset: [], tMax: [], tMin: [], time: [] },
    manualWater: water,
  };
}
