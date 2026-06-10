/* ============================================================
   КлёвГид — астрономия: фаза Луны, восход/закат (фолбэк-расчёт).
   Алгоритмы описаны в ai/docs/05-algorithms.md
   ============================================================ */

const SYNODIC = 29.530588853;            // синодический месяц, сут
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14); // эталонное новолуние

/* Фаза Луны: frac 0..1 (0 — новолуние, 0.5 — полнолуние) */
export function moonPhase(date = new Date()) {
  const days = (date.getTime() - NEW_MOON_EPOCH) / 86400000;
  const frac = ((days % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;
  const illum = (1 - Math.cos(2 * Math.PI * frac)) / 2; // освещённость 0..1
  const waxing = frac < 0.5;

  let name, em;
  if (frac < 0.033 || frac > 0.967) { name = "Новолуние"; em = "🌑"; }
  else if (frac < 0.217) { name = "Растущий серп"; em = "🌒"; }
  else if (frac < 0.283) { name = "Первая четверть"; em = "🌓"; }
  else if (frac < 0.467) { name = "Растущая Луна"; em = "🌔"; }
  else if (frac < 0.533) { name = "Полнолуние"; em = "🌕"; }
  else if (frac < 0.717) { name = "Убывающая Луна"; em = "🌖"; }
  else if (frac < 0.783) { name = "Последняя четверть"; em = "🌗"; }
  else { name = "Старый серп"; em = "🌘"; }

  /* Влияние на клёв (мягкий фактор, 0..1):
     полнолуние — спад, новолуние — лёгкий спад, растущая — лучшее время */
  let score;
  if (frac < 0.033 || frac > 0.967) score = 0.88;
  else if (frac < 0.467) score = 0.92 + 0.08 * Math.sin(Math.PI * (frac - 0.03) / 0.44); // растущая
  else if (frac < 0.533) score = 0.82;                                                    // полнолуние
  else score = 0.9;                                                                       // убывающая

  return { frac, illum, waxing, name, em, score };
}

/* ---- Восход/закат: упрощённый расчёт NOAA (фолбэк, когда нет API) ----
   Возвращает Date в локальном времени браузера. Точность ±5 мин. */
export function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  const dayMs = 86400000;
  const J2000 = 2451545;
  const jd = date.getTime() / dayMs + 2440587.5;           // юлианская дата
  const n = Math.round(jd - J2000 - 0.0009 + lon / 360);
  const Jstar = J2000 + 0.0009 - lon / 360 + n;            // средний солнечный полдень (вост. долгота — раньше по UTC)
  const M = (357.5291 + 0.98560028 * (Jstar - J2000)) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;                // эклиптическая долгота
  const Jtransit = Jstar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const delta = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad)); // склонение
  const cosH = (Math.sin(-0.83 * rad) - Math.sin(lat * rad) * Math.sin(delta)) /
               (Math.cos(lat * rad) * Math.cos(delta));
  if (cosH > 1 || cosH < -1) return { sunrise: null, sunset: null, polar: cosH < -1 ? "day" : "night" };
  const H = Math.acos(cosH) / rad;
  const Jset = Jtransit + H / 360;
  const Jrise = Jtransit - H / 360;
  const toDate = (J) => new Date((J - 2440587.5) * dayMs);
  return { sunrise: toDate(Jrise), sunset: toDate(Jset), polar: null };
}

/* Тип времени суток относительно восхода/заката */
export function dayPeriod(date, sunrise, sunset) {
  if (!sunrise || !sunset) return "day";
  const t = date.getTime(), r = sunrise.getTime(), s = sunset.getTime();
  const hour = 3600000;
  if (t >= r - 1.2 * hour && t <= r + 1.8 * hour) return "dawn";   // зорька утренняя
  if (t >= s - 1.8 * hour && t <= s + 1.2 * hour) return "dusk";   // зорька вечерняя
  if (t > r && t < s) return "day";
  return "night";
}

export const PERIOD_NAMES = { dawn: "утренняя зорька", day: "день", dusk: "вечерняя зорька", night: "ночь" };
