"""Contrato común a todos los proveedores de tasas del mercado informal.

Añadir una fuente nueva = añadir un módulo en este paquete con una función
`fetch(session) -> ProviderResult` y registrarlo en `providers/__init__.py`.

Regla de oro: un proveedor NUNCA lanza excepción hacia fuera. Si algo falla
devuelve un ProviderResult con ok=False y un `reason` corto y legible, porque
ese `reason` termina publicado en rates.json y es lo que permite diagnosticar
una fuente rota sin tener que leer los logs del Action.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Códigos canónicos que usa la app. Cada proveedor traduce los suyos a estos.
CANONICAL = ("USD", "EUR", "MLC", "ZELLE", "CLA", "CAD", "MXN")

# Timeout y user-agent compartidos. El UA de navegador no es decorativo:
# varias de estas fuentes están detrás de Cloudflare y devuelven 403 a un
# cliente que se identifica como bot.
TIMEOUT = 25
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
}


@dataclass
class Rate:
    """Una tasa en CUP, con su variación si la fuente la provee."""

    cup: float
    change: float | None = None
    change_pct: float | None = None

    def to_json(self) -> dict[str, float | None]:
        return {"cup": self.cup, "change": self.change, "change_pct": self.change_pct}


@dataclass
class ProviderResult:
    name: str
    ok: bool
    reason: str  # 'ok' | 'no_key' | 'cloudflare' | 'http_403' | 'parse_failed' | ...
    rates: dict[str, Rate] = field(default_factory=dict)
    label: str = ""  # nombre legible que la app muestra como fuente
    source_url: str = ""

    @property
    def status(self) -> str:
        """Lo que se publica en el array `attempted` de rates.json."""
        return f"{self.name}:{self.reason}"

    @classmethod
    def failed(cls, name: str, reason: str) -> ProviderResult:
        return cls(name=name, ok=False, reason=reason)


def is_cloudflare_challenge(text: str) -> bool:
    """Detecta la interstitial de Cloudflare.

    Importa distinguirla de un 403 normal: significa 'la fuente existe pero
    exige un navegador real', que es información distinta de 'la fuente cayó'.
    """
    probes = ("just a moment", "cf-challenge", "challenges.cloudflare.com",
              "performing security verification", "cf_chl_opt")
    low = text[:6000].lower()
    return any(p in low for p in probes)
