"""Registro de proveedores del mercado informal, en orden de preferencia.

El orden es la política de la cadena: gana el primero que devuelve datos
válidos. Está puesto de «dato de primera mano» a «agregador»:

1. eltoque_api       — la fuente ideal; inactiva hasta que llegue la API key.
2. eltoque_browser   — intento experimental de saltar Cloudflare con Chromium.
3. cubadivisas       — la fuente efectiva hoy; usa el esquema de elToque.
4. directoriocubano  — respaldo, y única con MXN (ver COMPLEMENTS).
"""

from __future__ import annotations

from . import cubadivisas, directoriocubano, eltoque_api, eltoque_browser
from .base import CANONICAL, ProviderResult, Rate

CHAIN = (eltoque_api, eltoque_browser, cubadivisas, directoriocubano)

# Proveedores que se consultan SIEMPRE, incluso si otro ya ganó, porque aportan
# monedas que el ganador no cubre. Sus tasas solo rellenan huecos, nunca
# sobreescriben las del ganador: mezclar fuentes en la misma moneda daría una
# tabla incoherente.
COMPLEMENTS = (directoriocubano,)

BY_NAME = {module.NAME: module for module in CHAIN}

__all__ = ["CHAIN", "COMPLEMENTS", "BY_NAME", "CANONICAL", "ProviderResult", "Rate"]
