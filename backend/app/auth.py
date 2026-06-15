"""Регистрация, вход, сессии. Только stdlib (hashlib pbkdf2, secrets).

Пароли — PBKDF2-HMAC-SHA256, 200k итераций, на пользователя своя соль.
Сессия — случайный токен (Bearer), срок 30 дней, хранится в таблице sessions.
Админ — отдельная HTTP Basic авторизация по KLEVGID_ADMIN_PASSWORD (env, не в git).
"""
import datetime as _dt
import hashlib
import hmac
import os
import secrets

from . import appdb

PBKDF_ITERS = 200_000
SESSION_DAYS = 30
ADMIN_USER = os.environ.get("KLEVGID_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("KLEVGID_ADMIN_PASSWORD", "")


def _now():
    return _dt.datetime.utcnow().replace(microsecond=0).isoformat()


def _hash(password: str, salt: str) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF_ITERS)
    return dk.hex()


def valid_email(email: str) -> bool:
    email = (email or "").strip()
    return 3 < len(email) <= 254 and "@" in email and "." in email.split("@")[-1] and " " not in email


def register(email: str, password: str) -> dict:
    email = (email or "").strip().lower()
    if not valid_email(email):
        raise ValueError("Введите корректный email")
    if len(password or "") < 6:
        raise ValueError("Пароль должен быть не короче 6 символов")
    c = appdb.connect()
    if c.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        raise ValueError("Пользователь с таким email уже зарегистрирован")
    salt = secrets.token_hex(16)
    role = "admin" if email == os.environ.get("KLEVGID_ADMIN_EMAIL", "").strip().lower() and email else "user"
    cur = c.execute(
        "INSERT INTO users(email, pw_hash, pw_salt, role, created_at) VALUES(?,?,?,?,?)",
        (email, _hash(password, salt), salt, role, _now()),
    )
    c.commit()
    return {"id": cur.lastrowid, "email": email, "role": role}


def login(email: str, password: str) -> str:
    email = (email or "").strip().lower()
    c = appdb.connect()
    row = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row or not hmac.compare_digest(_hash(password, row["pw_salt"]), row["pw_hash"]):
        raise ValueError("Неверный email или пароль")
    c.execute("UPDATE users SET last_login=? WHERE id=?", (_now(), row["id"]))
    token = secrets.token_urlsafe(32)
    exp = (_dt.datetime.utcnow() + _dt.timedelta(days=SESSION_DAYS)).replace(microsecond=0).isoformat()
    c.execute("INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?,?,?,?)",
              (token, row["id"], _now(), exp))
    c.commit()
    return token


def user_for_token(token: str):
    """Возвращает dict пользователя по валидному токену сессии или None."""
    if not token:
        return None
    c = appdb.connect()
    s = c.execute("SELECT * FROM sessions WHERE token=?", (token,)).fetchone()
    if not s or s["expires_at"] < _now():
        return None
    u = c.execute("SELECT id, email, role FROM users WHERE id=?", (s["user_id"],)).fetchone()
    return dict(u) if u else None


def logout(token: str):
    if not token:
        return
    c = appdb.connect()
    c.execute("DELETE FROM sessions WHERE token=?", (token,))
    c.commit()


def bearer_token(authorization: str | None) -> str:
    if not authorization:
        return ""
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return authorization.strip()


def check_admin(authorization: str | None) -> bool:
    """HTTP Basic: проверяем логин/пароль админа из окружения сервиса."""
    if not ADMIN_PASSWORD:
        return False
    if not authorization or not authorization.lower().startswith("basic "):
        return False
    import base64
    try:
        raw = base64.b64decode(authorization.split(None, 1)[1]).decode("utf-8")
        user, _, pw = raw.partition(":")
    except Exception:
        return False
    return hmac.compare_digest(user, ADMIN_USER) and hmac.compare_digest(pw, ADMIN_PASSWORD)
