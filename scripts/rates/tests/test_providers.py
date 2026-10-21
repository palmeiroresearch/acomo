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
from scripts.rates.providers import cubadivisas
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
    """Una fuente que va unas horas rezagada no es un conflicto, solo retraso."""
    winner = {"USD": Rate(cup=815)}
    other = [{"USD": Rate(cup=800)}]  # 1.8 % de diferencia

    assert validate.cross_check(winner, other) == []
