"""cubadivisas.com — mercado informal.

Es la fuente efectiva del proyecto. Publica los datos con los nombres de campo
literales de la API de elToque (`ECU` para EUR, `USD_Zelle.CUP` para Zelle,
`median`, `market`), lo que indica que la consume con su propia API key. Es lo
más cercano al TRMI de elToque accesible sin key propia.

No hay endpoint JSON: las tasas vienen embebidas en el HTML de la portada como
objetos JSON sueltos. Se extraen objeto a objeto en vez de buscar el array
completo, porque así un cambio en el envoltorio (que es lo que suele cambiar)
no rompe el parseo.
"""

from __future__ import annotations

import json
import re

from .base import HEADERS, TIMEOUT, ProviderResult, Rate, is_cloudflare_challenge

NAME = "cubadivisas"
LABEL = "cubadivisas.com"
URL = "https://cubadivisas.com/"

# Códigos de elToque → códigos canónicos de la app.
CODE_MAP = {
    "USD": "USD",
    "ECU": "EUR",            # elToque almacena el euro como "ECU"
    "MLC": "MLC",
    "USD_Zelle.CUP": "ZELLE",
    "CLA": "CLA",
    "CAD": "CAD",
    "MXN": "MXN",            # no aparece hoy, pero se mapea por si lo añaden
}

# Objetos JSON planos (sin llaves anidadas) que declaran mercado informal.
_OBJ_RE = re.compile(r'\{[^{}]*?"market"\s*:\s*"informal"[^{}]*?\}')


def _value_of(obj: dict) -> float | None:
    """La tasa en CUP. `median` es el número que muestra el sitio."""
    for key in ("median", "value", "rate"):
        raw = obj.get(key)
        if raw is None:
            continue
        try:
            return float(raw)
        except (TypeError, ValueError):
            continue
    return None


def _num(raw: object) -> float | None:
    try:
        return float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def parse(html: str) -> dict[str, Rate]:
    """Extrae las tasas del HTML. Separada de la red para poder testearla."""
    rates: dict[str, Rate] = {}

    for match in _OBJ_RE.finditer(html):
        try:
            obj = json.loads(match.group(0))
        except json.JSONDecodeError:
            continue

        code = CODE_MAP.get(str(obj.get("code", "")))
        if not code or code in rates:
            continue

        value = _value_of(obj)
        if value is None or value <= 0:
            continue

        rates[code] = Rate(
            cup=round(value, 2),
            change=_num(obj.get("change")),
            change_pct=_num(obj.get("change_pct")),
        )

    return rates


def fetch(session) -> ProviderResult:
    try:
        resp = session.get(URL, headers=HEADERS, timeout=TIMEOUT)
    except Exception as exc:
        return ProviderResult.failed(NAME, f"network_error:{type(exc).__name__}")

    if resp.status_code != 200:
        reason = "cloudflare" if is_cloudflare_challenge(resp.text) else f"http_{resp.status_code}"
        return ProviderResult.failed(NAME, reason)

    if is_cloudflare_challenge(resp.text):
        return ProviderResult.failed(NAME, "cloudflare")

    rates = parse(resp.text)
    if not rates:
        return ProviderResult.failed(NAME, "parse_failed")

    return ProviderResult(
        name=NAME, ok=True, reason="ok", rates=rates, label=LABEL, source_url=URL
    )
