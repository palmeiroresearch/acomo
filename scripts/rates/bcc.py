"""Banco Central de Cuba — tasas oficiales (Segmento III).

API pública y sin autenticación, pero **sin CORS**: devuelve 403 en cuanto la
petición lleva header `Origin`. Por eso el navegador no puede llamarla directo
y hay que proxiarla desde el Action a un JSON estático. Es la misma razón por la
que la app necesita este pipeline y no un simple fetch.

De las tres tasas que publica por moneda se usa `tasaEspecial`, que es el
Segmento III (la tasa flotante). Verificado contra los valores publicados el
2026-09-04: USD 638, EUR 742.38, CAD 462.99.
"""

from __future__ import annotations

import datetime as dt
import statistics

from .providers.base import TIMEOUT, USER_AGENT

NAME = "bcc"
LABEL = "Banco Central de Cuba"
BASE = "https://api.bc.gob.cu/v1/tasas-de-cambio"
ACTIVE_URL = f"{BASE}/activas"
HISTORY_URL = f"{BASE}/historico"
SOURCE_URL = "https://www.bc.gob.cu/tasas-de-cambio"

HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}

# Monedas que la app muestra en la sección oficial. El API devuelve 13; estas
# son las que tienen uso real para quien manda o recibe dinero a Cuba.
WANTED = ("USD", "EUR", "CAD", "MXN", "GBP", "CHF", "CNY", "RUB")

# Desviación máxima respecto al ratio mediano tasaEspecial/tasaOficial antes de
# descartar una moneda. Ver `_drop_ratio_outliers`.
RATIO_TOLERANCE = 0.20


def _drop_ratio_outliers(entries: list[dict]) -> tuple[dict[str, float], list[str]]:
    """Descarta monedas cuyo Segmento III es incoherente con su tasa oficial.

    Hoy el BCC deriva el Segmento III como un múltiplo fijo de la tasa oficial
    (≈30,375 en todas las monedas), y el JPY viola esa relación de forma
    flagrante: tasaEspecial 0.217 contra tasaOficial 6.59, un error de su lado.

    En vez de codificar el 30,375 —que es una decisión de política y puede
    cambiar— se calcula el ratio mediano del propio lote y se descarta lo que se
    aparte de él. Así la validación sigue funcionando si el múltiplo cambia, y
    detecta igualmente una moneda con el dato corrupto.
    """
    ratios: dict[str, float] = {}
    for item in entries:
        official = item.get("tasaOficial")
        special = item.get("tasaEspecial")
        code = str(item.get("codigoMoneda", ""))
        if not code or not official or not special:
            continue
        try:
            ratios[code] = float(special) / float(official)
        except (TypeError, ValueError, ZeroDivisionError):
            continue

    if len(ratios) < 3:
        # Muy pocas monedas para que la mediana signifique algo: no se filtra.
        return {}, []

    median = statistics.median(ratios.values())
    dropped = [
        code
        for code, ratio in ratios.items()
        if median > 0 and abs(ratio - median) / median > RATIO_TOLERANCE
    ]
    return ratios, dropped


def parse_active(payload: dict) -> tuple[dict[str, float], list[str], str | None]:
    """Extrae el Segmento III. Devuelve (tasas, descartadas, fecha)."""
    entries = payload.get("tasas")
    if not isinstance(entries, list):
        return {}, [], None

    _, dropped = _drop_ratio_outliers(entries)

    rates: dict[str, float] = {}
    for item in entries:
        code = str(item.get("codigoMoneda", ""))
        if code not in WANTED or code in dropped:
            continue
        try:
            value = float(item["tasaEspecial"])
        except (KeyError, TypeError, ValueError):
            continue
        if value > 0:
            rates[code] = round(value, 2)

    day = payload.get("fechaDia") or payload.get("fechaHoy")
    return rates, [c for c in dropped if c in WANTED], day


def fetch_active(session) -> dict:
    """Tasas oficiales vigentes. Devuelve un bloque listo para rates.json."""
    try:
        resp = session.get(ACTIVE_URL, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:
        return {"ok": False, "reason": f"{type(exc).__name__}"}

    rates, dropped, day = parse_active(payload)
    if not rates:
        return {"ok": False, "reason": "parse_failed"}

    block: dict = {
        "ok": True,
        "reason": "ok",
        "source": "api.bc.gob.cu",
        "source_url": SOURCE_URL,
        "label": LABEL,
        "segment": "III",
        "updated_at": day,
        "rates": {code: {"cup": value} for code, value in rates.items()},
    }
    if dropped:
        # Se publica para que quede rastro: si el BCC arregla el JPY, deja de
        # aparecer sin que haya que tocar nada.
        block["dropped"] = dropped
    return block


def fetch_history(session, code: str = "USD", days: int = 30) -> list[dict]:
    """Serie diaria del Segmento III para una moneda, para la tendencia en la UI."""
    today = dt.date.today()
    params = {
        "fechaInicio": (today - dt.timedelta(days=days)).isoformat(),
        "fechaFin": today.isoformat(),
        "codigoMoneda": code,
    }
    try:
        resp = session.get(HISTORY_URL, headers=HEADERS, params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        payload = resp.json()
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    series = []
    for item in payload:
        try:
            series.append({"d": str(item["fecha"])[:10], "cup": round(float(item["tasaEspecial"]), 2)})
        except (KeyError, TypeError, ValueError):
            continue
    return series
