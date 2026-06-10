# 04 · Внешние API

Все API бесплатны и не требуют ключей. Запросы идут напрямую из браузера (CORS открыт).

## Open-Meteo Forecast — погода

`GET https://api.open-meteo.com/v1/forecast`

| Параметр | Значение |
|---|---|
| `latitude, longitude` | точка пользователя, 4 знака |
| `current` | temperature_2m, apparent_temperature, is_day, precipitation, weather_code, cloud_cover, surface_pressure, wind_speed_10m, wind_direction_10m, wind_gusts_10m, relative_humidity_2m |
| `hourly` | temperature_2m, surface_pressure, cloud_cover, precipitation, wind_speed_10m, is_day |
| `daily` | sunrise, sunset, temperature_2m_max, temperature_2m_min |
| `past_days=7` | прошлая неделя — топливо модели температуры воды |
| `forecast_days=2` | сутки почасового прогноза активности |
| `timezone=auto` | все времена приходят в локальном времени точки |
| `wind_speed_unit=ms` | м/с |

Ответ: `current{...}`, `hourly{time[], …[]}` (параллельные массивы), `daily{...}`. Давление приходит в гПа → перевод в мм рт. ст.: `× 0.750062`. `daily.sunrise[7]` — сегодняшний восход (7 прошлых дней + сегодня + завтра).

Лимиты: ~10 000 запросов/сутки на IP — для клиентского использования более чем достаточно. Таймаут запроса 14 с, при ошибке UI переходит в ручной режим.

## Nominatim — обратное геокодирование

`GET https://nominatim.openstreetmap.org/reverse?lat=…&lon=…&format=jsonv2&zoom=12&accept-language=ru`

Только для подписи места («Кстово, Нижегородская обл.»). Необязательный: при ошибке показываются координаты. Политика Nominatim: ≤1 rps — у нас 1 запрос на установку точки.

## OpenStreetMap тайлы + Leaflet

- Тайлы: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, атрибуция обязательна (есть в карте).
- Leaflet 1.9.4 с cdnjs. Маркер — кастомный `divIcon` (SVG), чтобы не зависеть от путей к картинкам Leaflet.

## Google Fonts

Lora (заголовки) + Inter (UI), оба с кириллицей. При недоступности — системные Georgia/sans-serif фолбэки.

## Самостоятельный хостинг зависимостей

Для полностью автономного деплоя см. 07-deployment.md: Leaflet и шрифты можно положить рядом со статикой, заменив 4 ссылки в `index.html`.
