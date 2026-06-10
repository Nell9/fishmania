/* ============================================================
   КлёвГид — база знаний: водоёмы, насадки, снасти, рыбы.
   Данные откалиброваны под среднюю полосу России/СНГ,
   движок (engine.js) корректирует их по широте и сезону.
   Активность по месяцам: индексы 0..11 (янв..дек), открытая вода.
   ============================================================ */

/* ---------- Типы водоёмов ---------- */
export const WATERS = {
  pond: {
    name: "Пруд", desc: "Малый замкнутый водоём, быстро прогревается",
    tau: 2.5, sun: 1.12, flow: 0,
    icon: "pond",
  },
  lake: {
    name: "Озеро", desc: "Естественный водоём, прогревается медленно",
    tau: 6, sun: 1.0, flow: 0,
    icon: "lake",
  },
  river_small: {
    name: "Малая река", desc: "Перекаты, омуты, быстрое течение",
    tau: 3, sun: 0.95, flow: 2,
    icon: "riverS",
  },
  river_big: {
    name: "Крупная река", desc: "Русло, бровки, фарватер, течение",
    tau: 5, sun: 0.97, flow: 2,
    icon: "riverB",
  },
  oxbow: {
    name: "Старица", desc: "Отрезанный рукав реки, тихая заросшая вода",
    tau: 3, sun: 1.08, flow: 0,
    icon: "oxbow",
  },
  reservoir: {
    name: "Водохранилище", desc: "Большая вода, затопленное русло, бровки",
    tau: 7, sun: 0.98, flow: 1,
    icon: "reservoir",
  },
  canal: {
    name: "Канал", desc: "Искусственное русло с умеренным течением",
    tau: 4, sun: 1.0, flow: 1,
    icon: "canal",
  },
};

/* ---------- Характер места (отмечает пользователь) ---------- */
export const FEATURES = {
  reeds:   { name: "Камыш / тростник", em: "🌾" },
  lilies:  { name: "Кувшинки / трава", em: "🪷" },
  snags:   { name: "Коряги / упавшие деревья", em: "🪵" },
  dropoff: { name: "Яма / бровка рядом", em: "📉" },
  flat:    { name: "Ровное дно / пляж", em: "🏖" },
  bridge:  { name: "Мост / опоры / гидросооружения", em: "🌉" },
};

/* ---------- Глубина в месте ловли ---------- */
export const DEPTHS = {
  shallow: { name: "Мелко, до 1,5 м", short: "мелководье" },
  mid:     { name: "Средне, 1,5–3 м", short: "средняя глубина" },
  deep:    { name: "Глубоко, от 3 м", short: "глубокое место" },
};

/* ---------- Снасти ---------- */
export const TACKLE = {
  float: {
    name: "Поплавочная удочка", desc: "Маховая, болонская или матчевая",
    em: "🎣", dist: "5–25 м от берега",
  },
  feeder: {
    name: "Фидер / донка", desc: "Кормушка, дальний заброс, ловля со дна",
    em: "⚓", dist: "20–70 м, дно",
  },
  spinning: {
    name: "Спиннинг", desc: "Искусственные приманки, активный поиск",
    em: "🌀", dist: "поиск по площади",
  },
  livebait: {
    name: "Живцовая снасть", desc: "Кружки, жерлицы, поплавок с живцом",
    em: "🐟", dist: "у травы и ям",
  },
};

/* ---------- Каталог насадок ----------
   cat: animal | plant | artificial | live
   tackle: с какими снастями совместима */
export const BAITS = {
  worm:      { name: "Червь навозный",   cat: "animal", em: "🪱", tackle: ["float","feeder"] },
  crawler:   { name: "Выползок",         cat: "animal", em: "🪱", tackle: ["float","feeder"] },
  maggot:    { name: "Опарыш",           cat: "animal", em: "⚪", tackle: ["float","feeder"] },
  bloodworm: { name: "Мотыль",           cat: "animal", em: "🔴", tackle: ["float","feeder"] },
  corn:      { name: "Кукуруза",         cat: "plant",  em: "🌽", tackle: ["float","feeder"] },
  barley:    { name: "Перловка",         cat: "plant",  em: "🌾", tackle: ["float","feeder"] },
  dough:     { name: "Тесто / болтушка", cat: "plant",  em: "🥣", tackle: ["float","feeder"] },
  bread:     { name: "Хлеб / корка",     cat: "plant",  em: "🍞", tackle: ["float"] },
  pea:       { name: "Горох / пареный",  cat: "plant",  em: "🟢", tackle: ["float","feeder"] },
  boilies:   { name: "Бойлы / пеллетс",  cat: "plant",  em: "🟤", tackle: ["feeder"] },
  livebait:  { name: "Живец",            cat: "live",   em: "🐟", tackle: ["livebait","feeder"] },
  spinner:   { name: "Вертушка",         cat: "artificial", em: "✨", tackle: ["spinning"] },
  spoon:     { name: "Колебалка",        cat: "artificial", em: "🥄", tackle: ["spinning"] },
  wobbler:   { name: "Воблер",           cat: "artificial", em: "🐠", tackle: ["spinning"] },
  jig:       { name: "Джиг / силикон",   cat: "artificial", em: "🪝", tackle: ["spinning"] },
};

/* ---------- Рыбы ----------
   waters:   реальная встречаемость по типам водоёмов, 0..1
   months:   активность клёва по месяцам (средняя полоса), 0..1
   temp:     [мин, опт-мин, опт-макс, макс] температуры воды, °C
   times:    активность по времени суток
   depth:    предпочтение глубины места
   baits:    базовая привлекательность насадок, 0..1
   tackle:   пригодность снастей
   lat:      [южная, северная] границы уверенного обитания
   habitat:  где искать (теги точек для схем и тактики)
   shape:    силуэт для SVG (carp|bream|roach|pike|perch|catfish|asp|burbot)
*/
export const FISHES = {
  crucian: {
    name: "Карась", latin: "Carassius gibelio", shape: "carp", hue: "#b08d3f",
    waters: { pond: 1, oxbow: .95, lake: .8, canal: .4, river_small: .35, reservoir: .5, river_big: .2 },
    months: [.05,.05,.15,.45,.85,1,.9,.85,.6,.3,.1,.05],
    temp: [8, 15, 24, 30],
    times: { dawn: 1, day: .5, dusk: .9, night: .35 },
    depth: { shallow: .9, mid: .8, deep: .3 },
    baits: { worm: .95, maggot: .8, bloodworm: .7, corn: .7, barley: .75, dough: .85, bread: .7, pea: .4, boilies: .3 },
    tackle: { float: 1, feeder: .8, spinning: .05, livebait: 0 },
    lat: [43, 64],
    habitat: ["reeds", "lilies", "flat"],
    note: "Главная рыба прудов и стариц. Любит тёплую тихую воду у растительности.",
  },
  carp: {
    name: "Карп / сазан", latin: "Cyprinus carpio", shape: "carp", hue: "#8a6d2f",
    waters: { pond: .9, reservoir: .6, lake: .5, river_big: .45, oxbow: .3, canal: .3, river_small: .1 },
    months: [.02,.02,.1,.3,.7,1,.95,.9,.6,.25,.05,.02],
    temp: [12, 18, 26, 30],
    times: { dawn: .95, day: .5, dusk: .9, night: .8 },
    depth: { shallow: .5, mid: .9, deep: .7 },
    baits: { corn: .95, boilies: .95, pea: .8, worm: .7, crawler: .6, dough: .6, barley: .5, bread: .45 },
    tackle: { float: .6, feeder: 1, spinning: 0, livebait: 0 },
    lat: [43, 58],
    habitat: ["lilies", "snags", "dropoff"],
    note: "Тепло- и кормолюбив. В зарыбленных прудах — основной трофей; в реках — дикий сазан.",
  },
  roach: {
    name: "Плотва", latin: "Rutilus rutilus", shape: "roach", hue: "#9aa5b5",
    waters: { lake: .9, river_big: .9, reservoir: .9, river_small: .85, canal: .8, oxbow: .8, pond: .7 },
    months: [.35,.3,.5,.85,.9,.8,.7,.7,.75,.6,.4,.35],
    temp: [4, 10, 20, 26],
    times: { dawn: .9, day: .65, dusk: .85, night: .15 },
    depth: { shallow: .7, mid: .9, deep: .5 },
    baits: { maggot: .95, bloodworm: .9, worm: .7, barley: .8, dough: .75, bread: .6, corn: .45 },
    tackle: { float: 1, feeder: .8, spinning: .1, livebait: 0 },
    lat: [43, 68],
    habitat: ["flat", "reeds", "dropoff"],
    note: "Самая массовая белая рыба — есть почти везде, клюёт круглый год.",
  },
  bream: {
    name: "Лещ", latin: "Abramis brama", shape: "bream", hue: "#a98e58",
    waters: { river_big: .95, reservoir: .95, lake: .8, canal: .6, oxbow: .4, river_small: .3, pond: .15 },
    months: [.2,.15,.3,.6,.9,1,.85,.8,.75,.5,.3,.2],
    temp: [6, 12, 22, 26],
    times: { dawn: .95, day: .35, dusk: .95, night: .85 },
    depth: { shallow: .1, mid: .6, deep: 1 },
    baits: { worm: .9, crawler: .85, maggot: .85, bloodworm: .8, corn: .7, pea: .85, barley: .6, dough: .5, boilies: .4 },
    tackle: { float: .6, feeder: 1, spinning: 0, livebait: 0 },
    lat: [44, 64],
    habitat: ["dropoff", "flat"],
    note: "Глубинная стайная рыба рек и водохранилищ. Ключ к лещу — бровка и прикормка.",
  },
  perch: {
    name: "Окунь", latin: "Perca fluviatilis", shape: "perch", hue: "#5c8a4f",
    waters: { lake: .95, river_big: .9, reservoir: .9, river_small: .85, canal: .8, oxbow: .85, pond: .6 },
    months: [.5,.4,.5,.7,.85,.9,.8,.85,1,.9,.6,.5],
    temp: [4, 10, 22, 27],
    times: { dawn: 1, day: .75, dusk: .85, night: .05 },
    depth: { shallow: .7, mid: .9, deep: .6 },
    baits: { worm: .85, spinner: .95, jig: .9, wobbler: .7, spoon: .6, livebait: .8, maggot: .5, bloodworm: .5 },
    tackle: { float: .7, feeder: .3, spinning: 1, livebait: .7 },
    lat: [43, 69],
    habitat: ["snags", "dropoff", "reeds", "bridge"],
    note: "Дневной стайный хищник. Где малёк и укрытия — там и окунь.",
  },
  pike: {
    name: "Щука", latin: "Esox lucius", shape: "pike", hue: "#6e8c4a",
    waters: { oxbow: .9, lake: .9, river_small: .85, reservoir: .85, river_big: .8, pond: .5, canal: .5 },
    months: [.55,.45,.7,.65,.6,.5,.4,.55,.85,1,.8,.6],
    temp: [3, 8, 18, 24],
    times: { dawn: 1, day: .55, dusk: .9, night: .1 },
    depth: { shallow: .8, mid: .9, deep: .5 },
    baits: { spoon: .9, wobbler: .95, jig: .85, spinner: .7, livebait: 1 },
    tackle: { float: .1, feeder: 0, spinning: 1, livebait: .9 },
    lat: [43, 69],
    habitat: ["reeds", "lilies", "snags", "dropoff"],
    note: "Засадный хищник у травы и коряг. Лучшее время — осень и преднерестовый март.",
  },
  zander: {
    name: "Судак", latin: "Sander lucioperca", shape: "pike", hue: "#7d8a99",
    waters: { river_big: .9, reservoir: .9, canal: .5, lake: .4, river_small: .1, oxbow: .05, pond: .02 },
    months: [.4,.3,.5,.6,.75,.9,.7,.7,.85,1,.7,.5],
    temp: [4, 10, 20, 25],
    times: { dawn: .85, day: .25, dusk: 1, night: .9 },
    depth: { shallow: .1, mid: .5, deep: 1 },
    baits: { jig: 1, wobbler: .8, livebait: .85, spoon: .5, spinner: .3 },
    tackle: { float: 0, feeder: .1, spinning: 1, livebait: .7 },
    lat: [44, 61],
    habitat: ["dropoff", "snags", "bridge"],
    note: "Сумеречный хищник глубоких бровок и коряжников больших рек и водохранилищ.",
  },
  catfish: {
    name: "Сом", latin: "Silurus glanis", shape: "catfish", hue: "#6b6258",
    waters: { river_big: .85, reservoir: .6, oxbow: .3, canal: .3, lake: .2, river_small: .15, pond: .05 },
    months: [0,0,.05,.2,.6,.95,1,.9,.6,.3,.05,0],
    temp: [14, 18, 27, 30],
    times: { dawn: .5, day: .15, dusk: .85, night: 1 },
    depth: { shallow: .05, mid: .4, deep: 1 },
    baits: { crawler: .9, livebait: .95, worm: .5, jig: .6, wobbler: .5, spoon: .4 },
    tackle: { float: .1, feeder: .9, spinning: .7, livebait: .9 },
    lat: [43, 57],
    habitat: ["dropoff", "snags"],
    note: "Хозяин речных ям. Тёплые ночи июня–августа — его время.",
  },
  ide: {
    name: "Язь", latin: "Leuciscus idus", shape: "roach", hue: "#b3923c",
    waters: { river_big: .8, river_small: .7, oxbow: .5, reservoir: .5, lake: .4, canal: .4, pond: .05 },
    months: [.2,.2,.45,.8,.9,.8,.65,.6,.65,.5,.3,.2],
    temp: [5, 10, 20, 25],
    times: { dawn: .95, day: .5, dusk: .9, night: .4 },
    depth: { shallow: .5, mid: .9, deep: .6 },
    baits: { worm: .85, maggot: .7, corn: .6, pea: .6, bread: .5, wobbler: .6, spinner: .6, dough: .5 },
    tackle: { float: .9, feeder: .8, spinning: .6, livebait: .1 },
    lat: [46, 66],
    habitat: ["dropoff", "snags", "bridge"],
    note: "Сильная всеядная рыба речных струй и омутов, любит границу течения.",
  },
  chub: {
    name: "Голавль", latin: "Squalius cephalus", shape: "roach", hue: "#8f8456",
    waters: { river_small: .95, river_big: .7, canal: .2, oxbow: .05, lake: .02, reservoir: .1, pond: 0 },
    months: [.05,.05,.3,.7,.95,1,.85,.8,.7,.4,.15,.05],
    temp: [8, 14, 22, 27],
    times: { dawn: .9, day: .7, dusk: .9, night: .3 },
    depth: { shallow: .8, mid: .9, deep: .3 },
    baits: { wobbler: .9, spinner: .8, worm: .7, crawler: .7, bread: .6, maggot: .5, corn: .5 },
    tackle: { float: .7, feeder: .5, spinning: 1, livebait: .1 },
    lat: [44, 60],
    habitat: ["bridge", "snags", "flat"],
    note: "Рыба перекатов и нависших деревьев малых рек. Осторожен — нужна маскировка.",
  },
  tench: {
    name: "Линь", latin: "Tinca tinca", shape: "carp", hue: "#5f7240",
    waters: { oxbow: .9, pond: .8, lake: .7, canal: .3, river_small: .2, reservoir: .2, river_big: .05 },
    months: [0,0,.05,.3,.8,1,.85,.7,.4,.1,0,0],
    temp: [12, 17, 24, 28],
    times: { dawn: 1, day: .3, dusk: .9, night: .5 },
    depth: { shallow: .9, mid: .7, deep: .1 },
    baits: { worm: 1, maggot: .6, bloodworm: .6, corn: .5, dough: .4, pea: .3 },
    tackle: { float: 1, feeder: .4, spinning: 0, livebait: 0 },
    lat: [44, 60],
    habitat: ["reeds", "lilies"],
    note: "Скрытный житель заросших стариц и прудов. Клюёт в окнах травы на зорях.",
  },
  rudd: {
    name: "Краснопёрка", latin: "Scardinius erythrophthalmus", shape: "roach", hue: "#b5703c",
    waters: { oxbow: .9, lake: .8, pond: .7, canal: .5, reservoir: .5, river_small: .4, river_big: .3 },
    months: [.05,.05,.2,.6,.9,1,.9,.85,.6,.3,.1,.05],
    temp: [10, 15, 24, 28],
    times: { dawn: .8, day: .85, dusk: .8, night: .05 },
    depth: { shallow: 1, mid: .5, deep: .05 },
    baits: { maggot: .9, worm: .7, bread: .7, dough: .6, corn: .5, barley: .5, spinner: .3 },
    tackle: { float: 1, feeder: .2, spinning: .3, livebait: 0 },
    lat: [43, 62],
    habitat: ["reeds", "lilies"],
    note: "Держится у поверхности среди травы. Летом берёт смело весь день.",
  },
  silver_bream: {
    name: "Густера", latin: "Blicca bjoerkna", shape: "bream", hue: "#9b9faa",
    waters: { river_big: .8, reservoir: .8, lake: .6, canal: .6, river_small: .4, oxbow: .4, pond: .1 },
    months: [.2,.15,.3,.6,.85,.9,.8,.75,.7,.5,.3,.2],
    temp: [6, 12, 22, 26],
    times: { dawn: .85, day: .5, dusk: .9, night: .5 },
    depth: { shallow: .3, mid: .9, deep: .8 },
    baits: { maggot: .9, worm: .85, bloodworm: .85, barley: .6, corn: .5, dough: .5 },
    tackle: { float: .9, feeder: 1, spinning: 0, livebait: 0 },
    lat: [44, 62],
    habitat: ["dropoff", "flat"],
    note: "Спутница леща на бровках, но ближе к берегу и мельче. Клюёт охотно.",
  },
  burbot: {
    name: "Налим", latin: "Lota lota", shape: "burbot", hue: "#54604f",
    waters: { river_big: .7, river_small: .6, lake: .5, reservoir: .5, canal: .1, oxbow: .05, pond: 0 },
    months: [.95,.8,.5,.15,0,0,0,0,.2,.6,1,1],
    temp: [1, 2, 10, 14],
    times: { dawn: .3, day: .05, dusk: .6, night: 1 },
    depth: { shallow: .2, mid: .6, deep: 1 },
    baits: { livebait: .9, crawler: .9, worm: .7, jig: .3 },
    tackle: { float: .1, feeder: 1, spinning: .2, livebait: .8 },
    lat: [50, 70],
    habitat: ["dropoff", "snags"],
    note: "Единственный пресноводный из тресковых: чем холоднее и темнее — тем лучше клёв.",
  },
  asp: {
    name: "Жерех", latin: "Leuciscus aspius", shape: "asp", hue: "#7e8fa3",
    waters: { river_big: .85, reservoir: .5, river_small: .3, canal: .3, lake: .1, oxbow: .02, pond: 0 },
    months: [.05,.05,.3,.6,.8,.9,.85,.9,1,.7,.3,.1],
    temp: [8, 14, 22, 26],
    times: { dawn: .9, day: .85, dusk: .8, night: .05 },
    depth: { shallow: .7, mid: .9, deep: .4 },
    baits: { spoon: .95, wobbler: .8, spinner: .7, jig: .5 },
    tackle: { float: 0, feeder: 0, spinning: 1, livebait: .2 },
    lat: [45, 58],
    habitat: ["flat", "bridge", "dropoff"],
    note: "Дневной речной корсар: бьёт малька «котлами» на струе. Нужен дальний заброс.",
  },
  rotan: {
    name: "Ротан", latin: "Perccottus glenii", shape: "perch", hue: "#4f5a44",
    waters: { pond: .85, oxbow: .7, lake: .3, canal: .2, river_small: .05, river_big: 0, reservoir: .1 },
    months: [.3,.25,.4,.7,.9,.9,.85,.85,.8,.6,.4,.3],
    temp: [4, 12, 24, 30],
    times: { dawn: .8, day: .9, dusk: .8, night: .2 },
    depth: { shallow: 1, mid: .4, deep: .05 },
    baits: { worm: 1, crawler: .8, maggot: .7, livebait: .5, jig: .4, bloodworm: .6 },
    tackle: { float: 1, feeder: .3, spinning: .4, livebait: .4 },
    lat: [45, 62],
    habitat: ["reeds", "lilies", "snags"],
    note: "Неприхотливый вселенец заморных прудов: клюёт жадно почти всегда.",
  },
};

/* ---------- Подписи направлений ветра ---------- */
export const WIND_DIRS = ["С","ССВ","СВ","ВСВ","В","ВЮВ","ЮВ","ЮЮВ","Ю","ЮЮЗ","ЮЗ","ЗЮЗ","З","ЗСЗ","СЗ","ССЗ"];

export function windDirName(deg) {
  return WIND_DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
