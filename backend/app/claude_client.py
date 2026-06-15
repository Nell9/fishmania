"""Тонкий клиент Claude: транспорт CLI (Claude Code, без API-ключа) или SDK.

KLEVGID_AI_TRANSPORT:
  auto — CLI при наличии бинаря `claude`, иначе SDK при ANTHROPIC_API_KEY, иначе local (по умолчанию)
  cli  — Claude Code CLI (`claude -p … --output-format json`); авторизация по подписке
         (`claude` → /login, либо CLAUDE_CODE_OAUTH_TOKEN). API-ключ НЕ нужен.
  sdk  — официальный Anthropic SDK (нужен ANTHROPIC_API_KEY)
  off  — только локальный движок

Модель по умолчанию — Haiku (KLEVGID_MODEL_ANALYZE / KLEVGID_MODEL_TACTICS).
При любой ошибке вызывающий код (main.py) откатывается на engine.py (local).
Документация: ai/docs/12-backend.md
"""
import json
import os
import re
import shutil
import subprocess
import tempfile

MODEL_ANALYZE = os.environ.get("KLEVGID_MODEL_ANALYZE", "claude-haiku-4-5-20251001")
MODEL_TACTICS = os.environ.get("KLEVGID_MODEL_TACTICS", "claude-haiku-4-5-20251001")
TRANSPORT = os.environ.get("KLEVGID_AI_TRANSPORT", "auto").lower()
CLAUDE_BIN = os.environ.get("KLEVGID_CLAUDE_BIN", "claude")
CLI_TIMEOUT = int(os.environ.get("KLEVGID_CLI_TIMEOUT", "60"))


def cli_available() -> bool:
    return shutil.which(CLAUDE_BIN) is not None


def sdk_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def transport() -> str:
    """Какой транспорт реально будет использован: cli | sdk | off."""
    if TRANSPORT in ("cli", "sdk", "off"):
        return TRANSPORT
    if cli_available():
        return "cli"
    if sdk_available():
        return "sdk"
    return "off"


def available() -> bool:
    return transport() in ("cli", "sdk")


def _extract_json(text: str) -> dict:
    """Достаёт JSON-объект из ответа модели (срезает ```-ограждения и текст вокруг)."""
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    try:
        return json.loads(t)
    except Exception:
        i, j = t.find("{"), t.rfind("}")
        if i >= 0 and j > i:
            return json.loads(t[i:j + 1])
        raise


# ---------- Транспорт SDK ----------
def _call_sdk(model: str, system: str, prompt: str, max_tokens: int = 1600) -> dict:
    from anthropic import Anthropic  # ленивый импорт — для CLI/local пакет не нужен
    msg = Anthropic().messages.create(
        model=model, max_tokens=max_tokens, system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
    return _extract_json("\n".join(parts))


# ---------- Транспорт CLI (Claude Code) ----------
def _claude_argv(args):
    # На Windows `claude` — это claude.cmd; запускаем через `cmd /c`.
    if os.name == "nt":
        return ["cmd", "/c", CLAUDE_BIN, *args]
    return [CLAUDE_BIN, *args]


def _call_cli(model: str, system: str, prompt: str) -> dict:
    """Вызов Claude Code CLI. Системную часть и данные передаём через stdin
    (без длинных аргументов — безопасно и на Windows, и на POSIX)."""
    full = system + "\n\n" + prompt
    argv = _claude_argv([
        "-p", "Follow the instructions in stdin and return ONLY strict JSON.",
        "--output-format", "json",
        "--model", model,
    ])
    try:
        r = subprocess.run(
            argv, input=full, capture_output=True, text=True, encoding="utf-8",
            timeout=CLI_TIMEOUT, env={**os.environ}, cwd=tempfile.gettempdir(),
        )
    except FileNotFoundError as e:
        raise RuntimeError(f"claude CLI не найден ({CLAUDE_BIN}): {e}")
    if r.returncode != 0:
        raise RuntimeError(f"claude CLI rc={r.returncode}: {(r.stderr or r.stdout or '')[:300]}")
    out = (r.stdout or "").strip()
    try:
        payload = json.loads(out)
    except Exception:
        return _extract_json(out)  # на случай нестандартного вывода
    if isinstance(payload, dict):
        if payload.get("is_error") or payload.get("subtype") in ("error_max_turns", "error_during_execution"):
            raise RuntimeError(f"claude CLI error: {str(payload)[:300]}")
        return _extract_json(payload.get("result", out))
    return _extract_json(out)


def _call(model: str, system: str, prompt: str, max_tokens: int = 1600) -> dict:
    t = transport()
    if t == "cli":
        return _call_cli(model, system, prompt)
    if t == "sdk":
        return _call_sdk(model, system, prompt, max_tokens)
    raise RuntimeError("AI-транспорт выключен: нет CLI `claude` и нет ANTHROPIC_API_KEY")


SYSTEM_ANALYZE = (
    "Ты ихтиолог-аналитик рыболовного сервиса. По фактам о водоёме и справке об экологии видов "
    "определи, какие рыбы реально могут водиться в этой точке, и оцени уверенность 0..1. "
    "Опирайся ТОЛЬКО на приведённые факты; если данных мало — рассуждай по типу водоёма, ареалу, "
    "размеру, связи с рекой и кислородному режиму. Не выдумывай глубину и точные числа, которых нет. "
    "Верни СТРОГО JSON без пояснений: "
    '{"summary": str, "species": [{"id": str, "name": str, "confidence": number, '
    '"rationale": str, "evidence": [str]}], "notes": [str]}.'
)

SYSTEM_TACTICS = (
    "Ты опытный рыболов-эксперт и ихтиолог. По виду рыбы, профилю водоёма и текущим условиям "
    "(температура воды, погода, давление, ветер, время суток, сезон) и приведённым научным фактам о "
    "повадках дай практичную тактику и ЧЕСТНЫЙ прогноз шанса клёва 0..100. Не выдумывай глубину, "
    "если её нет в данных. Верни СТРОГО JSON без пояснений: "
    '{"chancePct": int, "verdict": {"title": str, "phrase": str}, '
    '"tactics": [{"title": str, "text": str}], "baits": [{"name": str, "score": number, "why": str}], '
    '"spots": [{"title": str, "tip": str}], "rationale": str}.'
)


def analyze(profile: dict, corpus: str) -> dict:
    prompt = (
        "## Факты о водоёме\n" + _facts(profile) +
        "\n\n## Справка по экологии видов-кандидатов\n" + corpus +
        "\n\nВерни только виды, реально вероятные для этого водоёма и широты."
    )
    return _call(MODEL_ANALYZE, SYSTEM_ANALYZE, prompt)


def tactics(species_name: str, profile: dict, conditions: str, corpus: str) -> dict:
    prompt = (
        f"## Вид\n{species_name}\n\n## Факты о водоёме\n" + _facts(profile) +
        "\n\n## Текущие условия\n" + conditions +
        "\n\n## Научные факты о повадках вида\n" + corpus
    )
    return _call(MODEL_TACTICS, SYSTEM_TACTICS, prompt)


def _facts(p: dict) -> str:
    bits = [f"- Тип: {p.get('typeName') or p.get('type')}"]
    if p.get("name"):
        bits.append(f"- Название: {p['name']}")
    if p.get("areaHa") is not None:
        bits.append(f"- Площадь: {p['areaHa']} га ({p.get('sizeClass')})")
    if p.get("widthM"):
        bits.append(f"- Ширина русла: ~{round(p['widthM'])} м")
    conn = p.get("connectivity", 0)
    bits.append("- Связь с рекой: " + ("есть" if conn >= 0.6 else "не обнаружена (изолированный водоём)" if conn <= 0.3 else "возможна"))
    if p.get("reeds"):
        bits.append("- Камыш/тростник по берегу")
    if p.get("bridge"):
        bits.append("- Мост/гидросооружение рядом")
    bits.append(f"- Широта: {p.get('lat')}")
    return "\n".join(bits)
