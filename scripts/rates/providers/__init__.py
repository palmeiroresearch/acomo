"""Proveedores de tasas del mercado informal.

Hoy hay uno solo: **cubadivisas**. Es una decisión tomada con datos, no por
simplificar a ciegas.

La cadena original tenía cuatro. Una corrida real en GitHub Actions demostró que
las otras tres no sirven desde un runner:

- `eltoque_api` exige una API key que elToque no entrega.
- `eltoque_browser` (Chromium contra el reto de Cloudflare) nunca llegó a pasar.
- `directoriocubano` respondía bien desde una IP residencial, pero desde el
  datacenter de GitHub devuelve el reto de Cloudflare igual que eltoque.com.

Esa última fue la lección: **probar una fuente desde una máquina doméstica no
dice nada sobre si funcionará en CI.** La única prueba válida es la corrida real.
Mantener tres proveedores que siempre fallan solo añadía ruido al registro de
intentos y daba una falsa sensación de respaldo.

Si hace falta añadir una fuente, basta un módulo nuevo aquí con una función
`fetch(session) -> ProviderResult` y añadirlo a `CHAIN`. El resto del pipeline
no cambia.
"""

from __future__ import annotations

from . import cubadivisas
from .base import CANONICAL, ProviderResult, Rate

#: Proveedores en orden de preferencia; gana el primero con datos válidos.
CHAIN = (cubadivisas,)

BY_NAME = {module.NAME: module for module in CHAIN}

__all__ = ["CHAIN", "BY_NAME", "CANONICAL", "ProviderResult", "Rate"]
