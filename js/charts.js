/* ============================================================
   КлёвГид — анимированные SVG-графики.
   Линии рисуются через трюк pathLength=1 (dashoffset 1→0),
   бары растут scaleY, числа считаются через rAF.
   ============================================================ */

/* ---------- Утилиты ---------- */
export function animateCount(el, to, ms = 1300, suffix = "") {
  const t0 = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  function tick(t) {
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(to * ease(p)) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function lin(v, d0, d1, r0, r1) { return r0 + (v - d0) / (d1 - d0 || 1) * (r1 - r0); }

function colorFor(pct) {
  if (pct >= 62) return "#4f8a3d";
  if (pct >= 42) return "#8a9a3d";
  if (pct >= 22) return "#c08a2d";
  return "#b34a3c";
}

/* ---------- Большой полукруговой индикатор шанса клёва ---------- */
export function gaugeSVG(pct) {
  const color = colorFor(pct);
  const frac = pct / 100;
  return `
  <svg viewBox="0 0 240 150" style="width:min(320px,100%)" role="img" aria-label="Шанс клёва ${pct}%">
    <defs>
      <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#b34a3c"/><stop offset="45%" stop-color="#c08a2d"/>
        <stop offset="75%" stop-color="#8a9a3d"/><stop offset="100%" stop-color="#4f8a3d"/>
      </linearGradient>
    </defs>
    <path d="M28,132 A92,92 0 0 1 212,132" fill="none" stroke="#edeadf" stroke-width="17" stroke-linecap="round"/>
    <path d="M28,132 A92,92 0 0 1 212,132" fill="none" stroke="url(#gaugeGrad)" stroke-width="17"
      stroke-linecap="round" pathLength="1"
      stroke-dasharray="${frac} 1"
      style="stroke-dashoffset:${frac}; animation: gaugeSweep 1.5s cubic-bezier(.22,.8,.36,1) .15s forwards;"/>
    <style>@keyframes gaugeSweep { to { stroke-dashoffset: 0; } }</style>
    <text class="gauge-num" x="120" y="112" text-anchor="middle" font-size="46" data-gauge-num>0%</text>
    <text x="120" y="134" text-anchor="middle" font-size="11.5" fill="#8f8b7c" font-family="Inter,sans-serif">шанс клёва сейчас</text>
    <circle cx="28" cy="132" r="3.4" fill="#b34a3c"/><circle cx="212" cy="132" r="3.4" fill="#4f8a3d"/>
  </svg>`;
}

/* ---------- Почасовой график активности (24 ч) ---------- */
export function hourlyChartSVG(hourly) {
  const W = 760, H = 210, padL = 34, padB = 30, padT = 26;
  const bw = (W - padL - 14) / hourly.length;
  let bars = "", labels = "", marks = "";

  hourly.forEach((h, i) => {
    const x = padL + i * bw;
    const bh = lin(h.score, 0, 100, 0, H - padB - padT);
    const y = H - padB - bh;
    const good = h.score >= 62;
    const col = colorFor(h.score);
    bars += `<rect class="bar-grow" style="animation-delay:${i * 38}ms"
      x="${x + 2}" y="${y}" width="${bw - 5}" height="${Math.max(2, bh)}" rx="4"
      fill="${col}" opacity="${good ? .95 : .6}"><title>${String(h.hour).padStart(2, "0")}:00 — ${h.score}%</title></rect>`;
    if (h.hour % 3 === 0) labels += `<text class="axis-text" x="${x + bw / 2}" y="${H - 10}" text-anchor="middle">${h.hour}:00</text>`;
    if (h.isDawn) marks += `<text x="${x + bw / 2}" y="${padT - 8}" text-anchor="middle" font-size="13" class="fade-late">🌅</text>`;
    if (h.isDusk) marks += `<text x="${x + bw / 2}" y="${padT - 8}" text-anchor="middle" font-size="13" class="fade-late">🌇</text>`;
  });

  let grid = "";
  for (const v of [25, 50, 75]) {
    const y = H - padB - lin(v, 0, 100, 0, H - padB - padT);
    grid += `<line class="grid-line" x1="${padL}" y1="${y}" x2="${W - 10}" y2="${y}" stroke-dasharray="3 5"/>
      <text class="axis-text" x="${padL - 6}" y="${y + 3.5}" text-anchor="end">${v}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%" role="img">${grid}${bars}${marks}${labels}</svg>`;
}

/* ---------- Линия (общая): ряд значений → svg path ---------- */
function linePath(vals, x0, x1, y0, y1, vMin, vMax) {
  return vals.map((v, i) => {
    const x = lin(i, 0, vals.length - 1, x0, x1);
    const y = lin(v, vMin, vMax, y0, y1);
    return (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
}

/* ---------- Давление за 48 ч + прогноз ---------- */
export function pressureChartSVG(hours, nowIdx) {
  const from = Math.max(0, nowIdx - 48), to = Math.min(hours.length - 1, nowIdx + 24);
  const vals = hours.slice(from, to + 1).map(h => h.pressureMm);
  const W = 360, H = 150, padL = 38, padR = 8, padT = 14, padB = 24;
  let vMin = Math.min(...vals), vMax = Math.max(...vals);
  if (vMax - vMin < 4) { vMin -= 2; vMax += 2; }

  const d = linePath(vals, padL, W - padR, H - padB, padT, vMin, vMax);
  const nowX = lin(nowIdx - from, 0, vals.length - 1, padL, W - padR);

  let grid = "";
  for (let i = 0; i <= 2; i++) {
    const v = vMin + (vMax - vMin) * i / 2;
    const y = lin(v, vMin, vMax, H - padB, padT);
    grid += `<line class="grid-line" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke-dasharray="3 5"/>
      <text class="axis-text" x="${padL - 5}" y="${y + 3.5}" text-anchor="end">${Math.round(v)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%" role="img">
    ${grid}
    <line x1="${nowX}" y1="${padT}" x2="${nowX}" y2="${H - padB}" stroke="#d97757" stroke-width="1.4" stroke-dasharray="4 4"/>
    <text class="axis-text" x="${nowX}" y="${H - 8}" text-anchor="middle" fill="#bb5d3f">сейчас</text>
    <path class="chart-line draw-line" d="${d}" stroke="#2e7d9a" pathLength="1" style="--len:1"/>
    <text class="axis-text" x="${padL}" y="${H - 8}">−48 ч</text>
    <text class="axis-text" x="${W - padR}" y="${H - 8}" text-anchor="end">+24 ч</text>
  </svg>`;
}

/* ---------- Воздух и вода, 7 дней ---------- */
export function tempChartSVG(series) {
  /* прореживаем до ~раз в 3 часа */
  const pts = series.filter((_, i) => i % 3 === 0);
  const air = pts.map(p => p.air), water = pts.map(p => p.water);
  const W = 360, H = 150, padL = 30, padR = 8, padT = 14, padB = 24;
  let vMin = Math.min(...air, ...water) - 1, vMax = Math.max(...air, ...water) + 1;

  const dAir = linePath(air, padL, W - padR, H - padB, padT, vMin, vMax);
  const dWater = linePath(water, padL, W - padR, H - padB, padT, vMin, vMax);

  let grid = "";
  for (let i = 0; i <= 2; i++) {
    const v = vMin + (vMax - vMin) * i / 2;
    const y = lin(v, vMin, vMax, H - padB, padT);
    grid += `<line class="grid-line" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke-dasharray="3 5"/>
      <text class="axis-text" x="${padL - 5}" y="${y + 3.5}" text-anchor="end">${Math.round(v)}°</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%" role="img">
    ${grid}
    <path class="chart-line draw-line" d="${dAir}" stroke="#c08a2d" stroke-width="2" pathLength="1" style="--len:1; opacity:.75"/>
    <path class="chart-line draw-line" d="${dWater}" stroke="#2e7d9a" pathLength="1" style="--len:1; animation-delay:.3s"/>
    <g class="fade-late" font-family="Inter,sans-serif" font-size="10.5">
      <circle cx="${padL + 8}" cy="${padT + 2}" r="4" fill="#c08a2d"/><text x="${padL + 16}" y="${padT + 6}" fill="#5c594f">воздух</text>
      <circle cx="${padL + 70}" cy="${padT + 2}" r="4" fill="#2e7d9a"/><text x="${padL + 78}" y="${padT + 6}" fill="#5c594f">вода (модель)</text>
    </g>
    <text class="axis-text" x="${padL}" y="${H - 8}">неделя назад</text>
    <text class="axis-text" x="${W - padR}" y="${H - 8}" text-anchor="end">сегодня</text>
  </svg>`;
}

/* ---------- Компас ветра ---------- */
export function windCompassSVG(deg, speed) {
  /* стрелка показывает, КУДА дует ветер */
  const to = (deg + 180) % 360;
  let ticks = "";
  for (let a = 0; a < 360; a += 45) {
    const r1 = a % 90 === 0 ? 30 : 33, rad = (a - 90) * Math.PI / 180;
    ticks += `<line x1="${40 + Math.cos(rad) * r1}" y1="${40 + Math.sin(rad) * r1}"
      x2="${40 + Math.cos(rad) * 36}" y2="${40 + Math.sin(rad) * 36}" stroke="#c9c5b4" stroke-width="2"/>`;
  }
  const L = [["С", 40, 13], ["В", 68, 44], ["Ю", 40, 73], ["З", 12, 44]];
  return `<svg viewBox="0 0 80 80" style="width:74px;height:74px" role="img" aria-label="Ветер ${speed} м/с">
    <circle cx="40" cy="40" r="36" fill="#fcfbf8" stroke="#e7e4d8" stroke-width="2"/>${ticks}
    ${L.map(([t, x, y]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="9" font-weight="700" fill="#8f8b7c" font-family="Inter,sans-serif">${t}</text>`).join("")}
    <g class="compass-needle" data-wind-needle style="transform:rotate(${to}deg)">
      <path d="M40,16 L46,46 L40,40 L34,46 Z" fill="#d97757"/>
    </g>
    <circle cx="40" cy="40" r="4" fill="#21201c"/>
  </svg>`;
}

/* ---------- Фаза Луны ---------- */
export function moonSVG(frac) {
  /* terminator: ширина эллипса = cos(2π·frac); правая сторона светится на росте */
  const r = 26, cx = 32, cy = 32;
  const cosw = Math.cos(2 * Math.PI * frac);
  const rx = Math.abs(cosw) * r;
  const waxing = frac < 0.5;
  const light = "#f5edd8", dark = "#3d4351";

  /* Полный диск тёмный, поверх — освещённая часть */
  const big = `A ${r},${r} 0 1,${waxing ? 1 : 0} ${cx},${cy + r}`;
  const inner = `A ${rx},${r} 0 1,${(waxing ? cosw > 0 : cosw < 0) ? 0 : 1} ${cx},${cy - r}`;
  return `<svg viewBox="0 0 64 64" style="width:58px;height:58px" role="img">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${dark}"/>
    <path d="M ${cx},${cy - r} ${big} ${inner} Z" fill="${light}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#d8d4c4" stroke-width="1.5"/>
    <circle cx="${cx - 8}" cy="${cy - 6}" r="2.6" fill="rgba(0,0,0,.08)"/>
    <circle cx="${cx + 6}" cy="${cy + 8}" r="3.4" fill="rgba(0,0,0,.07)"/>
  </svg>`;
}

/* ---------- Силуэты рыб ---------- */
const FISH_SHAPES = {
  carp: `M8,32 C16,16 38,10 58,14 C70,8 76,6 82,8 C80,13 78,17 78,20 C84,24 88,28 88,32 C88,36 84,40 78,44 C78,47 80,51 82,56 C76,58 70,56 58,50 C38,54 16,48 8,32 Z
         M58,14 C54,22 54,42 58,50`,
  bream: `M14,32 C20,10 40,4 52,10 C60,4 64,3 68,4 C67,8 66,12 66,15 C74,20 80,26 80,32 C80,38 74,44 66,49 C66,52 67,56 68,60 C64,61 60,60 52,54 C40,60 20,54 14,32 Z`,
  roach: `M10,32 C18,20 36,14 54,17 C64,12 70,10 76,11 C74,15 73,19 73,22 C79,25 83,28 83,32 C83,36 79,39 73,42 C73,45 74,49 76,53 C70,54 64,52 54,47 C36,50 18,44 10,32 Z`,
  pike: `M4,32 C10,26 30,22 52,23 C64,20 74,16 84,12 C82,18 81,24 82,28 C86,29 88,30 88,32 C88,34 86,35 82,36 C81,40 82,46 84,52 C74,48 64,44 52,41 C30,42 10,38 4,32 Z`,
  perch: `M10,34 C16,18 34,10 52,14 C60,8 66,6 72,7 C71,11 70,15 70,18 C76,22 80,27 80,32 C80,37 76,42 70,46 C70,49 71,53 72,57 C66,58 60,56 52,50 C34,54 16,48 10,34 Z
          M38,14 L40,50 M50,13 L52,50 M62,16 L63,47`,
  catfish: `M6,30 C14,18 30,14 48,18 C62,14 76,16 86,24 C88,28 88,34 86,38 C76,46 62,48 48,44 C30,48 14,44 6,30 Z
            M14,24 L2,14 M14,36 L2,46 M20,22 L16,12`,
  asp: `M8,32 C16,22 36,18 56,20 C66,14 72,12 78,13 C76,17 75,21 75,24 C81,27 85,30 85,32 C85,34 81,37 75,40 C75,43 76,47 78,51 C72,52 66,50 56,44 C36,46 16,42 8,32 Z`,
  burbot: `M6,32 C12,24 26,20 44,22 C60,18 74,20 84,26 C87,29 87,35 84,38 C74,44 60,46 44,42 C26,44 12,40 6,32 Z
           M16,26 L12,18 M22,38 L20,46`,
};

export function fishSVG(shape, hue) {
  const d = FISH_SHAPES[shape] || FISH_SHAPES.roach;
  const paths = d.split("M").filter(Boolean);
  const body = "M" + paths[0];
  const extra = paths.slice(1).map(p => `<path d="M${p}" stroke="rgba(0,0,0,.25)" stroke-width="1.6" fill="none"/>`).join("");
  return `<svg viewBox="0 0 96 64" role="img">
    <path d="${body}" fill="${hue}" opacity=".9"/>
    <path d="${body}" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="1.4"/>
    ${extra}
    <circle cx="22" cy="29" r="2.6" fill="#fff"/><circle cx="22.7" cy="29" r="1.3" fill="#21201c"/>
  </svg>`;
}

/* ---------- Иконки водоёмов ---------- */
const WATER_ICONS = {
  pond: `<ellipse cx="27" cy="32" rx="20" ry="13" fill="#7db4c9"/><ellipse cx="27" cy="32" rx="20" ry="13" fill="none" stroke="#2e6f8c" stroke-width="2"/>
    <path d="M40,22 q3,-8 1,-12 M44,24 q4,-6 3,-10" stroke="#5d7a3a" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  lake: `<path d="M8,32 C8,20 20,14 30,16 C42,12 48,22 46,30 C50,38 38,46 26,44 C14,46 8,40 8,32 Z" fill="#7db4c9" stroke="#2e6f8c" stroke-width="2"/>
    <path d="M16,30 q4,-2 8,0 M28,34 q4,-2 8,0" stroke="#fff" stroke-width="1.6" fill="none" opacity=".7"/>`,
  riverS: `<path d="M6,44 C14,36 12,28 20,22 C28,16 30,12 34,6 L44,10 C38,18 36,22 30,28 C24,34 26,40 16,48 Z" fill="#7db4c9" stroke="#2e6f8c" stroke-width="2"/>
    <circle cx="22" cy="30" r="2" fill="#cfd8d2"/><circle cx="28" cy="22" r="1.7" fill="#cfd8d2"/>`,
  riverB: `<path d="M4,40 C16,34 22,34 32,26 C40,20 44,16 50,12 L50,24 C42,28 38,32 30,38 C22,44 14,46 4,50 Z" fill="#7db4c9" stroke="#2e6f8c" stroke-width="2"/>
    <path d="M14,40 l8,-4 M26,32 l8,-5" stroke="#fff" stroke-width="1.8" opacity=".7"/>`,
  oxbow: `<path d="M12,12 C30,8 46,18 44,32 C42,44 30,48 22,46 C28,42 36,40 37,31 C38,20 26,14 12,18 Z" fill="#7db4c9" stroke="#2e6f8c" stroke-width="2"/>
    <path d="M14,24 q3,-6 1,-10" stroke="#5d7a3a" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  reservoir: `<path d="M8,26 C18,18 36,18 48,24 L48,40 L8,40 Z" fill="#7db4c9" stroke="#2e6f8c" stroke-width="2"/>
    <rect x="44" y="14" width="6" height="28" rx="2" fill="#c9c2b2" stroke="#a89f8a" stroke-width="1.6"/>`,
  canal: `<path d="M18,6 L38,6 L34,48 L22,48 Z" fill="#7db4c9" stroke="#2e6f8c" stroke-width="2"/>
    <path d="M24,14 h8 M23,26 h9 M23,38 h9" stroke="#fff" stroke-width="1.6" opacity=".7"/>`,
};
export function waterIconSVG(key) {
  return `<svg class="tile-icon" viewBox="0 0 56 56">${WATER_ICONS[key] || WATER_ICONS.lake}</svg>`;
}
