/**
 * Formateo de números y fechas.
 *
 * Convención de separadores: punto decimal y coma de millares (1,234.56) en
 * toda la app. Se eligió así por dos razones: es cómo presentan las cifras las
 * propias fuentes (elToque publica «816.50»), y usar un formato distinto en la
 * calculadora y en las tasas sería una inconsistencia visible dentro de la
 * misma app.
 *
 * Regla que evita la familia de bugs del código anterior: **el formateo es solo
 * de salida**. Nunca se vuelve a parsear una cadena ya formateada; para eso
 * existe `toEntry`, que produce la forma canónica sin separadores.
 */

/** Dígitos significativos que admite la calculadora, como en iOS. */
export const MAX_DIGITS = 9;

const GROUPED = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: MAX_DIGITS,
    useGrouping: true,
});

/** Notación científica compacta: 1e10 en vez de 1.00000000e+10. */
function scientific(value: number): string {
    return value
        .toPrecision(MAX_DIGITS)
        .replace(/(\.\d*?)0+e/, '$1e')
        .replace(/\.e/, 'e')
        .replace('e+', 'e');
}

/** ¿El valor se sale del rango que la pantalla puede mostrar en decimal? */
function needsScientific(value: number): boolean {
    const abs = Math.abs(value);
    return abs !== 0 && (abs >= 1e10 || abs < 1e-6);
}

/**
 * Número listo para mostrar en la calculadora.
 * Nunca se usa como entrada de un cálculo posterior: ver `toEntry`.
 */
export function formatNumber(value: number): string {
    if (!Number.isFinite(value)) return 'Error';
    if (needsScientific(value)) return scientific(value);

    const formatted = GROUPED.format(value);
    return formatted.includes('.') ? formatted.replace(/\.?0+$/, '') : formatted;
}

/**
 * Forma canónica de un número para guardarlo como entrada en curso:
 * sin separadores de millares y limitado a MAX_DIGITS significativos.
 *
 * Es la contrapartida de `formatNumber` y la pieza que impide reintroducir el
 * bug original, en el que `parseFloat("1,500")` devolvía 1 y convertía
 * `500 × 3 = + 2 =` en 3.
 */
export function toEntry(value: number): string {
    if (!Number.isFinite(value)) return '0';
    if (needsScientific(value)) return scientific(value);

    // toPrecision puede devolver notación exponencial para números pequeños;
    // Number() la normaliza de vuelta a decimal.
    const clamped = Number(value.toPrecision(MAX_DIGITS));
    return String(clamped);
}

/**
 * Muestra la entrada que se está tecleando, agrupando solo la parte entera.
 *
 * La parte decimal se copia literal para que un «12.» o un «1.50» a medio
 * escribir no se reescriba bajo los pies del usuario.
 */
export function formatEntry(entry: string): string {
    if (entry === '' || entry === '-') return entry === '-' ? '-0' : '0';

    // Un resultado en notación científica se muestra tal cual: agrupar millares
    // en «1e10» no tiene sentido.
    if (entry.includes('e') || entry.includes('E')) return entry;

    const negative = entry.startsWith('-');
    const body = negative ? entry.slice(1) : entry;
    const dot = body.indexOf('.');

    const integerPart = dot === -1 ? body : body.slice(0, dot);
    const rest = dot === -1 ? '' : body.slice(dot);

    const grouped = integerPart === ''
        ? '0'
        : GROUPED.format(Number(integerPart));

    return `${negative ? '-' : ''}${grouped}${rest}`;
}

/** Tasa en CUP para las tarjetas: siempre dos decimales. */
export function formatRate(value: number): string {
    return value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

/**
 * Resultado de una conversión, con decimales según la magnitud.
 *
 * Un resultado de 0.0012 USD necesita más decimales que uno de 81,500 CUP para
 * decir algo útil; dos decimales fijos mostrarían «0.00».
 */
export function formatConverted(value: number): string {
    if (!Number.isFinite(value)) return '—';

    const abs = Math.abs(value);
    const decimals = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;

    return value.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

/** Variación con signo explícito, para los indicadores ▲▼. */
export function formatChange(change: number): string {
    const sign = change > 0 ? '+' : '';
    return `${sign}${change.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export type Freshness = 'fresh' | 'aging' | 'stale';

export interface Age {
    readonly label: string;
    readonly freshness: Freshness;
    readonly hours: number;
}

const HOUR = 3_600_000;

/**
 * Antigüedad de un dato, en texto y en nivel de alarma.
 *
 * Importa mostrarlo siempre: con una conexión intermitente, una tasa de ayer es
 * útil —pero solo si quien la lee sabe que es de ayer. La app anterior mostraba
 * datos de hace tres meses como si fueran de hoy.
 */
export function describeAge(iso: string | null | undefined, now: number = Date.now()): Age {
    if (!iso) return { label: 'sin fecha', freshness: 'stale', hours: Infinity };

    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return { label: 'sin fecha', freshness: 'stale', hours: Infinity };

    const diff = Math.max(0, now - then);
    const hours = diff / HOUR;
    const freshness: Freshness = hours > 24 ? 'stale' : hours > 6 ? 'aging' : 'fresh';

    const minutes = Math.floor(diff / 60_000);
    let label: string;
    if (minutes < 1) label = 'hace un momento';
    else if (minutes < 60) label = `hace ${minutes} min`;
    else if (hours < 24) label = `hace ${Math.floor(hours)} h`;
    else {
        const days = Math.floor(hours / 24);
        label = days === 1 ? 'hace 1 día' : `hace ${days} días`;
    }

    return { label, freshness, hours };
}
