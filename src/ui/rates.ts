/**
 * Pantalla de tasas: la principal de la app.
 *
 * Decisiones que vale la pena justificar:
 *
 * - **La fuente se nombra siempre.** Las tasas no salen de elToque (su API
 *   exige una key que no entregan), así que presentarlas como «las de elToque»
 *   sería falso. La píldora superior dice de dónde viene el número.
 * - **La antigüedad se muestra siempre**, con color según el nivel. La versión
 *   anterior mostraba datos de hacía tres meses sin ninguna señal.
 * - **El mercado es explícito en el conversor.** 100 USD son 81.500 CUP al
 *   informal y 72.900 al Segmento III; dejar eso implícito da cifras erróneas.
 */

import { CURRENCY_LABELS } from '../config';
import { availableCurrencies, convert, type Market, type RateTable } from '../core/convert';
import {
    describeAge,
    formatChange,
    formatConverted,
    formatRate,
    type Freshness,
} from '../core/format';
import { cachedRates, fetchRates, type RateBlock, type RatesDocument } from '../data/rates';
import { getSettings, updateSettings } from '../state/settings';
import { ICONS, el, icon, replace } from './dom';
import { showScreen } from './screens';

const REFRESH_LABEL: Record<Freshness, string> = {
    fresh: 'Datos recientes',
    aging: 'Datos de hace unas horas',
    stale: 'Datos desactualizados',
};

/** Cada cuánto se repinta el texto «hace X min». No toca la red. */
const AGE_TICK_MS = 60_000;

/**
 * Cada cuánto se buscan tasas nuevas con la pantalla abierta.
 *
 * El pipeline publica cada 30 min, así que con 5 min de sondeo el desfase
 * máximo es pequeño. El coste en datos es casi nulo: la petición lleva
 * `cache: 'no-cache'`, de modo que si el fichero no cambió el servidor responde
 * 304 sin cuerpo. Eso importa con tarifas de datos caras.
 */
const AUTO_REFRESH_MS = 5 * 60_000;

/** Suelo entre peticiones, para no machacar al alternar entre apps. */
const MIN_FETCH_GAP_MS = 60_000;

/**
 * Normaliza un importe tecleado.
 *
 * La coma se descarta como separador de millares, en coherencia con el formato
 * que la app muestra («1,234.56»): quien ve ese formato teclea el decimal con
 * punto.
 */
function parseAmount(raw: string): number | null {
    const normalized = raw.trim().replace(/[\s,]/g, '');
    if (normalized === '' || normalized === '-') return null;
    if (!/^-?\d*\.?\d*$/.test(normalized)) return null;

    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
}

interface ConverterState {
    market: Market;
    from: string;
    to: string;
    amount: string;
}

export interface RatesScreen {
    /** Entrar en la pantalla: refresca en silencio y arranca el contador. */
    enter: () => void;
    /** Salir: detiene el contador para no gastar batería de fondo. */
    leave: () => void;
    /** Repinta sin tocar la red, p. ej. tras cambiar ajustes. */
    rerender: () => void;
    /** Documento cargado, que Ajustes necesita para listar monedas y fuentes. */
    document: () => RatesDocument | null;
}

export function createRatesScreen(panel: HTMLElement): RatesScreen {
    let document_: RatesDocument | null = cachedRates();
    let refreshing = false;
    let lastFetch = 0;
    let ticker: number | undefined;

    const converter: ConverterState = {
        market: getSettings().defaultMarket,
        from: 'USD',
        to: 'CUP',
        amount: '1',
    };

    // ── Estructura estática ────────────────────────────────────────────────
    const statusSlot = el('div', { class: 'status' });
    const informalSlot = el('section', { class: 'section' });
    const officialSlot = el('section', { class: 'section' });
    const converterSlot = el('section', { class: 'card converter' });

    const refreshButton = el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': 'Actualizar tasas',
    }, [icon(ICONS.refresh, 18, 2.2)]);
    refreshButton.addEventListener('click', () => void refresh('manual'));

    const header = el('header', { class: 'app-header' }, [
        el('button', {
            class: 'icon-btn',
            type: 'button',
            'aria-label': 'Abrir la calculadora',
        }, [icon(ICONS.calculator, 19, 1.8)]),
        el('h1', { class: 'app-title' }, ['Tasas']),
        el('div', { class: 'header-actions' }, [
            refreshButton,
            el('button', {
                class: 'icon-btn',
                type: 'button',
                'aria-label': 'Ajustes',
            }, [icon(ICONS.settings, 18, 1.8)]),
        ]),
    ]);

    const [calcButton] = header.getElementsByClassName('icon-btn');
    calcButton?.addEventListener('click', () => showScreen('calc'));
    header.querySelector('[aria-label="Ajustes"]')
        ?.addEventListener('click', () => showScreen('settings'));

    replace(panel, [
        header,
        el('div', { class: 'scroll' }, [
            statusSlot,
            informalSlot,
            officialSlot,
            converterSlot,
        ]),
    ]);

    // ── Render ─────────────────────────────────────────────────────────────

    function renderStatus(): void {
        const block = activeBlock();
        if (!block) {
            replace(statusSlot, []);
            return;
        }

        const age = describeAge(block.updated_at);
        statusSlot.className = `status status--${age.freshness}`;

        replace(statusSlot, [
            el('span', { class: 'status__dot', 'aria-hidden': 'true' }),
            el('span', { class: 'status__text' }, [`Actualizado ${age.label}`]),
            el('a', {
                class: 'status__source',
                href: block.source_url,
                target: '_blank',
                rel: 'noopener noreferrer',
            }, [block.label]),
        ]);
        statusSlot.title = REFRESH_LABEL[age.freshness];
    }

    function rateCard(code: string, entry: RateTable[string], highlight: boolean): HTMLElement {
        const change = entry?.change ?? null;
        const direction = change === null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down';

        return el('article', { class: `rate${highlight ? ' rate--primary' : ''}` }, [
            el('div', { class: 'rate__head' }, [
                el('span', { class: 'rate__code' }, [code]),
                change !== null && change !== 0
                    ? el('span', {
                        class: `rate__change rate__change--${direction}`,
                        title: `${direction === 'up' ? 'Subió' : 'Bajó'} ${formatChange(change)} CUP`,
                    }, [
                        el('span', { 'aria-hidden': 'true' }, [direction === 'up' ? '▲' : '▼']),
                        ` ${formatChange(change)}`,
                    ])
                    : null,
            ]),
            el('div', { class: 'rate__value' }, [
                formatRate(entry?.cup ?? 0),
                el('span', { class: 'rate__unit' }, [' CUP']),
            ]),
            el('div', { class: 'rate__label' }, [CURRENCY_LABELS[code] ?? code]),
        ]);
    }

    function renderBlock(slot: HTMLElement, block: RateBlock | undefined, title: string,
                         subtitle: string | null): void {
        if (!block || Object.keys(block.rates).length === 0) {
            replace(slot, []);
            return;
        }

        const hidden = new Set(getSettings().hiddenCurrencies);
        const codes = availableCurrencies(block.rates)
            .filter((code) => code !== 'CUP' && !hidden.has(code));

        replace(slot, [
            el('div', { class: 'section__head' }, [
                el('h2', { class: 'section__title' }, [title]),
                subtitle ? el('span', { class: 'section__sub' }, [subtitle]) : null,
            ]),
            block.carried_over
                ? el('p', { class: 'notice' }, [
                    'No se pudo contactar la fuente en la última actualización. '
                    + 'Se muestra el último valor conocido.',
                ])
                : null,
            block.disputed && block.disputed.length > 0
                ? el('p', { class: 'notice' }, [
                    `Las fuentes no coinciden en ${block.disputed.join(', ')}. `
                    + 'Tómalo como referencia aproximada.',
                ])
                : null,
            el('div', { class: 'grid' },
                codes.map((code, index) => rateCard(code, block.rates[code]!, index === 0)),
            ),
        ]);
    }

    function renderConverter(): void {
        const table = activeTable();
        const codes = availableCurrencies(table);

        if (codes.length <= 1) {
            replace(converterSlot, []);
            return;
        }

        // Si la moneda elegida no existe en el mercado seleccionado (el oficial
        // no cotiza MLC ni Zelle), se cae a una que sí.
        if (!codes.includes(converter.from)) converter.from = codes[1] ?? 'CUP';
        if (!codes.includes(converter.to)) converter.to = 'CUP';

        const amountInput = el('input', {
            class: 'field field--amount',
            type: 'text',
            inputmode: 'decimal',
            autocomplete: 'off',
            'aria-label': 'Importe a convertir',
            value: converter.amount,
        });

        const result = el('output', {
            class: 'field field--result',
            'aria-live': 'polite',
            'aria-label': 'Resultado de la conversión',
        });

        const select = (current: string, label: string) => {
            const node = el('select', { class: 'field field--currency', 'aria-label': label });
            for (const code of codes) {
                node.appendChild(el('option', { value: code, selected: code === current }, [code]));
            }
            return node;
        };

        const fromSelect = select(converter.from, 'Moneda de origen');
        const toSelect = select(converter.to, 'Moneda de destino');

        const update = () => {
            converter.amount = amountInput.value;
            converter.from = fromSelect.value;
            converter.to = toSelect.value;

            const amount = parseAmount(converter.amount);
            if (amount === null) {
                result.value = '';
                result.textContent = '';
                return;
            }

            const converted = convert(amount, converter.from, converter.to, activeTable());
            result.textContent = converted === null ? '—' : formatConverted(converted);
        };

        amountInput.addEventListener('input', update);
        fromSelect.addEventListener('change', update);
        toSelect.addEventListener('change', update);

        const swap = el('button', {
            class: 'swap',
            type: 'button',
            'aria-label': 'Intercambiar monedas',
        }, [icon(ICONS.swap, 18, 2.2)]);

        swap.addEventListener('click', () => {
            // Se intercambia usando el resultado numérico, no el texto
            // formateado: reparsear «81,500» daría 81.
            const amount = parseAmount(converter.amount);
            const converted = amount === null
                ? null
                : convert(amount, converter.from, converter.to, activeTable());

            [converter.from, converter.to] = [converter.to, converter.from];
            if (converted !== null) converter.amount = String(Number(converted.toPrecision(9)));

            renderConverter();
        });

        replace(converterSlot, [
            el('div', { class: 'converter__head' }, [
                el('h2', { class: 'section__title' }, ['Convertir']),
                marketToggle(),
            ]),
            el('div', { class: 'converter__row' }, [amountInput, fromSelect]),
            swap,
            el('div', { class: 'converter__row' }, [result, toSelect]),
        ]);

        update();
    }

    function marketToggle(): HTMLElement {
        const group = el('div', {
            class: 'segmented',
            role: 'radiogroup',
            'aria-label': 'Mercado',
        });

        const options: [Market, string][] = [
            ['informal', 'Informal'],
            ['official', 'Oficial'],
        ];

        for (const [value, label] of options) {
            const available = Boolean(blockFor(value));
            const button = el('button', {
                class: `segmented__item${converter.market === value ? ' segmented__item--on' : ''}`,
                type: 'button',
                role: 'radio',
                'aria-checked': String(converter.market === value),
                disabled: !available,
            }, [label]);

            button.addEventListener('click', () => {
                converter.market = value;
                updateSettings({ defaultMarket: value });
                renderConverter();
            });
            group.appendChild(button);
        }

        return group;
    }

    function renderEmpty(): void {
        replace(statusSlot, []);
        replace(officialSlot, []);
        replace(converterSlot, []);
        replace(informalSlot, [
            el('div', { class: 'empty' }, [
                el('p', { class: 'empty__title' }, ['Sin tasas disponibles']),
                el('p', { class: 'empty__text' }, [
                    'Abre la app una vez con conexión para guardar las tasas y poder '
                    + 'consultarlas después sin internet.',
                ]),
                (() => {
                    const retry = el('button', { class: 'btn-primary', type: 'button' }, ['Reintentar']);
                    retry.addEventListener('click', () => void refresh('manual'));
                    return retry;
                })(),
            ]),
        ]);
    }

    function renderSkeleton(): void {
        replace(informalSlot, [
            el('div', { class: 'grid' },
                Array.from({ length: 4 }, () => el('div', { class: 'rate rate--skeleton' })),
            ),
        ]);
    }

    function render(): void {
        if (!document_) {
            renderEmpty();
            return;
        }

        renderStatus();
        renderBlock(informalSlot, document_.informal, 'Mercado informal', null);
        renderBlock(
            officialSlot,
            document_.official,
            'Oficial',
            document_.official ? `Segmento ${document_.official.segment ?? 'III'}` : null,
        );
        renderConverter();
    }

    // ── Datos ──────────────────────────────────────────────────────────────

    function blockFor(market: Market): RateBlock | undefined {
        return market === 'informal' ? document_?.informal : document_?.official;
    }

    /** Bloque de referencia para la píldora de estado: el informal manda. */
    function activeBlock(): RateBlock | undefined {
        return document_?.informal ?? document_?.official;
    }

    function activeTable(): RateTable {
        return blockFor(converter.market)?.rates ?? {};
    }

    /**
     * Busca tasas nuevas.
     *
     * `manual` lo pide el usuario con el botón y siempre va a la red. `auto` es
     * oportunista: se salta si acaba de haber una petición o si no hay conexión,
     * para no gastar datos en balde.
     */
    async function refresh(mode: 'manual' | 'auto'): Promise<void> {
        if (refreshing) return;
        if (mode === 'auto') {
            if (!navigator.onLine) return;
            if (Date.now() - lastFetch < MIN_FETCH_GAP_MS) return;
        }

        refreshing = true;
        lastFetch = Date.now();
        refreshButton.classList.add('is-spinning');

        if (!document_) renderSkeleton();

        const { document: fresh } = await fetchRates();
        if (fresh) document_ = fresh;

        refreshing = false;
        refreshButton.classList.remove('is-spinning');
        render();
    }

    function startTicker(): void {
        stopTicker();
        ticker = window.setInterval(() => {
            renderStatus();
            if (Date.now() - lastFetch >= AUTO_REFRESH_MS) void refresh('auto');
        }, AGE_TICK_MS);
    }

    function stopTicker(): void {
        if (ticker !== undefined) {
            window.clearInterval(ticker);
            ticker = undefined;
        }
    }

    // Dos momentos en los que el dato casi siempre está viejo y el usuario
    // espera verlo fresco sin pedir nada:
    //
    //  - Volver a la app desde segundo plano. En móvil es EL caso: la app vive
    //    minutos u horas suspendida y al reabrirla mostraba lo de antes.
    //  - Recuperar la conexión. Si falló por estar sin cobertura, reintentar en
    //    cuanto vuelve es justo lo que hace falta.
    //
    // Se registran una sola vez, en la creación de la pantalla.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void refresh('auto');
    });
    window.addEventListener('online', () => void refresh('auto'));

    render();
    if (!document_) renderSkeleton();

    return {
        enter: () => {
            startTicker();
            void refresh('auto');
        },
        leave: stopTicker,
        rerender: () => {
            converter.market = getSettings().defaultMarket;
            render();
        },
        document: () => document_,
    };
}
