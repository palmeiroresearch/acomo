"""elToque — API oficial del TRMI.

Es la fuente ideal: el TRMI de elToque es el número que la gente en Cuba cita.
Requiere una API key que se solicita por formulario y que, a día de hoy, elToque
no ha entregado.

Este proveedor queda completo y en primer lugar de la cadena a propósito: el día
que la key llegue, basta añadir el secret `ELTOQUE_API_KEY` al repo y pasa a ser
la fuente activa sin tocar una línea de código. Sin el secret se salta en
silencio con reason='no_key', que no es un error.
"""

from __future__ import annotations

import datetime as dt
import os

from .base import TIMEOUT, USER_AGENT, ProviderResult, Rate

NAME = "eltoque_api"
LABEL = "elToque"
URL = "https://tasas.eltoque.com/v1/trmi"
SOURCE_URL = "https://eltoque.com/tasas-de-cambio-cuba"

ENV_KEY = "ELTOQUE_API_KEY"

# Códigos internos de elToque → códigos canónicos de la app.
CODE_MAP = {
    "USD": "USD",
    "ECU": "EUR",
    "MLC": "MLC",
    "USD_Zelle.CUP": "ZELLE",
    "CLA": "CLA",
    "CAD": "CAD",
    "MXN": "MXN",
}


def parse_payload(payload: dict) -> dict[str, Rate]:
    """Normaliza la respuesta del TRMI.

    Acepta las dos formas que documenta elToque, porque no se ha podido verificar
    cuál devuelve en vivo: valores numéricos directos (`{"USD": 815}`) y objetos
    con estadísticas (`{"USD": {"median": 815}}`).
    """
    tasas = payload.get("tasas")
    if not isinstance(tasas, dict):
        # Algunas respuestas traen las monedas en la raíz.
        tasas = payload

    rates: dict[str, Rate] = {}
    for raw_code, entry in tasas.items():
        code = CODE_MAP.get(str(raw_code))
        if not code:
            continue

        value: float | None = None
        if isinstance(entry, dict):
            for key in ("median", "value", "avg"):
                if entry.get(key) is not None:
                    try:
                        value = float(entry[key])
                        break
                    except (TypeError, ValueError):
                        pass
        else:
            try:
                value = float(entry)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                value = None

        if value is not None and value > 0:
            rates[code] = Rate(cup=round(value, 2))

    return rates


def fetch(session) -> ProviderResult:
    key = os.environ.get(ENV_KEY, "").strip()
    if not key:
        return ProviderResult.failed(NAME, "no_key")

    # Ventana de 48 h: el TRMI no se recalcula de forma continua y pedir solo
    # el día de hoy devuelve vacío en las primeras horas de la madrugada.
    now = dt.datetime.now(dt.timezone.utc)
    params = {
        "date_from": (now - dt.timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S"),
        "date_to": now.strftime("%Y-%m-%d %H:%M:%S"),
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }

    try:
        resp = session.get(URL, headers=headers, params=params, timeout=TIMEOUT)
    except Exception as exc:
        return ProviderResult.failed(NAME, f"network_error:{type(exc).__name__}")

    if resp.status_code in (401, 403, 422):
        return ProviderResult.failed(NAME, f"auth_{resp.status_code}")
    if resp.status_code == 429:
        return ProviderResult.failed(NAME, "rate_limited")
    if resp.status_code != 200:
        return ProviderResult.failed(NAME, f"http_{resp.status_code}")

    try:
        payload = resp.json()
    except ValueError:
        return ProviderResult.failed(NAME, "bad_json")

    rates = parse_payload(payload)
    if not rates:
        return ProviderResult.failed(NAME, "parse_failed")

    return ProviderResult(
        name=NAME, ok=True, reason="ok", rates=rates, label=LABEL, source_url=SOURCE_URL
    )
