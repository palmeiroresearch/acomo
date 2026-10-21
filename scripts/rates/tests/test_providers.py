"""Tests de los parsers contra HTML/JSON congelado de cada fuente.

Para qué sirve esto: las fuentes son sitios de terceros que cambian de formato
sin avisar. Estos tests no comprueban que las tasas sean correctas —eso no se
puede testear— sino que **el parser sigue entendiendo el formato**. Cuando una
fuente cambie, el test falla en CI y queda claro qué arreglar, en vez de que la
app sirva datos viejos en silencio durante meses, que es lo que pasó antes.

Las fixtures se regeneran con `scripts/rates/tests/refresh_fixtures.py`.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from scripts.rates import bcc, validate
from scripts.rates.providers import cubadivisas, directoriocubano, eltoque_api
from scripts.rates.providers.base import Rate, is_cloudflare_challenge

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# ─────────────────────────────── cubadivisas ───────────────────────────────

def test_cubadivisas_parses_frozen_page():
    rates = cubadivisas.parse(fixture("cubadivisas.html"))

    assert set(rates) == {"USD", "EUR", "MLC", "ZELLE", "CAD", "CLA"}
    assert rates["USD"].cup == 815.0
    # El euro llega bajo el código interno "ECU" de elToque, no "EUR".
    assert rates["EUR"].cup == 912.5
    # Zelle llega como "USD_Zelle.CUP".
    assert rates["ZELLE"].cup == 784.94


def test_cubadivisas_keeps_change_fields():
    """El `change` de la fuente alimenta los indicadores ▲▼ de la UI."""
    rates = cubadivisas.parse(fixture("cubadivisas.html"))

    assert rates["EUR"].change == 52.5
    assert rates["EUR"].change_pct == 6.1


def test_cubadivisas_returns_empty_on_unknown_markup():
    assert cubadivisas.parse("<html><body>sin tasas aqui</body></html>") == {}


# ───────────────────────────── directoriocubano ─────────────────────────────

def test_directoriocubano_parses_frozen_page():
    rates = directoriocubano.parse(fixture("directoriocubano.html"))

    assert set(rates) == {"USD", "EUR", "MLC", "ZELLE", "CAD", "CLA", "MXN"}
    # Única de las dos fuentes informales que publica MXN.
    assert rates["MXN"].cup == 51.92


def test_directoriocubano_reads_cup_not_cross_rates():
    """Regresión del error de parseo más probable en esta fuente.

    Cada moneda trae además su cruce contra MLC y USD
    (`"USD": {"CUP": 815, "MLC": 1.49, "USD": null}`). Leer el campo equivocado
    daría 1.49, un número positivo y perfectamente creíble para un validador
    ingenuo, pero absurdo como tasa en CUP.
    """
    rates = directoriocubano.parse(fixture("directoriocubano.html"))

    assert rates["USD"].cup > 100
    assert rates["USD"].cup != 1.49


def test_directoriocubano_excludes_cup_itself():
    """CUP→CUP viene en el blob como 1 y no es una tasa."""
    rates = directoriocubano.parse(fixture("directoriocubano.html"))

    assert "CUP" not in rates


def test_directoriocubano_survives_braces_inside_strings():
    """El recorte cuenta llaves, así que una llave dentro de un string no debe
    desbalancear la cuenta."""
    html = '<script>var tasas={"informales":{"USD":{"CUP":800,"nota":"a{b}c"}}};</script>'

    rates = directoriocubano.parse(html)

    assert rates["USD"].cup == 800


def test_directoriocubano_returns_empty_without_assignment():
    assert directoriocubano.parse("<html><body>nada</body></html>") == {}


# ───────────────────────────────── elToque ─────────────────────────────────

def test_eltoque_api_accepts_plain_numbers():
    payload = {"tasas": {"USD": 816.5, "ECU": 915, "MLC": 563.71}}

    rates = eltoque_api.parse_payload(payload)

    assert rates["USD"].cup == 816.5
    assert rates["EUR"].cup == 915.0


def test_eltoque_api_accepts_median_objects():
    payload = {"tasas": {"USD": {"median": 816.5, "min": 800, "max": 830}}}

    assert eltoque_api.parse_payload(payload)["USD"].cup == 816.5


def test_eltoque_api_ignores_unknown_codes():
    rates = eltoque_api.parse_payload({"tasas": {"USD": 816.5, "XYZ": 1}})

    assert set(rates) == {"USD"}


# ──────────────────────────────── Cloudflare ────────────────────────────────

def test_detects_cloudflare_interstitial():
    """Distinguir el reto de Cloudflare de una caída real es lo que permite
    informar `cloudflare` en vez de `http_403`, que son problemas distintos."""
    assert is_cloudflare_challenge("<html><head><title>Just a moment...</title>")
    assert not is_cloudflare_challenge("<html><body>contenido normal</body></html>")


# ─────────────────────────────────── BCC ───────────────────────────────────

def test_bcc_parses_segment_three():
    payload = json.loads(fixture("bcc_activas.json"))

    rates, _dropped, day = bcc.parse_active(payload)

    assert rates["USD"] == 729.0  # tasaEspecial, no tasaOficial (24) ni tasaPublica (120)
    assert day is not None


def test_bcc_drops_jpy_whose_ratio_is_corrupt():
    """El BCC publica el JPY con el Segmento III roto.

    En la fixture, JPY trae tasaEspecial 0.217 contra tasaOficial 6.59 — un
    ratio de 0.03 cuando el resto del lote está en ~30. Es un error de su lado y
    debe descartarse esa moneda sola, sin invalidar las demás.
    """
    payload = json.loads(fixture("bcc_activas.json"))

    _ratios, dropped = bcc._drop_ratio_outliers(payload["tasas"])

    assert "JPY" in dropped
    assert "USD" not in dropped
    assert "EUR" not in dropped


def test_bcc_ratio_check_adapts_to_policy_change():
    """El múltiplo del Segmento III es política monetaria y puede cambiar.

    El chequeo usa el ratio mediano del propio lote, no un 30.375 fijo, así que
    un cambio general de múltiplo no debe descartar nada.
    """
    entries = [
        {"codigoMoneda": "USD", "tasaOficial": 24, "tasaEspecial": 1200},
        {"codigoMoneda": "EUR", "tasaOficial": 27, "tasaEspecial": 1350},
        {"codigoMoneda": "CAD", "tasaOficial": 17, "tasaEspecial": 850},
    ]

    _ratios, dropped = bcc._drop_ratio_outliers(entries)

    assert dropped == []


def test_bcc_returns_empty_on_unexpected_shape():
    assert bcc.parse_active({"unexpected": True}) == ({}, [], None)


# ───────────────────────────────── validate ─────────────────────────────────

@pytest.mark.parametrize("code,value", [("USD", 1.49), ("USD", 9_999_999), ("MXN", 5000)])
def test_validate_rejects_out_of_range(code, value):
    clean, rejected = validate.filter_in_range({code: Rate(cup=value)})

    assert clean == {}
    assert code in rejected


def test_validate_accepts_current_market_values():
    rates = {
        "USD": Rate(cup=815), "EUR": Rate(cup=912.5), "MLC": Rate(cup=571.21),
        "ZELLE": Rate(cup=784.94), "CLA": Rate(cup=745.15), "CAD": Rate(cup=523.6),
        "MXN": Rate(cup=51.92),
    }

    clean, rejected = validate.filter_in_range(rates)

    assert rejected == {}
    assert len(clean) == 7


def test_validate_requires_usd_to_publish():
    """Sin USD la pantalla no cumple su propósito, aunque haya otras monedas."""
    assert not validate.is_usable({"EUR": Rate(cup=912), "MLC": Rate(cup=571), "CAD": Rate(cup=523)})
    assert validate.is_usable({"USD": Rate(cup=815), "EUR": Rate(cup=912), "MLC": Rate(cup=571)})


def test_cross_check_flags_divergent_sources():
    winner = {"USD": Rate(cup=815), "EUR": Rate(cup=912.5)}
    other = [{"USD": Rate(cup=816), "EUR": Rate(cup=700)}]

    assert validate.cross_check(winner, other) == ["EUR"]


def test_cross_check_tolerates_small_lag():
    """directoriocubano va unas horas rezagada; eso no es un conflicto."""
    winner = {"USD": Rate(cup=815)}
    other = [{"USD": Rate(cup=800)}]  # 1.8 % de diferencia

    assert validate.cross_check(winner, other) == []
