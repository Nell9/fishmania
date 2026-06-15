# 13 · Регистрация, гейтинг AI и админ-статистика (v1.3.0)

Серверное расширение поверх AI-бэкенда (`backend/app/server.py` оборачивает `main.py`,
не меняя его). Добавляет: регистрацию, доступ к нейросети только зарегистрированным,
закрытую страницу статистики и импорт/экспорт статистики в JSON.

## Что добавилось

| Возможность | Как |
|---|---|
| Регистрация / вход | `POST /api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`. Пароли — PBKDF2-HMAC-SHA256 (200k), сессия — Bearer-токен на 30 дней. |
| AI только после регистрации | middleware `ai_gate`: запрос к `/api/ai/*` без валидного токена → `401 registration_required`. Фронт (`js/klev-auth.js`) ловит 401 и открывает окно регистрации. |
| Аналитика посещений | `POST /api/track` принимает события от `js/klev-tracker.js`: просмотры, клики («что нажимали»), время на сайте. IP и гео (страна/город/провайдер, ip-api.com с кэшем) определяются на сервере. |
| Закрытая статистика | `GET /admin` — дашборд, HTTP Basic (`KLEVGID_ADMIN_USER`/`KLEVGID_ADMIN_PASSWORD`). Виден только владельцу. После входа — admin-cookie на 12 ч. |
| Экспорт / импорт JSON | `GET /api/admin/export` (скачать), `POST /api/admin/import` (загрузить и слить). Формат `klevgid-stats-v1`. |

## Файлы

```
backend/app/
  server.py       точка входа: main.app + router + ai_gate (uvicorn app.server:app)
  appdb.py        записываемый SQLite (users, sessions, visitors, events, geo_cache)
  auth.py         регистрация/вход/сессии, проверка админа (Basic)
  analytics.py    запись событий, гео по IP, агрегаты, export/import JSON
  api_ext.py      эндпоинты auth/track/admin + middleware ai_gate
  admin.html      дашборд статистики (карточки, таблицы, кнопки экспорт/импорт)
js/
  klev-auth.js    модалка регистрации/входа, заголовки к /api/, перехват 401 на AI
  klev-tracker.js аналитика: pageview, клики, время на сайте (sendBeacon)
```

База приложения отдельна от базы знаний: `KLEVGID_APP_DB` (по умолч. `/var/lib/klevgid/app.db`),
`klevgid.db` остаётся read-only.

## Приватность

Сохраняются IP-адреса посетителей и их геолокация — это персональные данные. Доступ к ним
закрыт паролем (только владелец). Учитывайте требования законодательства вашего региона.

## Деплой / эксплуатация

Сервис запускается как `uvicorn app.server:app` (см. `deploy/klevgid-api.service`). Переменные
окружения (`backend/.env.example`): транспорт Claude, модель, `KLEVGID_APP_DB`,
`KLEVGID_ADMIN_USER/PASSWORD`. nginx проксирует `/api/` и `/admin` на `127.0.0.1:8000`
(`deploy/nginx.conf`), для `/api/` поднят `client_max_body_size 12m` под импорт.

```bash
# сменить пароль админа:
sudoedit /etc/klevgid/klevgid.env          # KLEVGID_ADMIN_PASSWORD=...
systemctl restart klevgid-api
# открыть статистику: http://<IP>/admin  (логин admin, пароль из env)
```
