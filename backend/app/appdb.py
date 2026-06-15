"""Записываемая БД приложения: пользователи, сессии, аналитика посещений.

Отдельный SQLite-файл (KLEVGID_APP_DB) — НЕ трогает read-only базу знаний klevgid.db.
Схема создаётся при импорте (идемпотентно). Без ORM, только stdlib.

Таблицы:
  users      — зарегистрированные пользователи (email + хэш пароля), роль user|admin
  sessions   — токены сессий (Bearer), срок жизни
  visitors   — уникальные посетители (anon_id из localStorage): IP, гео, UA, реферер, время на сайте
  events     — поток событий (pageview/click/step/ai/...) с IP и меткой
  geo_cache  — кэш геолокации по IP (чтобы не дёргать внешний сервис каждый раз)
"""
import os
import sqlite3
import threading

DEFAULT = "/var/lib/klevgid/app.db"
APP_DB_PATH = os.environ.get("KLEVGID_APP_DB", DEFAULT)

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT UNIQUE NOT NULL,
  pw_hash    TEXT NOT NULL,
  pw_salt    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS visitors (
  anon_id    TEXT PRIMARY KEY,
  first_seen TEXT,
  last_seen  TEXT,
  ip         TEXT,
  country    TEXT,
  region     TEXT,
  city       TEXT,
  isp        TEXT,
  user_agent TEXT,
  referrer   TEXT,
  user_id    INTEGER,
  email      TEXT,
  total_ms   INTEGER DEFAULT 0,
  events     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_visitors_ip ON visitors(ip);
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT,
  anon_id TEXT,
  user_id INTEGER,
  email   TEXT,
  ip      TEXT,
  type    TEXT,
  label   TEXT,
  path    TEXT,
  meta    TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_anon ON events(anon_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS geo_cache (
  ip      TEXT PRIMARY KEY,
  country TEXT,
  region  TEXT,
  city    TEXT,
  isp     TEXT,
  ts      TEXT
);
"""


def connect():
    """Одно соединение на поток (uvicorn worker)."""
    c = getattr(_local, "conn", None)
    if c is None:
        os.makedirs(os.path.dirname(APP_DB_PATH) or ".", exist_ok=True)
        c = sqlite3.connect(APP_DB_PATH, check_same_thread=False, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=5000")
        _local.conn = c
    return c


def init():
    c = connect()
    c.executescript(SCHEMA)
    c.commit()


# Инициализация при импорте модуля.
try:
    init()
except Exception as _e:  # noqa: BLE001 — не валим импорт, ошибку увидим в health
    print("appdb init error:", _e)
