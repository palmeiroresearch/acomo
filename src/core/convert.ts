/**
 * Conversión entre monedas. Pura y sin DOM.
 *
 * Todas las tasas se expresan en CUP por unidad de divisa, así que cualquier
 * par se resuelve pasando por CUP: `importe × tasa(origen) ÷ tasa(destino)`.
 * El CUP no aparece en las tablas —sería siempre 1— y se añade aquí.
 *
 * El mercado es un parámetro explícito, no un estado global: convertir al
 * informal y al oficial da resultados muy distintos (hoy USD 815 contra 729) y
 * mezclarlos por accidente daría cifras sin sentido.
 */

export type Market = 'informal' | 'official';

export const CUP = 'CUP';

export interface RateEntry {
    readonly cup: number;
    readonly change?: number | null;
    readonly change_pct?: number | null;
}

export type RateTable = Readonly<Record<string, RateEntry>>;

/** Tasa de una moneda en CUP. `null` si no está en la tabla. */
export function rateOf(code: string, table: RateTable): number | null {
    if (code === CUP) return 1;
    const entry = table[code];
    return entry && entry.cup > 0 ? entry.cup : null;
}

/**
 * Convierte `amount` de `from` a `to`.
 * Devuelve `null` si falta alguna tasa, en vez de un NaN que se propague.
 */
export function convert(
    amount: number,
    from: string,
    to: string,
    table: RateTable,
): number | null {
    if (!Number.isFinite(amount)) return null;

    const fromRate = rateOf(from, table);
    const toRate = rateOf(to, table);
    if (fromRate === null || toRate === null) return null;

    const result = (amount * fromRate) / toRate;
    return Number.isFinite(result) ? result : null;
}

/**
 * Monedas seleccionables, con el CUP primero.
 *
 * El orden del resto es el de `preferred` y luego alfabético, para que el USD
 * no aparezca enterrado entre monedas que casi nadie consulta.
 */
export function availableCurrencies(
    table: RateTable,
    preferred: readonly string[] = ['USD', 'EUR', 'MLC', 'ZELLE'],
): string[] {
    const codes = Object.keys(table).filter((code) => rateOf(code, table) !== null);

    const ranked = [...codes].sort((a, b) => {
        const ia = preferred.indexOf(a);
        const ib = preferred.indexOf(b);
        if (ia !== -1 || ib !== -1) {
            return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
        }
        return a.localeCompare(b);
    });

    return [CUP, ...ranked];
}
