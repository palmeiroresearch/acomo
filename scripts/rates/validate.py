"""Validación de tasas antes de publicarlas.

Esta es la pieza cuya ausencia dejó a la app tres meses mostrando datos falsos:
el scraper anterior no tenía forma de distinguir «no hay dato» de «hay un dato
absurdo», así que un fallo silencioso era indistinguible del éxito.

Dos niveles:

- Rangos por moneda: atrapa el error de parseo más probable, que es coger el
  campo equivocado. Cada objeto de cubadivisas trae `median`, `value`, `change`
  y `change_pct` juntos; leer `change` en lugar de `median` daría 5.0 en vez de
  820, un número que pasa cualquier chequeo de «es un número positivo».
- Validación cruzada: dos fuentes independientes que difieren mucho en la misma
  moneda indican que al menos una está mal, aunque ambas estén dentro de rango.
  Hoy hay una sola fuente, así que no dispara; se mantiene porque en cuanto
  aparezca una segunda vuelve a tener sentido sin tocar nada.
"""

from __future__ import annotations

from .providers.base import Rate

# Límites plausibles en CUP. Deliberadamente anchos: el objetivo es atrapar
# basura de parseo, no predecir el mercado. Referencia octubre 2026:
# USD ~815, EUR ~915, MLC ~570, ZELLE ~785, CLA ~745, CAD ~525, MXN ~52.
RANGES: dict[str, tuple[float, float]] = {
    "USD": (200, 8000),
    "EUR": (200, 8000),
    "MLC": (100, 5000),
    "ZELLE": (150, 8000),
    "CLA": (150, 8000),
    "CAD": (100, 5000),
    "MXN": (5, 800),
}

# Divergencia relativa a partir de la cual dos fuentes se consideran en conflicto.
DISPUTE_THRESHOLD = 0.05

# Mínimo de monedas para considerar útil el resultado de un proveedor. Con menos
# que esto la pantalla queda medio vacía y es mejor pasar a la siguiente fuente.
MIN_CURRENCIES = 3


def filter_in_range(rates: dict[str, Rate]) -> tuple[dict[str, Rate], dict[str, str]]:
    """Separa las tasas plausibles de las que están fuera de rango."""
    clean: dict[str, Rate] = {}
    rejected: dict[str, str] = {}

    for code, rate in rates.items():
        bounds = RANGES.get(code)
        if bounds is None:
            rejected[code] = "unknown_currency"
            continue
        low, high = bounds
        if not (low <= rate.cup <= high):
            rejected[code] = f"out_of_range:{rate.cup}"
            continue
        clean[code] = rate

    return clean, rejected


def is_usable(rates: dict[str, Rate]) -> bool:
    """¿Vale la pena publicar lo que dio este proveedor?

    Se exige el USD: es la tasa que la mayoría abre la app para consultar, y una
    tabla sin ella no cumple el propósito aunque traiga otras cinco monedas.
    """
    return "USD" in rates and len(rates) >= MIN_CURRENCIES


def cross_check(
    winner: dict[str, Rate], others: list[dict[str, Rate]]
) -> list[str]:
    """Monedas donde otra fuente discrepa más del umbral con la ganadora.

    No corrige el valor —no hay forma de saber cuál de las dos acierta— sino que
    lo marca para que la UI pueda advertirlo en vez de presentarlo como certeza.
    """
    disputed: list[str] = []

    for code, rate in winner.items():
        for other in others:
            peer = other.get(code)
            if peer is None or rate.cup <= 0:
                continue
            if abs(peer.cup - rate.cup) / rate.cup > DISPUTE_THRESHOLD:
                disputed.append(code)
                break

    return disputed
