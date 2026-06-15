# 12 · AI-бэкенд (FastAPI + SQLite + RAG)

Сервис-прокси к Claude с собственной базой знаний о повадках рыб. Фронтенд статичен;
бэкенд добавляет два умных эндпоинта. **Без ключа всё работает в детерминированном
`local`-режиме** (тот же научный движок, что и на фронте) — сайт никогда не остаётся
без ответа. Код: `backend/`.

## Зачем отдельный слой

AI-аналитик (`js/ai-analyst.js`) изначально спроектирован как RAG: факты о водоёме (OSM) +
экология видов → промпт → строгий JSON. На фронте это работает локально, но «настоящий»
разбор и тактику даёт Claude. Чтобы не светить ключ в браузере и держать научную базу в одном
месте, разбор и тактика вынесены в тонкий Python-сервис.

## Стек

- **FastAPI + uvicorn** — HTTP, валидация (Pydantic).
- **SQLite (stdlib `sqlite3`)** — база знаний о повадках; без ORM и внешних зависимостей.
- **Anthropic SDK** — вызов Claude; ключ `ANTHROPIC_API_KEY` только в окружении сервера.
- **RAG** — извлечение релевантных факторных правил из SQLite и подмешивание в промпт.

```
backend/
├── app/
│   ├── main.py          FastAPI: /api/health, /api/ai/analyze, /api/ai/tactics, CORS
│   ├── schemas.py       Pydantic-контракты запросов/ответов
│   ├── db.py            доступ к SQLite (только чтение)
│   ├── rag.py           извлечение кандидатов и факторных фактов (RAG-retrieval)
│   ├── engine.py        локальный детерминированный движок (фолбэк, парити с JS)
│   └── claude_client.py промпт + вызов Claude + строгий парсинг JSON
├── build_db.py          сборка klevgid.db из seed/fishdb.json
├── seed/fishdb.json     срез данных фронтенда (22 вида: экология, ареал, насадки)
├── test_api.py          смоук-тесты (local-режим, TestClient)
├── requirements.txt · .env.example · README.md
```

## База знаний (SQLite)

`build_db.py` собирает `klevgid.db` из `seed/fishdb.json` (срез `FISHES`/`ECOLOGY`/
`KNOWLEDGE`/`SOURCES` фронтенда):

| Таблица | Содержимое |
|---|---|
| `species` | id, имя, латынь, экология (o2, flow, river_link, нерест), температурные рамки, глубины, месяцы активности, полная карточка `raw`, текст `knowledge` |
| `waters_affinity` | пригодность вида к типу водоёма 0..1 (`species_id`, `water_type`, `affinity`) |
| `region_presence` | широтный ареал (`lat_min`, `lat_max`) |
| `baits` | насадки и базовая привлекательность |
| `behavior` | **факторные научные правила** — корпус RAG (`factor`, `rule`, `weight`, `source_id`) |
| `sources` | источники |

Факторы в `behavior`: `temperature`, `oxygen`, `flow`, `connectivity`, `feeding`,
`daytime`, `season`, `size`, `stocking`. Они генерируются из экологии вида и извлекаются под
запрос (для разбора — экологические; для тактики — поведенческие).

Пересобрать срез после правок данных фронта:

```bash
node ai/tools/export_fishdb.mjs js > backend/seed/fishdb.json
cd backend && python build_db.py
```

## RAG-пайплайн

1. **Retrieval** (`rag.candidates`) — виды, реально вероятные для `water_type` + широты
   (по `waters_affinity` × широтный ареал), топ-N.
2. **Augment** (`rag.corpus_for_analyze` / `corpus_for_tactics`) — для кандидатов
   собираются карточки `knowledge` + факторные правила `behavior`.
3. **Generation** (`claude_client`) — промпт с фактами → Claude → строгий JSON.
   При любой ошибке — откат на `engine` (local).

## Эндпоинты

### `GET /api/health`
```json
{ "ok": true, "claude": false, "db": "/srv/klevgid/backend/klevgid.db", "species": 22 }
```

### `POST /api/ai/analyze` — какая рыба здесь водится
Запрос:
```json
{ "profile": { "type": "pond", "lat": 55.7, "sizeClass": "tiny",
               "connectivity": 0.0, "reeds": true, "dataQuality": "osm" },
  "month": 5, "waterTemp": 19, "provider": null }
```
Ответ:
```json
{ "provider": "claude|local", "dataQuality": "osm", "summary": "…",
  "top": "карась, линь, …",
  "species": [ { "id": "crucian", "name": "Карась", "confidence": 0.86,
                 "rationale": "…", "evidence": ["…"] } ],
  "notes": ["…"], "sources": ["…"] }
```
`confidence` (0..1) уходит на фронт и управляет «потолком честности» прогноза клёва. Виды
строго фильтруются по региону + типу водоёма: в изолированном пруду нет судака/сома/жереха.

### `POST /api/ai/tactics` — тактика + честный прогноз шанса
Запрос:
```json
{ "species": "zander",
  "profile": { "type": "river_big", "lat": 51.5, "connectivity": 1.0, "linear": true },
  "weather": { "waterTemp": 16, "pressureMm": 748, "pressureTrend": -1,
               "windMs": 3, "clouds": 60 },
  "month": 8, "period": "dusk", "tackle": "spinning", "baits": ["jig"] }
```
Ответ:
```json
{ "provider": "claude|local", "species": { "id": "zander", "name": "Судак" },
  "chancePct": 71, "verdict": { "title": "…", "phrase": "…" },
  "tactics": [ { "title": "Где искать", "text": "…" } ],
  "baits": [ { "name": "джиг/силикон", "score": 0.9, "why": "…" } ],
  "spots": [ { "title": "Дальше от берега", "tip": "…" } ],
  "rationale": "…", "sources": ["…"] }
```
`chancePct` — реальный прогноз по виду + водоёму + температуре + погоде + времени. Если вид
для этого водоёма неправдоподобен — шанс честно задавливается (≤14 %), вердикт «Не та рыба».
Неизвестный `species` → 404.

## Выбор провайдера и модели

- `provider`: `null`/`auto` — Claude при наличии ключа, иначе local; `"local"` — форсировать
  движок; `"claude"` — только Claude.
- Модели (env): `KLEVGID_MODEL_ANALYZE` (по умолчанию Haiku — быстро/дёшево),
  `KLEVGID_MODEL_TACTICS` (по умолчанию Sonnet — качественнее).
- При сбое Claude эндпоинт возвращает `provider:"local"` и продолжает работать (200, не 5xx).

## Запуск

```bash
cd backend
pip install -r requirements.txt
python build_db.py
export ANTHROPIC_API_KEY=sk-ant-...        # без него — local-режим
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Переменные: `ANTHROPIC_API_KEY`, `KLEVGID_MODEL_ANALYZE`, `KLEVGID_MODEL_TACTICS`,
`KLEVGID_CORS` (домены через запятую), `KLEVGID_DB` (путь к базе). См. `.env.example`.

## Интеграция с фронтендом

`js/ai-analyst.js`: `AI_CONFIG.provider = "auto"`. На сессию делается один лёгкий пробник
`/api/health` (`backendAvailable`, таймаут 2 с); если бэкенд доступен — разбор идёт через
`/api/ai/analyze`, а на шаге результата тактика и прогноз уточняются через `/api/ai/tactics`
(прогрессивно: локальный результат показывается сразу, ответ бэкенда заменяет его). Любой сбой
или отсутствие бэкенда — мгновенный откат на локальный движок. Базовый URL бэкенда —
`AI_CONFIG.base` (пусто = тот же origin, удобно за nginx).

## Деплой (кратко)

uvicorn как systemd-сервис на `127.0.0.1:8000`, nginx проксирует `location /api/` на него;
ключ — в `Environment=` юнита (не в git). Полностью — в `07-deployment.md`.

## Тесты

```bash
cd backend
KLEVGID_DB=/tmp/klevgid.db python build_db.py
KLEVGID_DB=/tmp/klevgid.db python test_api.py
```
Проверяют: загрузку базы, фильтр видов по водоёму (пруд без судака; река с судаком/жерехом),
прогноз тактики в диапазоне, ранжирование насадок, потолок честности (судак в пруду ≤14 %),
404 на неизвестный вид.
