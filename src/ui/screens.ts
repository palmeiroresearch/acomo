/**
 * Navegación entre pantallas.
 *
 * Son tres paneles apilados que se desplazan horizontalmente. Se mantiene el
 * enfoque de la versión anterior —CSS transform en vez de un router— porque no
 * hay URLs que compartir y así la transición es fluida incluso en teléfonos
 * modestos, que es el escenario real.
 *
 * Lo que sí se añade: avisar a cada pantalla de que entra o sale, para que
 * puedan arrancar y parar su trabajo (refrescos, temporizadores) en vez de
 * dejarlo corriendo de fondo gastando batería y datos.
 */

import { updateSettings, type ScreenId } from '../state/settings';

export interface ScreenHooks {
    onEnter?: () => void;
    onLeave?: () => void;
    /** Teclas que la pantalla consume mientras está activa. */
    onKey?: (event: KeyboardEvent) => void;
}

const hooks = new Map<ScreenId, ScreenHooks>();
let active: ScreenId | null = null;

export function registerScreen(id: ScreenId, screenHooks: ScreenHooks): void {
    hooks.set(id, screenHooks);
}

export function currentScreen(): ScreenId | null {
    return active;
}

export function showScreen(id: ScreenId): void {
    if (active === id) return;

    if (active) hooks.get(active)?.onLeave?.();

    for (const panel of document.querySelectorAll<HTMLElement>('.screen')) {
        const isTarget = panel.dataset.screen === id;
        panel.classList.toggle('screen--active', isTarget);
        // Fuera del flujo de foco y de los lectores de pantalla: sin esto, el
        // tabulador pasea por los botones de pantallas invisibles.
        panel.setAttribute('aria-hidden', String(!isTarget));
        if (isTarget) panel.removeAttribute('inert');
        else panel.setAttribute('inert', '');
    }

    active = id;
    hooks.get(id)?.onEnter?.();

    // Solo se recuerdan las pantallas de contenido: arrancar en Ajustes no es
    // lo que nadie espera, aunque haya sido la última visitada.
    if (id !== 'settings') updateSettings({ lastScreen: id });
}

/** Enruta el teclado a la pantalla activa. */
export function installKeyboardRouting(): void {
    document.addEventListener('keydown', (event) => {
        if (!active) return;

        // No secuestrar el teclado mientras se escribe en un campo.
        const target = event.target as HTMLElement | null;
        if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

        hooks.get(active)?.onKey?.(event);
    });
}
