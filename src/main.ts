/**
 * Arranque de la app: conecta pantallas, tema, service worker y OTA.
 *
 * El orden importa. El tema se aplica antes de pintar nada para que no haya un
 * destello blanco en modo oscuro, y `initOta()` se llama cuanto antes porque el
 * plugin necesita su `notifyAppReady()` dentro de los primeros 10 s o revierte
 * el bundle (ver ota/updater.ts).
 */

import './styles/tokens.css';
import './styles/base.css';
import './styles/rates.css';
import './styles/calc.css';
import './styles/settings.css';

import { APP_VERSION } from './config';
import { initOta } from './ota/updater';
import { getSettings, onSettingsChange, resolveStartScreen } from './state/settings';
import { createCalcScreen } from './ui/calc';
import { installKeyboardRouting, registerScreen, showScreen } from './ui/screens';
import { createRatesScreen } from './ui/rates';
import { createSettingsScreen } from './ui/settings';
import { applyTheme, watchSystemTheme } from './ui/theme';

function panel(id: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(`[data-screen="${id}"]`);
    if (!node) throw new Error(`Falta el panel de la pantalla «${id}»`);
    return node;
}

function setupOfflineIndicator(): void {
    const sync = () => document.body.classList.toggle('is-offline', !navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    sync();
}

/**
 * Registra el service worker y avisa cuando hay una versión nueva esperando.
 *
 * Se mantiene el banner de la versión anterior —funcionaba bien— pero se arregla
 * el caso en que `installing` llega nulo, que lanzaba una excepción silenciosa.
 */
function registerServiceWorker(): void {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('./sw.js').then((registration) => {
        const banner = document.getElementById('update-banner');
        if (!banner) return;

        const reveal = () => {
            if (banner.classList.contains('is-visible')) return;
            banner.classList.add('is-visible');

            document.getElementById('update-apply')?.addEventListener('click', () => {
                registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
            });
            document.getElementById('update-dismiss')?.addEventListener('click', () => {
                banner.classList.remove('is-visible');
            });
        };

        if (registration.waiting) reveal();

        registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
                // `controller` presente significa que ya había una versión
                // instalada: esto es una actualización, no la primera carga.
                if (worker.state === 'installed' && navigator.serviceWorker.controller) reveal();
            });
        });
    }).catch(() => {
        /* sin service worker la app sigue funcionando, solo sin modo offline */
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
    });
}

function start(): void {
    applyTheme(getSettings().theme);
    watchSystemTheme(() => getSettings().theme);

    initOta();

    const rates = createRatesScreen(panel('rates'));
    const calc = createCalcScreen(panel('calc'));
    const settings = createSettingsScreen(panel('settings'), rates.document);

    registerScreen('rates', { onEnter: rates.enter, onLeave: rates.leave });
    registerScreen('calc', { onEnter: calc.enter, onKey: calc.onKey });
    registerScreen('settings', { onEnter: settings.enter });

    installKeyboardRouting();

    onSettingsChange((next) => {
        applyTheme(next.theme);
        rates.rerender();
    });

    showScreen(resolveStartScreen());

    setupOfflineIndicator();
    registerServiceWorker();

    console.info(`A Cómo ${APP_VERSION}`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
    start();
}
