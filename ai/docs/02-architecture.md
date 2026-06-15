# 02 · Архитектура

## Стек

Чистая статика без сборки: HTML + CSS + ES-модули (vanilla JS). Снаружи только CDN-зависимости: Leaflet 1.9.4 (карта), Google Fonts (Lora + Inter), тайлы OpenStreetMap.

Почему так: деплой = копирование файлов на любой сервер; нет node_modules, билд-пайплайна и уязвимостей зависимостей; легко перенести логику на бэкенд позже (модули чистые, без DOM, кроме `app.js` и `charts.js`).

## Структура файлов

```
fishing/
├── index.html          разметка всех шагов мастера (контент рендерит JS)
├── css/
│   └── style.css       дизайн-система + все анимации (см. 06)
├── js/
│   ├── app.js          оркестратор: состояние, шаги, карта, рендер DOM
│   ├── fishdb.js       ДАННЫЕ: водоёмы, рыбы, насадки, снасти (см. 03)
│   ├── weather.js      Open-Meteo клиент, модель T воды, тренд давления
│   ├── astro.js        фаза Луны, восход/закат (фолбэк), периоды суток
│   ├── engine.js       скоринг клёва, ранжирование насадок, тактика
│   ├── spotmaps.js     генераторы SVG-схем точек ловли
│   └── charts.js       SVG-графики: гейдж, часы, давление, T, компас, Луна, силуэты
├── klevgid-standalone.html  однофайловая сборка для запуска двойным кликом (file://)
├── deploy/             продакшен: nginx.conf, nginx-ratelimit.conf (лимиты и боты), fail2ban-jail.local
├── start-server.ps1    локальный сервер Windows (запускается «Запустить сайт.bat»)
├── README.md           витрина репозитория · .gitignore
└── ai/docs/            эта документация
```

### Standalone-сборка

`klevgid-standalone.html` — это `index.html` с инлайн CSS и склеенными в IIFE модулями (импорты/экспорты вырезаны, порядок: fishdb → astro → weather → engine → charts → spotmaps → app). Нужна только для локального просмотра без сервера; на прод деплоится модульная версия. После правки модулей файл нужно пересобрать тем же способом (склейка + замена двух тегов в index.html).

## Поток данных

```
координаты ──► weather.js: fetchWeather (Open-Meteo, past_days=7)
   │                │
   │                ├─► estimateWaterTemp(hours, тип водоёма)  → T воды
   │                └─► pressureTrend(hours)                   → тренд
   │
тип водоёма + широта + месяц + T воды
   └─► engine.js: fishActivityNow → список реальных видов (шаг 4)
выбранная рыба + снасть + насадки
   └─► engine.js: computeBite → { pct, factors[9], hourly[24], baits[], verdict }
            ├─► charts.js  → гейдж, бары факторов, график 24 ч
            ├─► buildTactics → блоки тактики
            └─► spotmaps.js: selectSpots → 3 SVG-схемы точек
```

## Состояние приложения (`app.js`)

```js
state = {
  lat, lon, placeName,          // шаг 1
  water, features[], depth,     // шаг 2
  weather, waterTemp,           // шаг 3 (normalized, source: api|manual)
  fishId,                       // шаг 4
  tackle, baitsOwned[],         // шаг 5
}
```

Навигация: `goTo(n)` показывает одну секцию, обновляет прогресс-бар и шаги-навигацию; `maxStep` не даёт прыгать вперёд. Координаты сохраняются в `localStorage` (`klevgid.v1`).

## Отказоустойчивость

- Open-Meteo недоступен → форма ручного ввода условий (`manualWeather`), весь движок работает дальше.
- Nominatim недоступен → показываются координаты вместо названия.
- Leaflet/тайлы не загрузились → ручной ввод координат.
- `daily.sunrise` отсутствует (ручной режим) → астрономический фолбэк `sunTimes()`.

## Модульные границы

`fishdb / astro / weather(кроме fetch) / engine / spotmaps` не трогают DOM — их можно гонять в Node для тестов и переносить на сервер как есть.

## Бэкенд-слой (v1.2.0)

Статика осталась самодостаточной, но появился опциональный AI-слой — тонкий Python-сервис
`backend/` (FastAPI + SQLite + RAG + Anthropic SDK). Он отвечает за «умный» разбор видового
состава и тактику с честным прогнозом клёва; ключ Claude живёт только в окружении сервера.

```
[браузер: статика js/]  ──fetch──>  nginx  ──/api/──>  uvicorn (FastAPI)
   AI_CONFIG.provider="auto"                              ├─ rag.py  → SQLite (повадки)
   backendAvailable() (пробник /api/health)               ├─ claude_client.py → Claude
   фолбэк → локальный движок (ai-analyst/engine)          └─ engine.py (local-фолбэк)
```

- Доступности нет / сбой → фронтенд мгновенно откатывается на локальный движок (тот же расчёт).
- Граница модулей сохранена: `fishdb/astro/weather/engine/spotmaps/osm/ai-analyst` без DOM;
  их логика воспроизведена на сервере (`backend/app/engine.py`) для парити-фолбэка.
- Полное описание схемы, таблиц и контрактов — в `12-backend.md`.

Схемы точек ловли (`spotmaps.realTerrainSVG`) с v1.2.0 рисуют спутниковый снимок Esri под
геометрией OSM с поворотом «берег снизу → вода вверх» и кликабельными точками (см. `10-osm-terrain.md`).
