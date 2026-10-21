/**
 * Punto único de configuración. Cambiar de dominio es cambiar `SITE_URL`.
 *
 * ## La trampa del WebView
 *
 * En la app nativa (Capacitor) la página se sirve desde un origen local —
 * `https://localhost` — no desde el dominio real. Una ruta relativa como
 * `./data/rates.json` apuntaría al localhost del teléfono y **nunca** llegaría
 * a internet: la app compilaría, arrancaría y se quedaría sin tasas para
 * siempre, sin un error visible.
 *
 * Por eso todo recurso remoto pasa por `remote()`, que usa ruta relativa en la
 * web (para que funcione en cualquier dominio o en `localhost` de desarrollo) y
 * absoluta en nativo.
 */

export const SITE_URL = 'https://acomo.palmeiromed.com';

export const APP_NAME = 'A Cómo';
export const APP_VERSION = __APP_VERSION__;

interface CapacitorGlobal {
    isNativePlatform?: () => boolean;
    Plugins?: Record<string, unknown>;
}

declare global {
    interface Window {
        Capacitor?: CapacitorGlobal;
    }
}

/** ¿Corre dentro del WebView nativo en vez de un navegador? */
export function isNative(): boolean {
    return Boolean(window.Capacitor?.isNativePlatform?.());
}

function remote(path: string): string {
    return isNative() ? `${SITE_URL}/${path}` : `./${path}`;
}

export const RATES_URL = remote('data/rates.json');
export const HISTORY_URL = remote('data/history.json');

/** Siempre absoluta: solo la consulta la app nativa. */
export const OTA_MANIFEST_URL = `${SITE_URL}/ota/manifest.json`;

/** Nombres legibles de las monedas, para las tarjetas. */
export const CURRENCY_LABELS: Readonly<Record<string, string>> = {
    USD: 'Dólar estadounidense',
    EUR: 'Euro',
    MLC: 'Moneda Libremente Convertible',
    ZELLE: 'Zelle',
    CLA: 'Tarjeta Clásica',
    CAD: 'Dólar canadiense',
    MXN: 'Peso mexicano',
    GBP: 'Libra esterlina',
    CHF: 'Franco suizo',
    CNY: 'Yuan chino',
    RUB: 'Rublo ruso',
    CUP: 'Peso cubano',
};
