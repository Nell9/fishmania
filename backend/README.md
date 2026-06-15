# КлёвГид — AI-бэкенд (FastAPI + SQLite + RAG)

Тонкий сервис: по точке/водоёму и условиям отдаёт **разбор видового состава** и
**тактику + честный прогноз клёва**. Знания о повадках рыб лежат в SQLite; релевантные
факты подмешиваются в промпт Claude (RAG). Без ключа всё работает в детерминированном
`local`-режиме (тот же научный движок, что и на фронте) — сайт никогда не остаётся без ответа.

Полное описание: [`../ai/docs/12-backend.md`](../ai/docs/12-backend.md).

## Быстрый старт

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate      # опционально
pip install -r requirements.txt
python build_db.py                                  # создаст klevgid.db из seed/fishdb.json
export ANTHROPIC_API_KEY=sk-ant-...                 # на сервере; без него — local-режим
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Проверка: `curl localhost:8000/api/health`

## Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | статус, доступность Claude, число видов в базе |
| POST | `/api/ai/analyze` | какая рыба реально водится (проценты, обоснование) |
| POST | `/api/ai/tactics` | тактика + прогноз шанса по виду + водоёму + погоде |

Контракты запросов/ответов — в `app/schemas.py`; примеры — в `12-backend.md`.

## База знаний

`build_db.py` собирает `klevgid.db` из `seed/fishdb.json` (срез данных фронтенда):
таблицы `species`, `waters_affinity`, `region_presence`, `baits`, `behavior` (факторные
научные правила для RAG), `sources`. Обновить срез: `node ai/tools/export_fishdb.mjs js > backend/seed/fishdb.json`,
затем `python build_db.py`.

## Тесты

```bash
KLEVGID_DB=/tmp/klevgid.db python build_db.py
KLEVGID_DB=/tmp/klevgid.db python -m pytest test_api.py -q   # или: python test_api.py
```

## Деплой

uvicorn за nginx (`/api/` → `127.0.0.1:8000`), ключ в окружении сервиса (systemd).
Подробности и пример unit-файла — в `12-backend.md` и `07-deployment.md`.

## Claude через CLI (без API-ключа)

Если у тебя нет API-ключа, используй Claude Code CLI с авторизацией по подписке:

```bash
npm install -g @anthropic-ai/claude-code   # нужен Node 18+
claude                                       # затем /login — вход по подписке Pro/Max
# проверка: claude -p "ответь словом ok" --output-format json

# запуск бэкенда на CLI-транспорте:
set KLEVGID_AI_TRANSPORT=cli     &  rem Windows (cmd)
# export KLEVGID_AI_TRANSPORT=cli   # Linux/macOS
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`GET /api/health` покажет `"transport":"cli"`. Модель по умолчанию — Haiku.
На сервере вместо интерактивного `/login`: `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`.
Подробности и нюансы — в `../ai/docs/12-backend.md`.
