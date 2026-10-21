"""Orquestador del pipeline de tasas de «A Cómo».

Produce dos artefactos que la app consume como ficheros estáticos:

  public/data/rates.json    — tasas vigentes (informal + Segmento III)
  public/data/history.json  — serie de 30 días del Segmento III

Invariantes, en orden de importancia:

1. **Nunca publicar vacío ni basura.** Si nada válido se obtuvo, sale con error
   SIN escribir, y el fichero anterior sigue sirviéndose.
2. **Conservar el último valor bueno.** Si la cadena informal falla completa pero
   el BCC responde, se arrastra el bloque informal anterior tal cual. La app
   muestra su antigüedad real en vez de quedarse en blanco.
3. **Dejar rastro de lo que falló.** El array `attempted` se publica en cada
   commit. Es lo que faltaba antes: un scraper roto en silencio durante meses
   era indistinguible de uno sano.

Uso:
    python -m scripts.rates.main --dry-run
    python -m scripts.rates.main --provider cubadivisas
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys

import requests

from . import bcc, validate
from .providers import BY_NAME, CHAIN, ProviderResult

ROOT = pathlib.Path(__file__).resolve().parents[2]
RATES_PATH = ROOT / "public" / "data" / "rates.json"
HISTORY_PATH = ROOT / "public" / "data" / "history.json"

SCHEMA_VERSION = 2
HISTORY_CURRENCIES = ("USD", "EUR", "CAD", "MXN")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_json(path: pathlib.Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _emit_github_outputs(**values: object) -> None:
    """Publica el resultado como outputs del step, si corre en GitHub Actions.

    Permite al workflow distinguir tres situaciones que el código de salida no
    separa: todo fresco, dato viejo arrastrado (sale 0 pero hay que avisar), y
    fallo total (sale 1).
    """
    target = os.environ.get("GITHUB_OUTPUT")
    if not target:
        return
    try:
        with open(target, "a", encoding="utf-8") as handle:
            for key, value in values.items():
                rendered = str(value).lower() if isinstance(value, bool) else str(value)
                handle.write(f"{key}={rendered}\n")
    except OSError:
        pass  # nunca hacer fallar la corrida por no poder escribir el output


def _write_json(path: pathlib.Path, payload: dict) -> None:
    """Escritura atómica: se escribe a un temporal y se reemplaza.

    Evita dejar un JSON truncado si el proceso muere a mitad —y un JSON
    truncado en producción es peor que un JSON viejo.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    tmp.replace(path)


def build_informal(session, only: str | None, log: list[str]) -> dict | None:
    if only:
        module = BY_NAME.get(only)
        if module is None:
            print(f"ERROR: proveedor desconocido '{only}'. Opciones: {', '.join(BY_NAME)}")
            sys.exit(2)
        modules: tuple = (module,)
    else:
        modules = CHAIN

    attempted: list[str] = []
    print("Mercado informal:")

    winner: ProviderResult | None = None
    seconds: list[dict] = []

    for module in modules:
        result = module.fetch(session)

        if result.ok:
            clean, rejected = validate.filter_in_range(result.rates)
            for code, why in rejected.items():
                log.append(f"  ! {result.name}: {code} descartada ({why})")
            result.rates = clean
            if not validate.is_usable(clean):
                result.ok = False
                result.reason = f"insufficient:{len(clean)}"

        attempted.append(result.status)
        codes = "  " + ", ".join(sorted(result.rates)) if result.rates else ""
        print(f"  {result.name:<18} {'OK' if result.ok else '--'}  {result.reason}{codes}")

        if result.ok:
            if winner is None:
                winner = result
            else:
                seconds.append(result.rates)

    if winner is None:
        return None

    rates = dict(winner.rates)

    # Con un solo proveedor esto no dispara nunca, pero se mantiene: en cuanto
    # haya una segunda fuente vuelve a tener sentido sin tocar nada.
    disputed = validate.cross_check(winner.rates, seconds)
    if disputed:
        print(f"  ! discrepancia >5% entre fuentes: {', '.join(disputed)}")

    block: dict = {
        "source": winner.name,
        "label": winner.label,
        "source_url": winner.source_url,
        "updated_at": _now(),
        "attempted": attempted,
        "rates": {code: rate.to_json() for code, rate in sorted(rates.items())},
    }
    if disputed:
        block["disputed"] = sorted(disputed)
    return block


def main() -> int:
    parser = argparse.ArgumentParser(description="Actualiza las tasas de A Cómo")
    parser.add_argument("--dry-run", action="store_true", help="resuelve e imprime sin escribir")
    parser.add_argument("--provider", help="usa solo este proveedor informal")
    parser.add_argument("--no-history", action="store_true", help="no actualiza history.json")
    args = parser.parse_args()

    log: list[str] = []
    session = requests.Session()
    previous = _read_json(RATES_PATH)

    informal = build_informal(session, args.provider, log)

    print("\nOficial (BCC, Segmento III):")
    official_raw = bcc.fetch_active(session)
    if official_raw.get("ok"):
        official = {k: v for k, v in official_raw.items() if k not in ("ok", "reason")}
        print(f"  bcc                OK  ok  {', '.join(sorted(official['rates']))}")
        if official_raw.get("dropped"):
            print(f"  ! descartadas por ratio incoherente: {', '.join(official_raw['dropped'])}")
    else:
        official = None
        print(f"  bcc                --  {official_raw.get('reason')}")

    # Arrastre del último valor bueno: un bloque viejo con su fecha real es
    # mucho mejor que ningún bloque, porque la app puede decir «hace 9 h».
    carried: list[str] = []
    if informal is None and previous.get("informal"):
        informal = dict(previous["informal"])
        informal["carried_over"] = True
        carried.append("informal")
    if official is None and previous.get("official"):
        official = dict(previous["official"])
        official["carried_over"] = True
        carried.append("official")

    _emit_github_outputs(
        informal_fresh="informal" not in carried and informal is not None,
        official_fresh="official" not in carried and official is not None,
        carried=",".join(carried),
        informal_source=(informal or {}).get("source", ""),
    )

    if informal is None and official is None:
        print("\nERROR: ninguna fuente dio datos válidos y no hay valor previo. "
              "No se escribe nada.")
        return 1

    payload: dict = {"schema": SCHEMA_VERSION, "generated_at": _now()}
    if informal is not None:
        payload["informal"] = informal
    if official is not None:
        payload["official"] = official

    if log:
        print("\nAvisos:")
        for line in log:
            print(line)
    if carried:
        print(f"\nArrastrado del fichero anterior: {', '.join(carried)}")

    if args.dry_run:
        print("\n--- dry-run, no se escribe ---")
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    _write_json(RATES_PATH, payload)
    print(f"\nEscrito {RATES_PATH.relative_to(ROOT)}")

    if not args.no_history:
        series = {
            code: bcc.fetch_history(session, code)
            for code in HISTORY_CURRENCIES
        }
        series = {code: data for code, data in series.items() if data}
        if series:
            _write_json(HISTORY_PATH, {
                "schema": SCHEMA_VERSION,
                "generated_at": _now(),
                "segment": "III",
                "source": "api.bc.gob.cu",
                "series": series,
            })
            print(f"Escrito {HISTORY_PATH.relative_to(ROOT)} "
                  f"({', '.join(f'{c}:{len(d)}d' for c, d in series.items())})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
