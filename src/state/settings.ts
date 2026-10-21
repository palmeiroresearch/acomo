/**
 * Preferencias del usuario, persistidas en localStorage.
 *
 * Lectura tolerante a propósito: cualquier valor corrupto, de una versión
 * anterior o escrito a mano cae al valor por defecto en vez de romper el
 * arranque. Unas preferencias ilegibles no deben dejar a nadie sin app.
 */

export type ScreenId = 'rates' | 'calc' | 'settings';
export type StartScreen = 'rates' | 'calc' | 'last';
export type ThemeChoice = 'system' | 'light' | 'dark';
export type Market = 'informal' | 'official';

export interface Settings {
    /** Pantalla al abrir. Por defecto las tasas: es el motivo principal de uso. */
    readonly startScreen: StartScreen;
    readonly theme: ThemeChoice;
    /** Mercado preseleccionado en el conversor. */
    readonly defaultMarket: Market;
    /** Última pantalla visitada, para `startScreen: 'last'`. */
    readonly lastScreen: ScreenId;
    /** Monedas que el usuario ocultó de la lista de tasas. */
    readonly hiddenCurrencies: readonly string[];
}

const DEFAULTS: Settings = {
    startScreen: 'rates',
    theme: 'system',
    defaultMarket: 'informal',
    lastScreen: 'rates',
    hiddenCurrencies: [],
};

const KEY = 'acomo:settings:v1';

const START_SCREENS: readonly StartScreen[] = ['rates', 'calc', 'last'];
const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
const MARKETS: readonly Market[] = ['informal', 'official'];
const SCREENS: readonly ScreenId[] = ['rates', 'calc', 'settings'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : fallback;
}

function read(): Settings {
    let raw: unknown;
    try {
        const stored = localStorage.getItem(KEY);
        raw = stored ? JSON.parse(stored) : null;
    } catch {
        raw = null;
    }

    const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

    return {
        startScreen: oneOf(source.startScreen, START_SCREENS, DEFAULTS.startScreen),
        theme: oneOf(source.theme, THEMES, DEFAULTS.theme),
        defaultMarket: oneOf(source.defaultMarket, MARKETS, DEFAULTS.defaultMarket),
        lastScreen: oneOf(source.lastScreen, SCREENS, DEFAULTS.lastScreen),
        hiddenCurrencies: Array.isArray(source.hiddenCurrencies)
            ? source.hiddenCurrencies.filter((code): code is string => typeof code === 'string')
            : DEFAULTS.hiddenCurrencies,
    };
}

let current = read();
const listeners = new Set<(settings: Settings) => void>();

export function getSettings(): Settings {
    return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
    current = { ...current, ...patch };
    try {
        localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
        /* sin almacenamiento: las preferencias duran solo esta sesión */
    }
    for (const listener of listeners) listener(current);
    return current;
}

export function onSettingsChange(listener: (settings: Settings) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Pantalla con la que arrancar, resolviendo la opción «la última usada». */
export function resolveStartScreen(settings: Settings = current): ScreenId {
    if (settings.startScreen === 'last') {
        return settings.lastScreen === 'settings' ? 'rates' : settings.lastScreen;
    }
    return settings.startScreen;
}
