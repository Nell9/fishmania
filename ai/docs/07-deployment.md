# 07 · Развёртывание на сервере

Проект — статика: достаточно отдать файлы любым веб-сервером. Node/PHP/БД не нужны. Готовый конфиг лежит в репозитории: **`deploy/nginx.conf`** (раздача по голому IP, default_server).

## Вариант A — VPS + nginx по IP (основной сценарий)

Свежий Ubuntu 22.04/24.04, доступ root/sudo. Все запросы `http://<IP>` будут попадать на сайт.

```bash
# 1. Пакеты
sudo apt update && sudo apt install -y nginx git

# 2. Код сайта
sudo git clone https://github.com/Nell9/fishmania.git /var/www/fishmania
#    (приватный репозиторий — понадобится PAT или деплой-ключ; либо просто
#     скопируйте папку с компьютера: scp -r ./fishing user@IP:/tmp && sudo mv /tmp/fishing /var/www/fishmania)

# 3. Конфиг nginx из репозитория
sudo cp /var/www/fishmania/deploy/nginx.conf /etc/nginx/sites-available/fishmania
sudo ln -s /etc/nginx/sites-available/fishmania /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default     # иначе дефолтная страница перехватит IP

# 4. Проверка и запуск
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl enable nginx

# 5. Файрвол (если включён ufw)
sudo ufw allow 'Nginx Full'      # 80 и 443
```

Проверка: открыть `http://<IP-сервера>/` — сайт должен работать целиком (карта, погода, прогноз). Конфиг уже: прячет `ai/`, `deploy/`, `.git`, `*.bat|ps1|md` от посетителей, включает gzip, кэш статики на 7 дней и базовые security-заголовки.

### Обновление сайта

```bash
cd /var/www/fishmania && sudo git pull
# кэш у посетителей обновится сам максимум через 7 дней; форсировать: Ctrl+F5
```

### ⚠️ Геолокация и голый HTTP

Браузеры разрешают `navigator.geolocation` только в **secure context** (HTTPS или localhost). На `http://<IP>` кнопка «Моё местоположение» молча не сработает — это ограничение браузера, не бага. Работают: клик по карте и ручной ввод координат. Варианты получить HTTPS:

1. **Домен + Let's Encrypt (правильный путь):** направить A-запись домена на IP, затем `sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d ваш-домен.ru` (на голый IP Let's Encrypt сертификаты не выдаёт).
2. **Self-signed на IP (для себя):** браузер покажет предупреждение, но геолокация заработает после принятия сертификата:

```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/fishmania.key -out /etc/ssl/certs/fishmania.crt \
  -subj "/CN=$(curl -s ifconfig.me)" -addext "subjectAltName=IP:$(curl -s ifconfig.me)"
```

и добавить в server-блок: `listen 443 ssl default_server; ssl_certificate /etc/ssl/certs/fishmania.crt; ssl_certificate_key /etc/ssl/private/fishmania.key;`

## Защита от DDoS и ботов (лёгкая, без капч и регистраций)

Три слоя, все невидимы для обычных посетителей. Готовые файлы — в `deploy/`. Применить на сервере из папки сайта:

```bash
sudo cp deploy/nginx-ratelimit.conf /etc/nginx/conf.d/
sudo cp deploy/nginx.conf /etc/nginx/sites-available/fishmania
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y fail2ban
sudo cp deploy/fail2ban-jail.local /etc/fail2ban/jail.d/fishmania.local
sudo systemctl restart fail2ban && sudo fail2ban-client status
```

| Слой | Что делает |
|---|---|
| Лимиты nginx (`limit_req` 10 r/s + burst 30, `limit_conn` 20) | Страница целиком — ~10 запросов, человек лимит не замечает даже при жадном F5. Бот-долбилка получает 429 и не грузит диск/канал. |
| Фильтр ботов и проб | Сканеры по User-Agent (sqlmap, nikto, masscan, nuclei…), пустой UA, типовые пробы (`/wp-admin`, `*.php`, `/phpmyadmin`…) → код 444: nginx молча рвёт соединение, не тратя ресурсы. curl/wget не блокируются — удобно проверять сайт самому. |
| fail2ban | Кто продолжает долбить после лимитов — бан IP на файрволе на 10 мин (поймает по error-логу). Заодно защита SSH от брутфорса (5 попыток → бан на час). |

Также в конфиге: `client_max_body_size 16k` (сайт ничего не принимает) и короткие таймауты заголовков/тела против slowloris-висяков.

**Честно про пределы.** Настоящий объёмный DDoS (десятки Гбит/с) одним VPS не останавливается ничем — это уровень DDoS-защиты хостера (у многих включается бесплатно в панели) или CDN. Cloudflare (бесплатный тариф) добавит и защиту, и HTTPS, но требует домен — по голому IP не работает. Против ботов, парсеров и бытовых «флудилок» слоёв выше достаточно.

**Проверка после включения:**

```bash
curl -A "sqlmap" http://ВАШ_IP/        # соединение сбросится без ответа
for i in $(seq 1 60); do curl -so /dev/null -w "%{http_code} " http://ВАШ_IP/; done   # пойдут 429
sudo fail2ban-client status nginx-limit-req   # список забаненных
```

## Вариант B — Docker

```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
```

```bash
docker build -t klevgid . && docker run -d -p 8080:80 klevgid
```

## Вариант C — статические хостинги

GitHub Pages / Cloudflare Pages / Netlify: залить папку как есть, без команд сборки.

## Чек-лист после деплоя

1. **HTTPS работает** (если нужна геолокация) — `navigator.geolocation` доступна только в secure context.
2. Карта грузится (тайлы openstreetmap.org не блокируются).
3. Шаг 3 получает погоду (запрос к api.open-meteo.com из консоли браузера — 200).
4. `ai/` и `deploy/` не открываются снаружи — конфиг nginx закрывает их сам.

## Полностью автономный вариант (без внешних CDN)

При желании убрать зависимость от CDN:

1. Скачать `leaflet.min.css`, `leaflet.min.js` в `vendor/leaflet/` и заменить 2 ссылки в `index.html`.
2. Скачать woff2 Lora и Inter, подключить через `@font-face` в `style.css` вместо Google Fonts.
3. Тайлы и Open-Meteo остаются внешними (это сами данные); для интранета предусмотрен ручной режим условий.

## Обновление данных рыб

Вся база — `js/fishdb.js`. Правка файла + сброс кэша (`Ctrl+F5` или подняли `expires`) — никакой пересборки.

## AI-бэкенд (uvicorn + nginx + systemd)

Опциональный слой (`backend/`). Без него сайт работает в локальном режиме; с ним разбор и
тактику считает Claude. Ключ — только в окружении сервиса, в git не попадает.

### 1. Установка

```bash
cd /srv/klevgid/backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python build_db.py            # создаёт klevgid.db из seed/fishdb.json
```

### 2. systemd-юнит `/etc/systemd/system/klevgid-api.service`

```ini
[Unit]
Description=KlevGid AI backend
After=network.target

[Service]
WorkingDirectory=/srv/klevgid/backend
Environment=ANTHROPIC_API_KEY=sk-ant-...
Environment=KLEVGID_MODEL_ANALYZE=claude-haiku-4-5-20251001
Environment=KLEVGID_MODEL_TACTICS=claude-sonnet-4-6
Environment=KLEVGID_CORS=*
ExecStart=/srv/klevgid/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now klevgid-api
curl localhost:8000/api/health
```

### 3. nginx — проксирование `/api/`

В `server { … }` рядом с раздачей статики:

```nginx
location /api/ {
    proxy_pass         http://127.0.0.1:8000;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_read_timeout 60s;
}
```

Если фронт и API на одном домене, `AI_CONFIG.base` оставить пустым (тот же origin). Ключ
храните только в юните (или `EnvironmentFile=`), не в репозитории. Обновление базы знаний после
правок данных: `node ai/tools/export_fishdb.mjs js > backend/seed/fishdb.json && python build_db.py`,
затем `systemctl restart klevgid-api`.
