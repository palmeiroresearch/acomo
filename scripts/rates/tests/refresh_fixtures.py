"""Regenera las fixtures congeladas desde las fuentes en vivo.

Ejecutar a mano cuando una fuente cambie de formato y haya que actualizar el
parser: primero se refrescan las fixtures, luego se ajusta el parser hasta que
los tests vuelvan a pasar.

    python -m scripts.rates.tests.refresh_fixtures

Las fixtures se recortan a la ventana con los datos (menos de 1 KB cada una) en
vez de guardar las páginas completas de 200 KB: lo que los tests deben detectar
es un cambio en la **forma del dato**, no en el resto de la página.
"""

from __future__ import annotations

import json
import pathlib
import re

import requests

from ..providers.base import HEADERS, TIMEOUT

HERE = pathlib.Path(__file__).parent / "fixtures"


def _slice_balanced(text: str, start: int) -> str:
    """Recorta un objeto JSON contando llaves desde la primera '{'."""
    i = text.index("{", start)
    begin, depth = i, 0
    while True:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[begin : i + 1]
        i += 1


def refresh_cubadivisas() -> None:
    html = requests.get("https://cubadivisas.com/", headers=HEADERS, timeout=TIMEOUT).text
    match = re.search(r'\[\{[^\[\]]*?"market"\s*:\s*"informal".*?\}\]', html, re.S)
    if not match:
        raise SystemExit("cubadivisas: no se encontró el array informal — cambió el formato")
    (HERE / "cubadivisas.html").write_text(
        "<!doctype html><html><head><title>Diviza</title></head><body>\n"
        '<div id="ticker"></div>\n<script type="application/json" id="rates">'
        + match.group(0)
        + "</script>\n</body></html>\n",
        encoding="utf-8",
    )
    print(f"cubadivisas.html actualizada ({len(match.group(0))} B de payload)")


def refresh_directoriocubano() -> None:
    html = requests.get(
        "https://www.directoriocubano.info/cadeca/", headers=HEADERS, timeout=TIMEOUT
    ).text
    if "var tasas=" not in html:
        raise SystemExit("directoriocubano: no se encontró `var tasas=` — cambió el formato")
    blob = _slice_balanced(html, html.index("var tasas="))
    (HERE / "directoriocubano.html").write_text(
        "<!doctype html><html><head><title>CADECA</title></head><body>\n"
        '<div class="dcx-widget"></div>\n<script>var tasas='
        + blob
        + ";var tipo='informales';</script>\n</body></html>\n",
        encoding="utf-8",
    )
    print(f"directoriocubano.html actualizada ({len(blob)} B de payload)")


def refresh_bcc() -> None:
    data = requests.get(
        "https://api.bc.gob.cu/v1/tasas-de-cambio/activas", headers=HEADERS, timeout=TIMEOUT
    ).json()
    (HERE / "bcc_activas.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"bcc_activas.json actualizada ({len(data.get('tasas', []))} monedas)")


if __name__ == "__main__":
    HERE.mkdir(parents=True, exist_ok=True)
    refresh_cubadivisas()
    refresh_directoriocubano()
    refresh_bcc()
    print("\nAviso: si los tests fallan tras esto, el formato cambió de verdad "
          "y hay que ajustar el parser — no relajar el test.")
