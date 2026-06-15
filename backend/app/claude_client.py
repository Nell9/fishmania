"""Тонкий клиент Anthropic: строит RAG-промпт и парсит строгий JSON.

Ключ берётся из окружения ANTHROPIC_API_KEY (в код не попадает).
Модели настраиваются через KLEVGID_MODEL_ANALYZE / KLEVGID_MODEL_TACTICS.
При любой ошибке вызывающий код откатывается на локальный движок.
"""
import json, os, re

MODEL_ANALYZE = os.environ.get("KLEVGID_MODEL_ANALYZE", "claude-haiku-4-5-20251001")
MODEL_TACTICS = os.environ.get("KLEVGID_MODEL_TACTICS", "claude-sonnet-4-6")


def available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _client():
    from anthropic import Anthropic   # импорт ленивый — пакет не нужен для local-режима
    return Anthropic()


def _extract_json(text: str) -> dict:
    """Достаёт JSON-объект из ответа модели (срезает ```-ограждения и текст вокруг)."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    try:
        return json.loads(t)
    except Exception:
        i, j = t.find("{"), t.rfind("}")
        if i >= 0 and j > i:
            return json.loads(t[i:j + 1])
        raise


def _call(model: str, system: str, prompt: str, max_tokens: int = 1600) -> dict:
    msg = _client().messages.create(
        model=model, max_tokens=max_tokens, system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
    return _extract_json("\n".join(parts))


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
