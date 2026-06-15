"""Точка входа сервиса: базовый app из main.py + расширения (регистрация, гейтинг AI,
трекинг, админ-статистика). main.py не изменяется.

Запуск: uvicorn app.server:app
"""
from .main import app  # готовый FastAPI с /api/health, /api/ai/analyze, /api/ai/tactics
from . import api_ext, appdb  # noqa: F401  (appdb создаёт схему при импорте)

# Гейтинг: /api/ai/* — только зарегистрированным
app.middleware("http")(api_ext.ai_gate)

# Новые эндпоинты: auth, track, admin
app.include_router(api_ext.router)
