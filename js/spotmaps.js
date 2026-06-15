/* ============================================================
   КлёвГид — схематичные карты точек ловли (SVG, вид сверху).
   Камыш, кувшинки, коряги, бровки, течение, рыболов и точка
   заброса ✕ с пульсацией. Подбор схем — по типу водоёма,
   повадкам рыбы и отмеченным ориентирам.
   ============================================================ */

import { FISHES } from "./fishdb.js";

/* ---------- Палитра воды и берега ---------- */
const C = {
  shallow: "#a9cfdd", mid: "#7db4c9", deep: "#4a90ad", deepest: "#2e6f8c",
  sand: "#e9dcb4", grass: "#b9cb90", grass2: "#a3bd7c",
  reed: "#5d7a3a", reedHead: "#8a6a3d", lily: "#5f9d5f", lilyFlower: "#f3e9ef",
  snag: "#7a5b3e", ink: "#1d3d4d", cast: "#e8553d", label: "#10455c",
};

/* ---------- Базовые элементы ---------- */

function defsBlock(id) {
  return `<defs>
    <linearGradient id="wg${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.deepest}"/><stop offset="45%" stop-color="${C.deep}"/>
      <stop offset="78%" stop-color="${C.mid}"/><stop offset="100%" stop-color="${C.shallow}"/>
    </linearGradient>
    <linearGradient id="wgr${id}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.shallow}"/><stop offset="35%" stop-color="${C.mid}"/>
      <stop offset="70%" stop-color="${C.deep}"/><stop offset="100%" stop-color="${C.deepest}"/>
    </linearGradient>
  </defs>`;
}

/* Камышовый куст из нескольких стеблей (классы sway — покачивание) */
function reeds(x, y, n = 5, s = 1, swayClass = "sway") {
  let out = `<g transform="translate(${x},${y}) scale(${s})">`;
  const dx = [-8, -3, 2, 7, 12, -12, 16];
  for (let i = 0; i < n; i++) {
    const h = 26 + (i * 7) % 12;
    out += `<g class="${swayClass}${i % 3 ? " s" + ((i % 3) + 1) : ""}">
      <path d="M${dx[i]},0 q${i % 2 ? 3 : -3},-${h * 0.6} ${i % 2 ? 1 : -1},-${h}" stroke="${C.reed}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <ellipse cx="${dx[i] + (i % 2 ? 1 : -1)}" cy="${-h - 3}" rx="2.6" ry="7" fill="${C.reedHead}"/>
    </g>`;
  }
  return out + "</g>";
}

/* Кувшинки */
function lilies(x, y, n = 6, spread = 30) {
  let out = `<g transform="translate(${x},${y})" class="fish-bob">`;
  const px = [0, 14, -16, 26, -28, 8, -6, 22], py = [0, 7, 5, -4, -8, -12, 12, 10];
  for (let i = 0; i < n; i++) {
    const lx = px[i] * spread / 30, ly = py[i] * spread / 30;
    out += `<ellipse cx="${lx}" cy="${ly}" rx="8.5" ry="4.6" fill="${C.lily}" opacity=".92"/>
      <path d="M${lx},${ly} l7,-2.6" stroke="${C.shallow}" stroke-width="1.6"/>`;
    if (i % 3 === 0) out += `<circle cx="${lx - 3}" cy="${ly - 2}" r="2" fill="${C.lilyFlower}"/>`;
  }
  return out + "</g>";
}

/* Коряги */
function snags(x, y, s = 1) {
  return `<g transform="translate(${x},${y}) scale(${s})" stroke="${C.snag}" stroke-width="3" stroke-linecap="round" fill="none" opacity=".85">
    <path d="M-20,6 L8,-4 M-4,0 L2,-14 M8,-4 L26,2 M14,-1 L20,-12"/>
    <path d="M-14,16 L18,13 M0,14 L-6,4" stroke-width="2.4" opacity=".7"/>
  </g>`;
}

/* Стрелки течения */
function flow(x1, x2, y, n = 3, gap = 16, color = "rgba(255,255,255,.5)") {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += `<line class="flow-dash" x1="${x1}" y1="${y + i * gap}" x2="${x2}" y2="${y + i * gap}" stroke="${color}" stroke-width="2"/>
    <path d="M${x2},${y + i * gap} l-7,-3.4 v6.8 z" fill="${color}"/>`;
  }
  return out;
}

/* Рябь на воде */
function ripples(x, y) {
  return `<g class="ripple-drift" stroke="rgba(255,255,255,.4)" stroke-width="1.4" fill="none" stroke-linecap="round">
    <path d="M${x},${y} q6,-3 12,0 t12,0"/><path d="M${x + 40},${y + 14} q6,-3 12,0 t12,0"/>
    <path d="M${x - 24},${y + 22} q6,-3 12,0 t12,0"/></g>`;
}

/* Рыболов на берегу */
function angler(x, y, flip = 1) {
  return `<g transform="translate(${x},${y}) scale(${flip},1)">
    <circle cx="0" cy="-13" r="4.2" fill="${C.ink}"/>
    <path d="M0,-9 L0,2 M0,-6 L8,-10 M0,2 L-4,10 M0,2 L5,9" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <path d="M8,-10 L30,-26" stroke="#6b4f2f" stroke-width="2" stroke-linecap="round"/>
  </g>`;
}

/* Точка заброса: пульсирующий ✕ */
function castPoint(x, y, label = "") {
  return `<g>
    <circle class="cast-pulse" cx="${x}" cy="${y}" r="13" fill="none" stroke="${C.cast}" stroke-width="2.5"/>
    <circle class="cast-pulse" cx="${x}" cy="${y}" r="13" fill="none" stroke="${C.cast}" stroke-width="2" style="animation-delay:1s"/>
    <path d="M${x - 7},${y - 7} L${x + 7},${y + 7} M${x + 7},${y - 7} L${x - 7},${y + 7}" stroke="${C.cast}" stroke-width="4.4" stroke-linecap="round"/>
    ${label ? `<rect x="${x - 34}" y="${y + 13}" width="68" height="16" rx="8" fill="rgba(16,69,92,.85)"/>
    <text x="${x}" y="${y + 24.5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fff" font-family="Inter,sans-serif">${label}</text>` : ""}
  </g>`;
}

/* Траектория заброса */
function castArc(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - 26;
  return `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" fill="none" stroke="rgba(232,85,61,.55)" stroke-width="1.8" stroke-dasharray="5 6"/>`;
}

/* Подпись глубины */
function depthLabel(x, y, txt, light = true) {
  return `<text x="${x}" y="${y}" font-size="10" font-style="italic" fill="${light ? "rgba(255,255,255,.85)" : C.label}" font-family="Lora,serif">${txt}</text>`;
}

/* Берег снизу */
function shoreBottom(withGrass = true) {
  return `<path d="M0,206 Q90,198 180,206 T360,204 L360,250 L0,250 Z" fill="${C.sand}"/>
  ${withGrass ? `<path d="M0,206 Q90,198 180,206 T360,204 L360,214 Q270,208 180,214 T0,216 Z" fill="${C.grass}" opacity=".9"/>` : ""}`;
}

/* Масштабная линейка */
function scaleBar(metersPer100px = 12) {
  return `<g transform="translate(12,238)">
    <line x1="0" y1="0" x2="50" y2="0" stroke="${C.ink}" stroke-width="2"/>
    <line x1="0" y1="-3" x2="0" y2="3" stroke="${C.ink}" stroke-width="2"/>
    <line x1="50" y1="-3" x2="50" y2="3" stroke="${C.ink}" stroke-width="2"/>
    <text x="56" y="3.4" font-size="9" fill="${C.ink}" font-family="Inter,sans-serif">≈ ${Math.round(metersPer100px / 2)} м</text>
  </g>`;
}

function wrap(id, inner) {
  return `<svg viewBox="0 0 360 250" xmlns="http://www.w3.org/2000/svg" role="img">${defsBlock(id)}${inner}</svg>`;
}

/* ---------- Профиль глубины (вид сбоку) ---------- */
function profileSVG(kind) {
  const bottoms = {
    dropoff: "M0,34 L60,36 Q110,38 150,52 Q175,62 195,74 L240,80 Q300,84 360,84",
    pit:     "M0,36 L80,40 Q140,44 170,62 Q200,82 250,84 Q310,86 360,80",
    shelf:   "M0,34 L90,36 Q140,38 170,48 L230,52 Q260,56 290,70 L360,74",
  };
  const d = bottoms[kind] || bottoms.dropoff;
  return `<svg viewBox="0 0 360 100" xmlns="http://www.w3.org/2000/svg" style="margin-top:10px;border-radius:10px;background:linear-gradient(#cfe4ec,#9cc4d4)">
    <path d="M0,16 q20,-4 40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0" stroke="rgba(255,255,255,.7)" stroke-width="2" fill="none" class="ripple-drift"/>
    <path d="${d} L360,100 L0,100 Z" fill="#8a6f4d"/>
    <path d="${d}" stroke="#6b5538" stroke-width="2.5" fill="none"/>
    <circle cx="196" cy="72" r="5" fill="${C.cast}"/>
    <circle cx="196" cy="72" r="9" fill="none" stroke="${C.cast}" stroke-width="1.6" class="cast-pulse"/>
    <text x="196" y="60" text-anchor="middle" font-size="9.5" font-weight="700" fill="#0e3a4e" font-family="Inter,sans-serif">оснастка здесь</text>
    <text x="14" y="30" font-size="9" font-style="italic" fill="#0e3a4e" font-family="Lora,serif">берег</text>
    <text x="318" y="78" font-size="9" font-style="italic" fill="#fff" font-family="Lora,serif">яма</text>
    <text x="150" y="44" font-size="9" font-style="italic" fill="#fff" font-family="Lora,serif">свал</text>
  </svg>`;
}

/* ============================================================
   ШАБЛОНЫ ТОЧЕК
   ============================================================ */

const TEMPLATES = {
  /* --- Кромка камыша --- */
  reeds_edge: {
    tags: ["reeds"], waters: ["pond", "lake", "oxbow", "reservoir", "river_small"],
    title: "Кромка камыша",
    desc: (f, d) => `Рыба патрулирует границу зарослей. Забрасывайте вдоль стены камыша в ${d}, насадка — у самого края, но не в гущу: иначе не вытащить.`,
    meta: (dist) => [`заброс ${dist}`, "глубина 1–2 м", "тихая подача"],
    profile: null,
    svg(id, dist) {
      return wrap(id, `
        <rect width="360" height="250" fill="url(#wg${id})"/>
        ${depthLabel(150, 36, "3 м и глубже")} ${depthLabel(165, 120, "1,5–2 м")}
        ${ripples(120, 60)} ${ripples(230, 96)}
        ${shoreBottom()}
        ${reeds(38, 200, 6, 1.15)} ${reeds(86, 196, 5, 1)} ${reeds(128, 199, 6, 1.05)}
        ${reeds(300, 198, 6, 1.1)} ${reeds(338, 202, 4, .95)}
        ${snags(330, 120, .8)}
        ${castArc(208, 196, 168, 158)}
        ${castPoint(168, 158, dist)}
        ${depthLabel(40, 168, "стена камыша", true)}
        ${angler(212, 196)}
        ${scaleBar()}
      `);
    },
  },

  /* --- Окно в кувшинках --- */
  lily_window: {
    tags: ["lilies"], waters: ["oxbow", "pond", "lake"],
    title: "Окно среди кувшинок",
    desc: (f) => `Классика по ${f}: чистое «окно» в траве. Опускайте насадку точно в просвет, поклёвка обычно сразу. Вываживание форсированное, не давайте уйти в траву.`,
    meta: (dist) => [`заброс ${dist}`, "глубина до 1,5 м", "зорьки"],
    profile: null,
    svg(id, dist) {
      return wrap(id, `
        <rect width="360" height="250" fill="url(#wg${id})"/>
        ${depthLabel(20, 30, "2,5 м")} ${depthLabel(30, 120, "1–1,5 м")}
        ${ripples(60, 56)}
        ${lilies(120, 120, 8, 36)} ${lilies(238, 100, 7, 32)} ${lilies(70, 160, 6, 26)}
        ${lilies(296, 158, 6, 28)} ${lilies(180, 176, 5, 22)}
        ${shoreBottom()}
        ${reeds(330, 200, 5, 1)}
        ${castArc(150, 198, 178, 138)}
        ${castPoint(178, 138, dist)}
        ${depthLabel(160, 116, "окно", true)}
        ${angler(146, 198, -1)}
        ${scaleBar()}
      `);
    },
  },

  /* --- Бровка / свал --- */
  dropoff: {
    tags: ["dropoff", "flat"], waters: ["reservoir", "lake", "river_big", "canal", "pond"],
    title: "Бровка — свал в глубину",
    desc: (f) => `Подводная «ступенька» — столовая ${f}: корм скатывается по свалу и задерживается у его основания. Точка — нижняя кромка бровки.`,
    meta: (dist) => [`заброс ${dist}`, "свал 2 → 4 м", "прикормка обязательна"],
    profile: "dropoff",
    svg(id, dist) {
      return wrap(id, `
        <rect width="360" height="250" fill="url(#wg${id})"/>
        <path d="M0,96 Q120,82 220,96 T360,88" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-dasharray="7 6"/>
        <path d="M0,148 Q130,136 230,148 T360,142" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.6" stroke-dasharray="5 6"/>
        ${depthLabel(18, 40, "4–5 м")} ${depthLabel(22, 126, "2–3 м")} ${depthLabel(26, 182, "до 1,5 м")}
        ${depthLabel(258, 90, "верх бровки", true)}
        ${ripples(150, 50)}
        ${shoreBottom()}
        ${reeds(40, 200, 5, 1)}
        ${castArc(192, 198, 218, 110)}
        ${castPoint(218, 110, dist)}
        ${angler(188, 198, -1)}
        ${scaleBar(20)}
      `);
    },
  },

  /* --- Коряжник --- */
  snag_field: {
    tags: ["snags"], waters: ["oxbow", "river_small", "river_big", "pond", "reservoir", "lake"],
    title: "У коряжника",
    desc: (f) => `Коряги — дом для ${f}. Ловите по кромке завала: насадка в 2–3 м от веток. Поводки ставьте прочнее, зацепы здесь — плата за поклёвки.`,
    meta: (dist) => [`заброс ${dist}`, "у кромки коряг", "прочная оснастка"],
    profile: null,
    svg(id, dist) {
      return wrap(id, `
        <rect width="360" height="250" fill="url(#wg${id})"/>
        ${depthLabel(20, 34, "3–4 м")} ${depthLabel(26, 140, "2 м")}
        ${snags(96, 86, 1.25)} ${snags(150, 64, 1)} ${snags(196, 96, 1.15)} ${snags(126, 116, .9)}
        <ellipse cx="150" cy="92" rx="86" ry="48" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.6" stroke-dasharray="4 6"/>
        ${depthLabel(108, 152, "кромка завала", true)}
        ${ripples(268, 70)}
        ${shoreBottom()}
        ${reeds(320, 200, 6, 1.05)}
        ${castArc(232, 198, 236, 130)}
        ${castPoint(236, 130, dist)}
        ${angler(228, 198)}
        ${scaleBar()}
      `);
    },
  },

  /* --- Речной поворот с омутом --- */
  river_bend: {
    tags: ["dropoff", "snags"], waters: ["river_small", "river_big"],
    title: "Поворот реки — омут",
    desc: (f) => `На повороте струя бьёт во внешний берег и роет яму. ${f[0].toUpperCase() + f.slice(1)} стоит на границе течения и тиховодья — туда и подавайте.`,
    meta: (dist) => [`заброс ${dist}`, "внешний берег глубже", "граница струи"],
    profile: "pit",
    svg(id, dist) {
      return wrap(id, `
        <rect width="360" height="250" fill="${C.grass2}"/>
        <path d="M0,250 L0,120 Q60,40 180,44 Q300,48 360,16 L360,140 Q290,170 200,160 Q90,150 70,250 Z" fill="url(#wgr${id})"/>
        <path d="M0,120 Q60,40 180,44 Q300,48 360,16" fill="none" stroke="${C.grass}" stroke-width="5"/>
        <path d="M0,250 L70,250 Q90,150 200,160 Q290,170 360,140 L360,250 Z" fill="${C.sand}"/>
        ${flow(60, 150, 86, 3, 18)} ${flow(190, 290, 96, 2, 18)}
        ${depthLabel(236, 64, "яма 4 м", true)} ${depthLabel(96, 130, "1,5 м", true)}
        <path d="M150,118 Q230,132 312,112" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="2" stroke-dasharray="6 6"/>
        ${depthLabel(168, 110, "граница струи", true)}
        ${snags(322, 70, .9)}
        ${castArc(190, 186, 238, 124)}
        ${castPoint(238, 124, dist)}
        ${angler(186, 186, -1)}
        ${scaleBar(18)}
      `);
    },
  },

  /* --- Перекат и яма за ним --- */
  riffle_pool: {
    tags: ["flat"], waters: ["river_small"],
    title: "Перекат → яма за ним",
    desc: (f) => `Перекат — кормовой конвейер: всё, что смывает струя, ждут внизу. Подача — на сбое струи сразу за перекатом, проводка естественная.`,
    meta: (dist) => [`заброс ${dist}`, "за сливом переката", "сплав по струе"],
    profile: "shelf",
    svg(id, dist) {
      return wrap(id, `
        <rect width="360" height="250" fill="${C.grass2}"/>
        <rect x="0" y="56" width="360" height="120" fill="url(#wgr${id})"/>
        <path d="M0,56 H360 M0,176 H360" stroke="${C.grass}" stroke-width="5"/>
        <g fill="#cfd8d2">
          <circle cx="96" cy="92" r="7"/><circle cx="112" cy="124" r="9"/><circle cx="88" cy="148" r="6"/>
          <circle cx="128" cy="100" r="5"/><circle cx="120" cy="146" r="7"/>
        </g>
        ${flow(20, 70, 90, 3, 22, "rgba(255,255,255,.65)")}
        <path d="M134,80 q10,8 0,16 q-10,8 0,16 q10,8 0,16" stroke="rgba(255,255,255,.8)" stroke-width="2.4" fill="none" class="flow-dash"/>
        ${depthLabel(84, 78, "перекат 0,5 м", true)} ${depthLabel(230, 90, "яма 2–3 м", true)}
        <ellipse cx="246" cy="120" rx="60" ry="36" fill="${C.deepest}" opacity=".55"/>
        ${castArc(196, 196, 216, 118)}
        ${castPoint(216, 118, dist)}
        ${angler(192, 196, -1)}
        ${shoreBottom(false)}
        ${scaleBar(14)}
      `);
    },
  },

  /* --- Канал: бровки двух берегов --- */
  canal_edge: {
    tags: ["dropoff", "flat"], waters: ["canal"],
    title: "Бровка канала",
    desc: (f) => `У каналов трапециевидное дно: две бровки вдоль берегов. Рабочая точка — основание ближней или дальней бровки, где оседает корм с течения.`,
    meta: (dist) => [`заброс ${dist}`, "основание бровки", "держите точку"],
    profile: "shelf",
    svg(id, dist) {
      return wrap(id, `
        <rect width="360" height="250" fill="url(#wg${id})"/>
        <path d="M0,70 H360" stroke="rgba(255,255,255,.5)" stroke-width="2" stroke-dasharray="7 6"/>
        <path d="M0,140 H360" stroke="rgba(255,255,255,.4)" stroke-width="1.8" stroke-dasharray="7 6"/>
        ${flow(120, 240, 96, 2, 18)}
        ${depthLabel(16, 46, "русло 3–4 м")} ${depthLabel(20, 116, "бровка 2 м", true)} ${depthLabel(24, 174, "стол 1 м")}
        ${ripples(80, 56)}
        ${shoreBottom()}
        ${reeds(36, 200, 5, 1)} ${reeds(326, 200, 5, 1)}
        ${castArc(186, 198, 206, 134)}
        ${castPoint(206, 134, dist)}
        ${angler(182, 198, -1)}
        ${scaleBar(16)}
      `);
    },
  },

  /* --- Опоры моста / гидросооружения --- */
  bridge_piles: {
    tags: ["bridge"], waters: ["canal", "river_big", "river_small", "reservoir"],
    title: "У опор моста",
    desc: (f) => `За опорой — затишье и промоина рядом: рыба прячется от струи и собирает корм. Подавайте в тень опоры и на границу завихрения.`,
    meta: (dist) => [`заброс ${dist}`, "тень за опорой", "промоина рядом"],
    profile: null,
    svg(id, dist) {
      return wrap(id, `
        <rect width="360" height="250" fill="url(#wg${id})"/>
        ${flow(20, 100, 80, 3, 20)} ${flow(250, 330, 80, 3, 20)}
        <rect x="150" y="0" width="60" height="250" fill="#c9c2b2" opacity=".96"/>
        <rect x="150" y="0" width="60" height="250" fill="none" stroke="#a89f8a" stroke-width="2"/>
        <ellipse cx="180" cy="118" rx="26" ry="40" fill="${C.deepest}" opacity=".5"/>
        ${depthLabel(160, 124, "промоина", true)}
        <path d="M210,70 q14,10 0,20 q-14,10 0,20" stroke="rgba(255,255,255,.6)" stroke-width="2" fill="none" class="flow-dash"/>
        ${depthLabel(222, 152, "затишье", true)}
        ${shoreBottom()}
        ${castArc(120, 198, 232, 130)}
        ${castPoint(232, 130, dist)}
        ${angler(116, 198, -1)}
        ${scaleBar(16)}
      `);
    },
  },

  /* --- Дамба / глубокий угол пруда --- */
  dam_wall: {
    tags: ["dropoff", "bridge"], waters: ["pond", "reservoir"],
    title: "У дамбы — самая глубокая часть",
    desc: (f) => `Пруд копают с уклоном к дамбе: здесь максимальная глубина и прохладная вода. Летним днём и по холодной воде рыба скатывается именно сюда.`,
    meta: (dist) => [`заброс ${dist}`, "глубина у стенки", "дневная точка"],
    profile: "dropoff",
    svg(id, dist) {
      return wrap(id, `
        <rect width="360" height="250" fill="url(#wg${id})" transform="rotate(180 180 125)"/>
        <rect x="0" y="0" width="360" height="34" fill="#c9c2b2"/>
        <path d="M0,34 H360" stroke="#a89f8a" stroke-width="3"/>
        <text x="180" y="22" text-anchor="middle" font-size="10.5" font-weight="600" fill="#5d5747" font-family="Inter,sans-serif">дамба</text>
        ${depthLabel(20, 60, "4–5 м", true)} ${depthLabel(24, 150, "2 м")} ${depthLabel(28, 196, "мелководье")}
        ${ripples(200, 80)}
        ${shoreBottom()}
        ${reeds(40, 200, 5, 1)} ${reeds(316, 202, 5, 1)}
        ${castArc(176, 198, 196, 84)}
        ${castPoint(196, 84, dist)}
        ${angler(172, 198, -1)}
        ${scaleBar(18)}
      `);
    },
  },
};

/* ---------- Дистанция заброса по снасти (фолбэк-строка) ---------- */
function castDistFallback(tackle, water) {
  const far = water === "river_big" || water === "reservoir" || water === "canal";
  switch (tackle) {
    case "feeder": return far ? "40–60 м" : "25–40 м";
    case "spinning": return "20–45 м";
    case "livebait": return "10–20 м";
    default: return far ? "15–25 м" : "8–15 м";
  }
}

/* ============================================================
   РЕАЛЬНЫЙ РЕЛЬЕФ + СПУТНИК (вид сверху)
   Под SVG-геометрию OSM подкладываются спутниковые тайлы Esri
   World Imagery; сцена повёрнута «берег снизу → вода вверх»;
   поверх — кликабельные точки ловли (data-title / data-tip).
   Глубину не выдумываем: точки опираются только на видимые
   объекты (камыш, устья притоков, мост, ближний/дальний берег).
   ============================================================ */

/* Web-Mercator тайлы Esri World Imagery (z/y/x) */
const ESRI_TILE = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
const tx2lon = (x, z) => x / 2 ** z * 360 - 180;
const ty2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;

/* Тайлы, покрывающие окно радиусом R вокруг центра, в локальных метрах */
function esriTiles(lat0, lon0, R, proj, z = 18) {
  const dLat = R / 111320, dLon = R / (111320 * Math.cos(lat0 * Math.PI / 180));
  const x1 = Math.floor(lon2tx(lon0 - dLon, z)), x2 = Math.floor(lon2tx(lon0 + dLon, z));
  const y1 = Math.floor(lat2ty(lat0 + dLat, z)), y2 = Math.floor(lat2ty(lat0 - dLat, z));
  const out = [];
  for (let xt = x1; xt <= x2; xt++) for (let yt = y1; yt <= y2; yt++) {
    const [nx, ny] = proj.toXY(ty2lat(yt, z), tx2lon(xt, z));       // NW угол → м
    const [sx, sy] = proj.toXY(ty2lat(yt + 1, z), tx2lon(xt + 1, z)); // SE угол → м
    out.push({ url: ESRI_TILE(z, xt, yt), x: nx, y: ny, w: sx - nx, h: sy - ny });
  }
  return out;
}

/* поворот пиксельной точки вокруг центра (для маркеров поверх повёрнутой сцены) */
function rotPx(p, deg, c) {
  const a = deg * Math.PI / 180, co = Math.cos(a), si = Math.sin(a), dx = p[0] - c, dy = p[1] - c;
  return [c + dx * co - dy * si, c + dx * si + dy * co];
}
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

export function realTerrainSVG(surr, castInfo, opts = {}) {
  if (!surr || (!surr.main && !(surr.waterways && surr.waterways.length))) return "";
  const sat = opts.satellite !== false;
  const R = opts.radius || (sat ? 130 : (surr.radius || 300));
  const S = 440, k = S / (2 * R), C = S / 2;
  const proj = surr.proj, ctr = surr.point;
  const toPx = (m) => [C + m[0] * k, C + m[1] * k];
  const geomM = (geom) => geom.map(g => proj.toXY(g.lat, g.lon));
  const clip = (pts) => pts.length > 220 ? pts.filter((_, i) => i % Math.ceil(pts.length / 220) === 0) : pts;
  const pathOf = (geom, close) => clip(geomM(geom)).map((m, i) => (i ? "L" : "M") + toPx(m).map(v => v.toFixed(1)).join(",")).join(" ") + (close ? " Z" : "");

  /* ближний берег и поворот «вода вверх» (только для полигона, если берег в окне) */
  let shoreM = null, bd = Infinity, rot = 0;
  if (surr.main) {
    const pts = geomM(surr.main.geom);
    for (let i = 0; i < pts.length - 1; i++) {
      const cp = closestOnSeg([0, 0], pts[i], pts[i + 1]); const d = Math.hypot(cp[0], cp[1]);
      if (d < bd) { bd = d; shoreM = cp; }
    }
    if (shoreM && bd > 0.5 && bd < R * 1.1) {
      const ang = Math.atan2(-shoreM[1], -shoreM[0]) * 180 / Math.PI; // вектор берег→вода
      rot = -90 - ang;                                                // вода — вверх
    }
  }

  /* --- ПОВОРАЧИВАЕМАЯ СЦЕНА: спутник + полупрозрачная «мультяшная» геометрия --- */
  let scene = `<rect x="${-S}" y="${-S}" width="${3 * S}" height="${3 * S}" fill="#9aa98c"/>`;
  if (sat) for (const t of esriTiles(ctr.lat, ctr.lon, R, proj)) {
    const [px, py] = toPx([t.x, t.y]);
    scene += `<image href="${t.url}" xlink:href="${t.url}" x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${(t.w * k).toFixed(1)}" height="${(t.h * k).toFixed(1)}" preserveAspectRatio="none"/>`;
  }
  for (const r of surr.reeds) scene += `<path d="${pathOf(r.geom, true)}" fill="#9fb06a" opacity="${sat ? .42 : .6}"/>`;
  for (const b of surr.beaches) scene += `<path d="${pathOf(b.geom, true)}" fill="${C_.sand}" opacity="${sat ? .5 : .85}"/>`;
  for (const w of surr.waters) {
    const main = w === surr.main;
    scene += `<path d="${pathOf(w.geom, true)}" fill="${main ? "#3f93b8" : "#5aa7c4"}" stroke="#1f6f90" stroke-width="1.4" opacity="${sat ? (main ? .3 : .34) : (main ? 1 : .9)}"/>`;
  }
  for (const ww of surr.waterways) {
    scene += `<path d="${pathOf(ww.geom, false)}" fill="none" stroke="#46a3c6" stroke-width="3" stroke-linecap="round" opacity="${sat ? .8 : 1}"/>`;
    scene += flowArrowsAlong(clip(geomM(ww.geom)), toPx);
  }
  for (const br of surr.bridges) scene += `<path d="${pathOf(br.geom, false)}" fill="none" stroke="#d8c187" stroke-width="5" stroke-linecap="round" opacity=".85"/>`;

  /* --- НЕПОВОРАЧИВАЕМЫЙ СЛОЙ: рыболов, точки, масштаб, компас, подписи --- */
  let over = "";
  if (shoreM && bd > 0.5 && bd < R * 1.1) {
    const u = [shoreM[0] / bd, shoreM[1] / bd];
    const aPx = rotPx(toPx([shoreM[0] + u[0] * 7, shoreM[1] + u[1] * 7]), rot, C);
    over += anglerPin(aPx[0], aPx[1]);
  }
  (opts.spots || []).forEach((sp, i) => {
    const p = rotPx(toPx([sp.mx, sp.my]), rot, C);
    over += spotMarker(p[0], p[1], i + 1, sp.title, sp.tip);
  });
  over += `<circle cx="${C}" cy="${C}" r="3.5" fill="#fff" stroke="#1d3d4d" stroke-width="1.6"/>`;

  const barM = R <= 160 ? 50 : 100, bar = barM * k;
  over += `<g transform="translate(14,${S - 16})"><line x1="0" y1="0" x2="${bar.toFixed(1)}" y2="0" stroke="#fff" stroke-width="3.4"/><line x1="0" y1="0" x2="${bar.toFixed(1)}" y2="0" stroke="#1d3d4d" stroke-width="1.4"/>
    <text x="${(bar + 6).toFixed(1)}" y="3.5" font-size="9.5" fill="#fff" stroke="#1d3d4d" stroke-width=".3" font-family="Inter,sans-serif">${barM} м</text></g>`;
  over += `<g transform="translate(${S - 24},27) rotate(${rot.toFixed(1)})"><path d="M0,-12 L4,6 L0,2 L-4,6 Z" fill="#fff" stroke="#1d3d4d" stroke-width=".6"/></g>
    <text x="${S - 24}" y="14" text-anchor="middle" font-size="9" font-weight="700" fill="#fff" stroke="#1d3d4d" stroke-width=".3" font-family="Inter,sans-serif">С</text>`;
  if (rot) {
    over += `<text x="${C}" y="17" text-anchor="middle" font-size="11" font-weight="700" fill="#e6f6ff" stroke="#10455c" stroke-width=".5" font-family="Inter,sans-serif">вода ↑</text>
      <text x="${C}" y="${S - 24}" text-anchor="middle" font-size="11" font-weight="700" fill="#f6ecd6" stroke="#5b4a2a" stroke-width=".5" font-family="Inter,sans-serif">берег ↓</text>`;
  }
  over += `<text x="${S - 6}" y="${S - 6}" text-anchor="end" font-size="7.5" fill="#fff" stroke="#000" stroke-width=".25" opacity=".9" font-family="Inter,sans-serif">© OpenStreetMap${sat ? " · Esri, Maxar" : ""}</text>`;

  return `<svg viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="Спутниковый вид точки: берег снизу, вода вверх">
    <clipPath id="terClip"><rect width="${S}" height="${S}"/></clipPath>
    <g clip-path="url(#terClip)"><g transform="rotate(${rot.toFixed(2)} ${C} ${C})">${scene}</g>${over}</g></svg>`;
}

/* Нумерованный кликабельный маркер точки ловли (поповер собирает app.js по data-*) */
function spotMarker(x, y, n, title, tip) {
  return `<g class="spot-marker" data-title="${escAttr(title)}" data-tip="${escAttr(tip)}" tabindex="0" role="button" aria-label="${escAttr(title)}" style="cursor:pointer">
    <circle class="cast-pulse" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="none" stroke="${C.cast}" stroke-width="2"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="${C.cast}" stroke="#fff" stroke-width="2.5"/>
    <text x="${x.toFixed(1)}" y="${(y + 4.4).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="800" fill="#fff" font-family="Inter,sans-serif">${n}</text>
  </g>`;
}

/* ============================================================
   ВЫБОР ТОЧЕК ЛОВЛИ по видимым объектам OSM (без выдумывания глубины)
   Возвращает координаты в локальных метрах + поповер «при каком факторе».
   ============================================================ */
export function selectFishingSpots(surr, profile, castInfo, state = {}, radius = 130) {
  if (!surr) return [];
  const proj = surr.proj;
  const fish = FISHES[state.fishId] || null;
  const fname = fish ? fish.name.toLowerCase() : "рыба";
  const hab = fish ? fish.habitat : [];
  const shallow = fish?.depth?.shallow ?? 0, deep = fish?.depth?.deep ?? 0;
  const mn = Math.round(castInfo?.minM ?? 8), rec = Math.round(castInfo?.recM ?? 20);
  const cand = [];

  /* ближний берег полигона */
  let shoreM = null, bd = Infinity, u = null;
  if (surr.main) {
    const pts = surr.main.geom.map(g => proj.toXY(g.lat, g.lon));
    for (let i = 0; i < pts.length - 1; i++) { const cp = closestOnSeg([0, 0], pts[i], pts[i + 1]); const d = Math.hypot(cp[0], cp[1]); if (d < bd) { bd = d; shoreM = cp; } }
    if (shoreM && bd > 0.5) u = [shoreM[0] / bd, shoreM[1] / bd];
  }
  const intoWater = (dist) => (shoreM && u) ? [shoreM[0] - u[0] * Math.min(dist, bd * 0.95), shoreM[1] - u[1] * Math.min(dist, bd * 0.95)] : [0, -dist];
  const nearestOf = (geom) => { let best = null, dd = Infinity; for (const g of geom) { const p = proj.toXY(g.lat, g.lon); const d = Math.hypot(p[0], p[1]); if (d < dd) { dd = d; best = p; } } return best; };

  /* 1) под берегом */
  { const [mx, my] = intoWater(Math.max(4, mn * 0.5)); cand.push({ mx, my, pr: shallow > 0.6 || hab.includes("reeds") ? 3 : 2,
    title: "Под берегом", tip: `Короткий заброс ${mn} м. На утренней и вечерней зорьке и в тихую погоду ${fname} кормится у самого берега — подавайте деликатно.` }); }

  /* 2) кромка камыша */
  if (surr.reeds?.length) {
    const best = nearestOf(surr.reeds[0].geom);
    if (best) { const m = Math.hypot(best[0], best[1]) || 1; cand.push({ mx: best[0] - best[0] / m * 4, my: best[1] - best[1] / m * 4, pr: hab.includes("reeds") || hab.includes("lilies") ? 5 : 2,
      title: "Кромка камыша", tip: `Заброс вдоль стены тростника. Ветер, гонящий волну к камышу, сносит сюда корм; на зорях здесь засада хищника.` }); }
  }

  /* 3) устье притока */
  if (surr.waterways?.length && surr.main) {
    let mouth = null, dd = Infinity;
    for (const ww of surr.waterways) { const p = nearestOf(ww.geom); if (p) { const d = Math.hypot(p[0], p[1]); if (d < dd) { dd = d; mouth = p; } } }
    if (mouth) cand.push({ mx: mouth[0], my: mouth[1], pr: 4,
      title: "Устье притока", tip: `Свежая вода и корм на струе — особенно в жару и после дождя. Рыба держится на границе мути и чистой воды.` });
  }

  /* 4) у моста / опор */
  if (surr.bridges?.length) {
    const pts = surr.bridges[0].geom.map(g => proj.toXY(g.lat, g.lon));
    const m = pts[Math.floor(pts.length / 2)];
    cand.push({ mx: m[0], my: m[1], pr: 3, title: "У моста / опор", tip: `Тень и затишье у опор — стоянка в жаркий полдень и при ярком солнце.` });
  }

  /* 5) дальше от берега / чистая вода */
  { const [mx, my] = intoWater(Math.max(rec, mn + 6)); cand.push({ mx, my, pr: deep > 0.6 ? 4 : 1,
    title: "Дальше от берега", tip: `Заброс ${rec} м на чистую воду. Когда у берега пусто и при сильном встречном ветре рыба отходит от берега.` }); }

  const inView = cand.filter(s => Math.hypot(s.mx, s.my) <= radius * 0.92);
  const out = (inView.length ? inView : cand).sort((a, b) => b.pr - a.pr).slice(0, 5);
  if (!out.length) out.push({ mx: 0, my: 0, pr: 1, title: "Ваша точка", tip: "Точка, отмеченная на карте. Начните отсюда: веер забросов на разную дистанцию, чтобы нащупать рыбу." });
  return out;
}

const C_ = { sand: "#e9dcb4" };
function esc(s) { return String(s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
function closestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * dx, a[1] + t * dy];
}
function flowArrowsAlong(ptsM, toPx) {
  let out = "";
  const step = Math.max(1, Math.floor(ptsM.length / 3));
  for (let i = step; i < ptsM.length; i += step) {
    const a = toPx(ptsM[i - 1]), b = toPx(ptsM[i]);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    out += `<path d="M${b[0].toFixed(1)},${b[1].toFixed(1)} l${(-6 * Math.cos(ang - .5)).toFixed(1)},${(-6 * Math.sin(ang - .5)).toFixed(1)} l${(6 * Math.cos(ang + .5) - 6 * Math.cos(ang - .5)).toFixed(1)},${(6 * Math.sin(ang + .5) - 6 * Math.sin(ang - .5)).toFixed(1)} z" fill="rgba(255,255,255,.7)"/>`;
  }
  return out;
}
function anglerPin(x, y) {
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    <circle cx="0" cy="-11" r="3.6" fill="#1d3d4d"/>
    <path d="M0,-8 L0,1 M0,-5 L7,-9 M0,1 L-3,8 M0,1 L4,7" stroke="#1d3d4d" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    <path d="M7,-9 L24,-21" stroke="#6b4f2f" stroke-width="1.8" stroke-linecap="round"/></g>`;
}

/* ---------- Подбор схем под условия (state.osm, state.castInfo) ---------- */
export function selectSpots(state) {
  const fish = FISHES[state.fishId];
  const scored = [];

  for (const [key, tpl] of Object.entries(TEMPLATES)) {
    if (!tpl.waters.includes(state.water)) continue;
    let s = 1;
    for (const tag of tpl.tags) {
      if (fish.habitat.includes(tag)) s += 2;
      if (state.features.includes(tag)) s += 1.6;
    }
    if ((fish.depth.deep ?? 0) > 0.8 && tpl.tags.includes("dropoff")) s += 0.8;
    if ((fish.depth.shallow ?? 0) > 0.8 && (tpl.tags.includes("reeds") || tpl.tags.includes("lilies"))) s += 0.8;
    scored.push({ key, tpl, s });
  }

  scored.sort((a, b) => b.s - a.s);
  const dist = state.castInfo?.label || castDistFallback(state.tackle, state.water);
  const distShort = state.castInfo ? `${state.castInfo.recM} м` : dist;
  const fishName = fish.name.toLowerCase();

  const cards = [];

  const fishingSpots = state.osm ? selectFishingSpots(state.osm, state.waterProfile, state.castInfo, state, 130) : [];
  const realSvg = state.osm ? realTerrainSVG(state.osm, state.castInfo, { satellite: true, radius: 130, spots: fishingSpots }) : "";
  if (realSvg) {
    const ci = state.castInfo;
    cards.push({
      key: "real", real: true, spots: fishingSpots,
      title: "Ваша точка — спутник (≈130 м)",
      desc: `Реальный спутниковый снимок (Esri) с геометрией берега из OpenStreetMap. Карта повёрнута: берег снизу, вода вверх. Нажмите на номера — где и при каком факторе пробовать ${fishName}.`,
      meta: [`точек ловли: ${fishingSpots.length}`, ci ? `заброс ${ci.label}` : `заброс ${dist}`, state.osm.reeds?.length ? "камыш отмечен" : "по данным OSM"],
      svg: realSvg, profileSvg: "",
    });
  }

  const need = 3 - cards.length;
  for (const { key, tpl } of scored.slice(0, need)) {
    cards.push({
      key, title: tpl.title,
      desc: tpl.desc(fishName, distShort),
      meta: tpl.meta(distShort),
      svg: tpl.svg(key + cards.length, distShort),
      profileSvg: tpl.profile ? profileSVG(tpl.profile) : "",
    });
  }
  return cards;
}
