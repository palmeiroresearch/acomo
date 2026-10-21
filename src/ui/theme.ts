/**
 * Tema claro/oscuro.
 *
 * Tres estados, no dos: `light`, `dark` y `system`. En `system` no se marca
 * nada en el DOM y manda `prefers-color-scheme`; una elección explícita pone
 * `data-theme` en la raíz, y el CSS la hace ganar en ambos sentidos (ver
 * styles/tokens.css).
 *
 * El `theme-color` del meta se actualiza a mano porque es lo que pinta la barra
 * de estado del sistema en la PWA instalada y en el WebView nativo: si no se
 * sincroniza, queda una franja negra sobre una app clara.
 */

import type { ThemeChoice } from '../state/settings';

const QUERY = '(prefers-color-scheme: dark)';

// Deben coincidir con --color-bg en styles/tokens.css.
const BACKGROUNDS: Record<'light' | 'dark', string> = {
    light: '#f2f2f7',
    dark: '#000000',
};

function prefersDark(): boolean {
    return window.matchMedia?.(QUERY).matches ?? false;
}

/** Tema efectivo tras resolver `system`. */
export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
    if (choice === 'system') return prefersDark() ? 'dark' : 'light';
    return choice;
}

export function applyTheme(choice: ThemeChoice): void {
    const root = document.documentElement;

    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);

    const resolved = resolveTheme(choice);
    root.style.colorScheme = resolved;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', BACKGROUNDS[resolved]);
}

/**
 * Reacciona al cambio de tema del sistema mientras la preferencia sea `system`.
 * Devuelve la función para dejar de escuchar.
 */
export function watchSystemTheme(getChoice: () => ThemeChoice): () => void {
    const media = window.matchMedia?.(QUERY);
    if (!media) return () => {};

    const handler = () => {
        if (getChoice() === 'system') applyTheme('system');
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
}
