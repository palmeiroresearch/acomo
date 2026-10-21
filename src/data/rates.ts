/**
 * Carga de tasas, con caché propia.
 *
 * Tres capas, de más fresca a más vieja:
 *
 *   1. Red (`fetch`) — el service worker ya aplica network-first a este JSON.
 *   2. `localStorage` — para que la app abra con un número en pantalla de
 *      inmediato, sin esperar a la red ni a que el SW responda.
 *   3. Nada — se muestra el estado vacío con su explicación.
 *
 * La capa 2 existe por el caso real de uso: con una conexión intermitente, ver
 * la tasa de ayer al instante es mucho mejor que ver un spinner. Lo que no es
 * aceptable es mostrarla *sin decir que es de ayer*, que es lo que hacía la
 * versión anterior — de ahí que `updated_at` viaje siempre con los datos.
 */

import { RATES_URL } from '../config';
import type { RateTable } from '../core/convert';

export interface RateBlock {
    readonly source: string;
    readonly label: string;
    readonly source_url: string;
    readonly updated_at: string;
    readonly rates: RateTable;
    readonly attempted?: readonly string[];
    readonly disputed?: readonly string[];
    readonly complemented?: readonly string[];
    readonly carried_over?: boolean;
    readonly segment?: string;
}

export interface RatesDocument {
    readonly schema: number;
    readonly generated_at: string;
    readonly informal?: RateBlock;
    readonly official?: RateBlock;
}

/** Sube si cambia la forma del JSON, para invalidar cachés viejas. */
const SCHEMA = 2;
const CACHE_KEY = `acomo:rates:v${SCHEMA}`;

export type Origin = 'network' | 'cache' | 'none';

export interface LoadResult {
    readonly document: RatesDocument | null;
    readonly origin: Origin;
}

function isValid(value: unknown): value is RatesDocument {
    if (typeof value !== 'object' || value === null) return false;
    const doc = value as Partial<RatesDocument>;

    if (doc.schema !== SCHEMA) return false;

    // Un bloque sirve solo si trae al menos una tasa utilizable. Un documento
    // con `rates: {}` pasaría un chequeo de tipos y dejaría la pantalla vacía.
    const hasRates = (block: RateBlock | undefined): boolean =>
        Boolean(block && typeof block.rates === 'object' && Object.keys(block.rates).length > 0);

    return hasRates(doc.informal) || hasRates(doc.official);
}

function readCache(): RatesDocument | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isValid(parsed) ? parsed : null;
    } catch {
        // Modo privado, almacenamiento bloqueado o JSON corrupto: no es un
        // error que deba impedir que la app arranque.
        return null;
    }
}

function writeCache(document: RatesDocument): void {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(document));
    } catch {
        /* sin espacio o sin permiso: la app sigue funcionando desde la red */
    }
}

/** Lo que haya en caché, sin tocar la red. Para pintar algo en el primer frame. */
export function cachedRates(): RatesDocument | null {
    return readCache();
}

/**
 * Pide las tasas a la red y cae a la caché si falla.
 * Nunca lanza: devuelve el origen para que la UI pueda ser honesta.
 */
export async function fetchRates(): Promise<LoadResult> {
    try {
        const response = await fetch(RATES_URL, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const parsed: unknown = await response.json();
        if (!isValid(parsed)) throw new Error('documento inválido');

        writeCache(parsed);
        return { document: parsed, origin: 'network' };
    } catch {
        const cached = readCache();
        return { document: cached, origin: cached ? 'cache' : 'none' };
    }
}
