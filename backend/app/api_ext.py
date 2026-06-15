"""Расширение API: регистрация/вход, гейтинг AI по регистрации, трекинг, админ-статистика.

Подключается из server.py поверх готового app (main.py не меняется).
  - /api/auth/register, /api/auth/login, /api/auth/me, /api/auth/logout
  - /api/track                          — приём событий аналитики от фронта
  - middleware ai_gate                  — /api/ai/* доступно только зарегистрированным
  - /admin  (HTTP Basic)                — закрытая страница статистики (только владелец)
  - /api/admin/stats|export|import      — данные для админки (Basic или admin-cookie)
"""
import datetime as _dt
import json
import os
import secrets
import time

from fastapi import APIRouter, Body, Request, Response
from fastapi.responses import JSONResponse, HTMLResponse, PlainTextResponse
from pydantic import BaseModel

from . import auth, analytics

router = APIRouter()

# --- админ-сессии (cookie) в памяти процесса ---
_admin_tokens: dict[str, float] = {}
ADMIN_TTL = 12 * 3600


def client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


def _user(request: Request):
    return auth.user_for_token(auth.bearer_token(request.headers.get("authorization")))


# ============ AUTH ============
class Creds(BaseModel):
    email: str
    password: str


@router.post("/api/auth/register")
def register(body: Creds, request: Request):
    try:
        u = auth.register(body.email, body.password)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    token = auth.login(body.email, body.password)
    analytics.record(request.headers.get("x-anon-id", ""), client_ip(request),
                     request.headers.get("user-agent", ""), request.headers.get("referer", ""),
                     [{"type": "auth", "label": "register"}], user=u)
    return {"token": token, "email": u["email"], "role": u["role"]}


@router.post("/api/auth/login")
def login(body: Creds, request: Request):
    try:
        token = auth.login(body.email, body.password)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=401)
    u = auth.user_for_token(token)
    analytics.record(request.headers.get("x-anon-id", ""), client_ip(request),
                     request.headers.get("user-agent", ""), request.headers.get("referer", ""),
                     [{"type": "auth", "label": "login"}], user=u)
    return {"token": token, "email": u["email"], "role": u["role"]}


@router.get("/api/auth/me")
def me(request: Request):
    u = _user(request)
    if not u:
        return JSONResponse({"error": "not authenticated"}, status_code=401)
    return u


@router.post("/api/auth/logout")
def logout(request: Request):
    auth.logout(auth.bearer_token(request.headers.get("authorization")))
    return {"ok": True}


# ============ TRACK ============
@router.post("/api/track")
async def track(request: Request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    events = payload.get("events") or []
    anon = payload.get("anon") or request.headers.get("x-anon-id", "")
    u = _user(request)
    n = analytics.record(anon, client_ip(request), request.headers.get("user-agent", ""),
                         request.headers.get("referer", ""), events, user=u)
    return {"ok": True, "recorded": n}


# ============ AI GATE (middleware) ============
async def ai_gate(request: Request, call_next):
    """Доступ к /api/ai/* — только зарегистрированным (есть валидный токен)."""
    path = request.url.path
    if path.startswith("/api/ai/"):
        u = _user(request)
        if not u:
            return JSONResponse(
                {"error": "registration_required",
                 "message": "AI-анализ доступен после регистрации. Зарегистрируйтесь или войдите."},
                status_code=401)
        # лог использования AI
        try:
            analytics.record(request.headers.get("x-anon-id", ""), client_ip(request),
                             request.headers.get("user-agent", ""), request.headers.get("referer", ""),
                             [{"type": "ai", "label": path.rsplit("/", 1)[-1]}], user=u)
        except Exception:
            pass
    return await call_next(request)


# ============ ADMIN ============
def _admin_ok(request: Request) -> bool:
    if auth.check_admin(request.headers.get("authorization")):
        return True
    tok = request.cookies.get("klev_admin")
    exp = _admin_tokens.get(tok or "")
    return bool(exp and exp > time.time())


def _need_admin():
    return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="KlevGid Admin"'})


@router.get("/admin")
def admin_page(request: Request):
    if not _admin_ok(request):
        return _need_admin()
    tok = secrets.token_urlsafe(24)
    _admin_tokens[tok] = time.time() + ADMIN_TTL
    try:
        html = open(os.path.join(os.path.dirname(__file__), "admin.html"), encoding="utf-8").read()
    except Exception as e:  # noqa: BLE001
        return PlainTextResponse(f"admin.html missing: {e}", status_code=500)
    resp = HTMLResponse(html)
    resp.set_cookie("klev_admin", tok, max_age=ADMIN_TTL, httponly=True, samesite="strict", path="/")
    return resp


@router.get("/api/admin/stats")
def admin_stats(request: Request):
    if not _admin_ok(request):
        return _need_admin()
    return analytics.stats()


@router.get("/api/admin/export")
def admin_export(request: Request):
    if not _admin_ok(request):
        return _need_admin()
    data = analytics.export_json()
    fname = "klevgid-stats-%s.json" % _dt.date.today().isoformat()
    return Response(json.dumps(data, ensure_ascii=False, indent=1),
                    media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.post("/api/admin/import")
async def admin_import(request: Request):
    if not _admin_ok(request):
        return _need_admin()
    try:
        data = await request.json()
        counts = analytics.import_json(data)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": f"Не удалось импортировать: {e}"}, status_code=400)
    return {"ok": True, "imported": counts}
