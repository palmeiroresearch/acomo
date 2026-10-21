"""elToque — intento con navegador real (experimental).

Único workaround que queda para obtener el TRMI sin API key. eltoque.com está
detrás de Cloudflare y devuelve la interstitial «Just a moment…» a cualquier
cliente HTTP; un Chromium de verdad ejecuta el reto JS y *puede* pasarlo.

Marcado experimental porque no se ha podido verificar: hace falta una corrida
real del Action para saber si Cloudflare acepta una IP de datacenter con un
navegador real. El campo `attempted` de rates.json dirá el resultado.

Nunca es fatal. Si Playwright no está instalado, si el reto no se pasa o si el
DOM no contiene lo esperado, devuelve ok=False y la cadena continúa con la
siguiente fuente. Está deliberadamente DESPUÉS de la API oficial y ANTES de los
agregadores: si algún día funciona, da el dato de primera mano.
"""

from __future__ import annotations

import json
import re

from .base import USER_AGENT, ProviderResult, Rate, is_cloudflare_challenge
from .eltoque_api import CODE_MAP

NAME = "eltoque_browser"
LABEL = "elToque"
URL = "https://eltoque.com/tasas-de-cambio-cuba"

# Tope duro: el reto de Cloudflare tarda unos segundos; más allá de esto no va
# a resolverse y no merece seguir ocupando el runner.
TIMEOUT_MS = 45_000

# Objetos JSON planos que lleven un código de elToque y un valor estadístico.
_OBJ_RE = re.compile(r'\{[^{}]*?"(?:median|value)"\s*:\s*[0-9.]+[^{}]*?\}')


def parse_rendered(html: str) -> dict[str, Rate]:
    """Busca las tasas en el DOM ya renderizado.

    Dos estrategias, de más a menos fiable: objetos JSON embebidos (lo que usa
    su propio frontend) y, si no hay, el texto visible. La segunda es un último
    recurso y por eso exige que el número tenga pinta de tasa en CUP.
    """
    rates: dict[str, Rate] = {}

    for match in _OBJ_RE.finditer(html):
        try:
            obj = json.loads(match.group(0))
        except json.JSONDecodeError:
            continue
        code = CODE_MAP.get(str(obj.get("code", "")))
        if not code or code in rates:
            continue
        raw = obj.get("median", obj.get("value"))
        try:
            value = float(raw)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if value > 0:
            rates[code] = Rate(cup=round(value, 2))

    if rates:
        return rates

    # Último recurso: texto visible, p. ej. "USD 815.00 CUP".
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)

    for raw_code, code in CODE_MAP.items():
        if code in rates:
            continue
        label = "Zelle" if code == "ZELLE" else raw_code
        hit = re.search(rf"\b{re.escape(label)}\b[^0-9]{{0,40}}([0-9]{{2,5}}(?:[.,][0-9]{{1,2}})?)", text)
        if not hit:
            continue
        try:
            value = float(hit.group(1).replace(",", "."))
        except ValueError:
            continue
        if value > 0:
            rates[code] = Rate(cup=round(value, 2))

    return rates


def fetch(_session) -> ProviderResult:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return ProviderResult.failed(NAME, "playwright_missing")

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--disable-blink-features=AutomationControlled"])
            try:
                context = browser.new_context(
                    user_agent=USER_AGENT,
                    locale="es-ES",
                    viewport={"width": 1366, "height": 900},
                )
                page = context.new_page()
                page.goto(URL, timeout=TIMEOUT_MS, wait_until="domcontentloaded")

                # Dar margen al reto JS de Cloudflare. networkidle puede no
                # llegar nunca en esta página, así que el timeout se absorbe.
                try:
                    page.wait_for_load_state("networkidle", timeout=20_000)
                except Exception:
                    pass

                html = page.content()
            finally:
                browser.close()
    except Exception as exc:
        return ProviderResult.failed(NAME, f"browser_error:{type(exc).__name__}")

    if is_cloudflare_challenge(html):
        return ProviderResult.failed(NAME, "cloudflare")

    rates = parse_rendered(html)
    if not rates:
        return ProviderResult.failed(NAME, "parse_failed")

    return ProviderResult(
        name=NAME, ok=True, reason="ok", rates=rates, label=LABEL, source_url=URL
    )
