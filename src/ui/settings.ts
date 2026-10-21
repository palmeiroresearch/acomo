/**
 * Pantalla de ajustes.
 *
 * Existe sobre todo por una razón de producto: hay gente que quiere esta app
 * solo para la tasa y gente que la quiere como calculadora. En vez de partir la
 * app en dos o preguntar en el primer arranque, se elige aquí con qué pantalla
 * abre, y ambos perfiles quedan servidos.
 *
 * También es el sitio donde se dice de dónde salen los datos. Eso no es
 * decoración: las tasas no son las de elToque y quien las usa para una
 * transacción tiene derecho a saber qué está leyendo.
 */

import { APP_NAME, APP_VERSION, CURRENCY_LABELS, isNative } from '../config';
import { availableCurrencies } from '../core/convert';
import { describeAge } from '../core/format';
import type { RatesDocument } from '../data/rates';
import { checkForUpdate } from '../ota/updater';
import {
    getSettings,
    updateSettings,
    type Market,
    type StartScreen,
    type ThemeChoice,
} from '../state/settings';
import { ICONS, el, icon, replace } from './dom';
import { showScreen } from './screens';

export interface SettingsScreen {
    /** Se vuelve a pintar al entrar: las monedas dependen de las tasas cargadas. */
    enter: () => void;
}

type Option<T extends string> = readonly [value: T, label: string, hint?: string];

export function createSettingsScreen(
    panel: HTMLElement,
    getDocument: () => RatesDocument | null,
): SettingsScreen {
    const body = el('div', { class: 'scroll' });

    const header = el('header', { class: 'app-header' }, [
        el('button', {
            class: 'icon-btn',
            type: 'button',
            'aria-label': 'Volver',
        }, [icon(ICONS.back, 20, 2.4)]),
        el('h1', { class: 'app-title' }, ['Ajustes']),
        el('div', { class: 'header-actions' }),
    ]);

    header.querySelector('button')?.addEventListener('click', () => showScreen('rates'));

    replace(panel, [header, body]);

    /** Grupo de opciones excluyentes, estilo lista de iOS. */
    function radioGroup<T extends string>(
        legend: string,
        options: readonly Option<T>[],
        selected: T,
        onPick: (value: T) => void,
    ): HTMLElement {
        const group = el('div', { class: 'card', role: 'radiogroup', 'aria-label': legend });

        for (const [value, label, hint] of options) {
            const row = el('button', {
                class: 'row',
                type: 'button',
                role: 'radio',
                'aria-checked': String(value === selected),
            }, [
                el('span', { class: 'row__body' }, [
                    el('span', { class: 'row__label' }, [label]),
                    hint ? el('span', { class: 'row__hint' }, [hint]) : null,
                ]),
                el('span', {
                    class: `row__check${value === selected ? ' row__check--on' : ''}`,
                    'aria-hidden': 'true',
                }),
            ]);

            row.addEventListener('click', () => onPick(value));
            group.appendChild(row);
        }

        return group;
    }

    function section(title: string, ...content: (Node | null)[]): HTMLElement {
        return el('section', { class: 'section' }, [
            el('div', { class: 'section__head' }, [
                el('h2', { class: 'section__title' }, [title]),
            ]),
            ...content,
        ]);
    }

    function currencyToggles(): HTMLElement | null {
        const document_ = getDocument();
        const table = document_?.informal?.rates ?? document_?.official?.rates;
        if (!table) return null;

        const codes = availableCurrencies(table).filter((code) => code !== 'CUP');
        const hidden = new Set(getSettings().hiddenCurrencies);
        const card = el('div', { class: 'card' });

        for (const code of codes) {
            const visible = !hidden.has(code);
            const row = el('button', {
                class: 'row',
                type: 'button',
                role: 'switch',
                'aria-checked': String(visible),
            }, [
                el('span', { class: 'row__body' }, [
                    el('span', { class: 'row__label' }, [code]),
                    el('span', { class: 'row__hint' }, [CURRENCY_LABELS[code] ?? code]),
                ]),
                el('span', {
                    class: `toggle${visible ? ' toggle--on' : ''}`,
                    'aria-hidden': 'true',
                }, [el('span', { class: 'toggle__knob' })]),
            ]);

            row.addEventListener('click', () => {
                const next = new Set(getSettings().hiddenCurrencies);
                if (next.has(code)) next.delete(code);
                else next.add(code);
                updateSettings({ hiddenCurrencies: [...next] });
                render();
            });

            card.appendChild(row);
        }

        return card;
    }

    function updateRow(): HTMLElement | null {
        // En el navegador las actualizaciones las gestiona el service worker;
        // mostrar aquí un botón de OTA solo confundiría.
        if (!isNative()) return null;

        const status = el('span', { class: 'row__hint' }, ['Versión ' + APP_VERSION]);
        const button = el('button', { class: 'row', type: 'button' }, [
            el('span', { class: 'row__body' }, [
                el('span', { class: 'row__label' }, ['Buscar actualización']),
                status,
            ]),
        ]);

        button.addEventListener('click', async () => {
            button.disabled = true;
            status.textContent = 'Comprobando…';

            const result = await checkForUpdate();
            switch (result.state) {
                case 'staged':
                    status.textContent = `Versión ${result.latest} lista. Cierra y abre la app para aplicarla.`;
                    break;
                case 'up-to-date':
                    status.textContent = `Ya tienes la última versión (${result.running}).`;
                    break;
                case 'error':
                    status.textContent = 'No se pudo comprobar. Revisa la conexión.';
                    break;
                case 'unsupported':
                    status.textContent = 'No disponible en esta plataforma.';
                    break;
            }
            button.disabled = false;
        });

        return el('div', { class: 'card' }, [button]);
    }

    function about(): HTMLElement {
        const document_ = getDocument();
        const informal = document_?.informal;
        const official = document_?.official;

        return el('div', { class: 'card card--text' }, [
            el('p', { class: 'about__line' }, [
                el('strong', {}, [APP_NAME]), ` ${APP_VERSION}`,
            ]),
            informal
                ? el('p', { class: 'about__line' }, [
                    `Mercado informal: ${informal.label}, actualizado ${describeAge(informal.updated_at).label}.`,
                ])
                : null,
            official
                ? el('p', { class: 'about__line' }, [
                    `Oficial (Segmento ${official.segment ?? 'III'}): Banco Central de Cuba, `
                    + `${describeAge(official.updated_at).label}.`,
                ])
                : null,
            el('p', { class: 'about__note' }, [
                'Las tasas del mercado informal son referenciales y provienen de '
                + 'agregadores públicos, no de una entidad oficial. Verifica antes de '
                + 'cerrar una operación.',
            ]),
        ]);
    }

    function render(): void {
        const settings = getSettings();

        const startOptions: readonly Option<StartScreen>[] = [
            ['rates', 'Tasas', 'Lo que casi siempre vas a consultar'],
            ['calc', 'Calculadora'],
            ['last', 'La última que usé'],
        ];

        const themeOptions: readonly Option<ThemeChoice>[] = [
            ['system', 'Según el sistema'],
            ['light', 'Claro'],
            ['dark', 'Oscuro'],
        ];

        const marketOptions: readonly Option<Market>[] = [
            ['informal', 'Informal', 'La tasa de la calle'],
            ['official', 'Oficial', 'Segmento III del Banco Central'],
        ];

        const updates = updateRow();

        replace(body, [
            section('Al abrir la app',
                radioGroup('Pantalla de inicio', startOptions, settings.startScreen,
                    (value) => { updateSettings({ startScreen: value }); render(); }),
            ),
            section('Apariencia',
                radioGroup('Tema', themeOptions, settings.theme,
                    (value) => { updateSettings({ theme: value }); render(); }),
            ),
            section('Mercado por defecto',
                radioGroup('Mercado', marketOptions, settings.defaultMarket,
                    (value) => { updateSettings({ defaultMarket: value }); render(); }),
            ),
            section('Monedas visibles', currencyToggles()),
            updates ? section('Actualizaciones', updates) : null,
            section('Acerca de', about()),
        ]);
    }

    render();

    return { enter: render };
}
