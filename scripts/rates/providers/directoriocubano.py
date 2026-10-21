"""directoriocubano.info — mercado informal.

Segunda fuente. Va unas horas rezagada respecto a cubadivisas (en días de salto
brusco la diferencia en el euro llegó al 3,6 %), así que no es la preferida,
pero cumple dos papeles:

1. Respaldo si cubadivisas cae o cambia de formato.
2. Complemento permanente: es la única de las dos que publica **MXN**.

Las tasas vienen en un `var tasas={...}` dentro del HTML, con dos bloques:
`informales` (índice propio del sitio) y `oficiales` (compra/venta bancaria).
Solo se usa `informales`; las oficiales salen del API del BCC, que es la fuente
primaria para eso.
"""

from __future__ import annotations

import json
import re

from .base import HEADERS, TIMEOUT, ProviderResult, Rate, is_cloudflare_challenge

NAME = "directoriocubano"
LABEL = "directoriocubano.info"
URL = "https://www.directoriocubano.info/cadeca/"

CODE_MAP = {
    "USD": "USD",
    "EUR": "EUR",
    "MLC": "MLC",
    "Zelle": "ZELLE",
    "CLA": "CLA",
    "CAD": "CAD",
    "MXN": "MXN",
}

_ASSIGN_RE = re.compile(r"var\s+tasas\s*=\s*\{")


def _extract_object(html: str) -> dict | None:
    """Recorta el objeto de `var tasas={...}` contando llaves.

    Un regex no sirve aquí: el objeto tiene dos niveles de anidamiento. Se
    escanea respetando strings para que una llave dentro de un texto no
    desbalancee la cuenta.
    """
    match = _ASSIGN_RE.search(html)
    if not match:
        return None

    start = match.end() - 1  # posición de la '{' inicial
    depth = 0
    in_string = False
    escaped = False

    for i in range(start, len(html)):
        ch = html[i]

        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html[start : i + 1])
                except json.JSONDecodeError:
                    return None

    return None


def parse(html: str) -> dict[str, Rate]:
    """Extrae las tasas informales del HTML. Separada de la red para testearla."""
    blob = _extract_object(html)
    if not isinstance(blob, dict):
        return {}

    informales = blob.get("informales")
    if not isinstance(informales, dict):
        return {}

    rates: dict[str, Rate] = {}
    for raw_code, entry in informales.items():
        code = CODE_MAP.get(str(raw_code))
        if not code or not isinstance(entry, dict):
            continue

        # La estructura es {"USD": {"CUP": 815, "MLC": 1.49, "USD": null}}.
        # Solo interesa "CUP": las otras son cruces entre divisas y tomarlas
        # por error daría una tasa de 1.49 en lugar de 815.
        try:
            value = float(entry["CUP"])
        except (KeyError, TypeError, ValueError):
            continue

        if value > 0:
            rates[code] = Rate(cup=round(value, 2))

    # CUP→CUP viene en el blob como 1 y no es una tasa.
    rates.pop("CUP", None)
    return rates


def fetch(session) -> ProviderResult:
    try:
        resp = session.get(URL, headers=HEADERS, timeout=TIMEOUT)
    except Exception as exc:
        return ProviderResult.failed(NAME, f"network_error:{type(exc).__name__}")

    if resp.status_code != 200:
        reason = "cloudflare" if is_cloudflare_challenge(resp.text) else f"http_{resp.status_code}"
        return ProviderResult.failed(NAME, reason)

    rates = parse(resp.text)
    if not rates:
        return ProviderResult.failed(NAME, "parse_failed")

    return ProviderResult(
        name=NAME, ok=True, reason="ok", rates=rates, label=LABEL, source_url=URL
    )
