/**
 * Pantalla de calculadora.
 *
 * Se conserva la distribución estilo iOS de la versión anterior —era lo mejor
 * resuelto del código original— y también su patrón de construir los botones
 * desde una tabla de descriptores con delegación de eventos: un solo listener
 * en la rejilla en vez de veinte.
 *
 * El cambio funcional es el borrado. Antes la tecla Backspace estaba mapeada a
 * `AC`, así que corregir un dígito obligaba a reescribir el número entero. Hay
 * ahora un botón de retroceso junto a la pantalla, visible solo cuando hay algo
 * que borrar, además de la tecla.
 */

import { Calculator, type CalculatorState, type Operator } from '../core/calculator';
import { ICONS, el, icon, replace } from './dom';
import { showScreen } from './screens';

type ButtonKind = 'number' | 'operator' | 'utility' | 'decimal' | 'equals';

interface ButtonSpec {
    readonly label: string;
    readonly kind: ButtonKind;
    readonly value: string;
    readonly wide?: boolean;
    /** Nombre para lectores de pantalla cuando el símbolo no se lee bien. */
    readonly aria?: string;
}

const LAYOUT: readonly ButtonSpec[] = [
    { label: 'AC', kind: 'utility', value: 'clear', aria: 'Borrar todo' },
    { label: '±', kind: 'utility', value: 'sign', aria: 'Cambiar signo' },
    { label: '%', kind: 'utility', value: 'percent', aria: 'Porcentaje' },
    { label: '÷', kind: 'operator', value: '/', aria: 'Dividir' },

    { label: '7', kind: 'number', value: '7' },
    { label: '8', kind: 'number', value: '8' },
    { label: '9', kind: 'number', value: '9' },
    { label: '×', kind: 'operator', value: '*', aria: 'Multiplicar' },

    { label: '4', kind: 'number', value: '4' },
    { label: '5', kind: 'number', value: '5' },
    { label: '6', kind: 'number', value: '6' },
    { label: '−', kind: 'operator', value: '-', aria: 'Restar' },

    { label: '1', kind: 'number', value: '1' },
    { label: '2', kind: 'number', value: '2' },
    { label: '3', kind: 'number', value: '3' },
    { label: '+', kind: 'operator', value: '+', aria: 'Sumar' },

    { label: '0', kind: 'number', value: '0', wide: true },
    { label: '.', kind: 'decimal', value: '.', aria: 'Coma decimal' },
    { label: '=', kind: 'equals', value: '=', aria: 'Igual' },
];

/** Tamaño de fuente del display según cuántos caracteres hay que encajar. */
const FONT_STEPS: readonly { readonly max: number; readonly size: string }[] = [
    { max: 6, size: 'var(--display-xl)' },
    { max: 9, size: 'var(--display-lg)' },
    { max: 12, size: 'var(--display-md)' },
    { max: Infinity, size: 'var(--display-sm)' },
];

const KEY_ACTIONS: Readonly<Record<string, [ButtonKind, string]>> = {
    '0': ['number', '0'], '1': ['number', '1'], '2': ['number', '2'],
    '3': ['number', '3'], '4': ['number', '4'], '5': ['number', '5'],
    '6': ['number', '6'], '7': ['number', '7'], '8': ['number', '8'],
    '9': ['number', '9'],
    '.': ['decimal', '.'], ',': ['decimal', '.'],
    '+': ['operator', '+'], '-': ['operator', '-'],
    '*': ['operator', '*'], x: ['operator', '*'], X: ['operator', '*'],
    '/': ['operator', '/'],
    Enter: ['equals', '='], '=': ['equals', '='],
    Escape: ['utility', 'clear'],
    Delete: ['utility', 'clear'],
    // Antes esto hacía un AC. Ahora borra un solo carácter, que es lo que
    // cualquiera espera de Backspace.
    Backspace: ['utility', 'backspace'],
    '%': ['utility', 'percent'],
};

export interface CalcScreen {
    enter: () => void;
    onKey: (event: KeyboardEvent) => void;
}

export function createCalcScreen(panel: HTMLElement): CalcScreen {
    const calc = new Calculator();

    const display = el('div', {
        class: 'display__value',
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': 'true',
    });

    const backspace = el('button', {
        class: 'display__backspace',
        type: 'button',
        'aria-label': 'Borrar el último dígito',
    }, [icon(['M20 6H9l-6 6 6 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z', 'M17 10l-5 4', 'M12 10l5 4'], 20, 1.8)]);

    const grid = el('div', { class: 'keypad' });
    const buttons = new Map<string, HTMLButtonElement>();

    for (const spec of LAYOUT) {
        const button = el('button', {
            class: `key key--${spec.kind}${spec.wide ? ' key--wide' : ''}`,
            type: 'button',
            'data-kind': spec.kind,
            'data-value': spec.value,
            'aria-label': spec.aria ?? spec.label,
        }, [spec.label]);

        buttons.set(spec.value, button);
        grid.appendChild(button);
    }

    const clearKey = buttons.get('clear');

    const header = el('header', { class: 'app-header' }, [
        el('button', {
            class: 'icon-btn',
            type: 'button',
            'aria-label': 'Volver a las tasas',
        }, [icon(ICONS.back, 20, 2.4)]),
        el('h1', { class: 'app-title' }, ['Calculadora']),
        el('div', { class: 'header-actions' }, [
            el('button', {
                class: 'icon-btn',
                type: 'button',
                'aria-label': 'Ver tasas de cambio',
            }, [icon(ICONS.exchange, 19, 2)]),
        ]),
    ]);

    header.querySelector('[aria-label="Volver a las tasas"]')
        ?.addEventListener('click', () => showScreen('rates'));
    header.querySelector('[aria-label="Ver tasas de cambio"]')
        ?.addEventListener('click', () => showScreen('rates'));

    replace(panel, [
        header,
        el('div', { class: 'calc-body' }, [
            el('div', { class: 'display' }, [backspace, display]),
            grid,
        ]),
    ]);

    // ── Interacción ────────────────────────────────────────────────────────

    function apply(kind: ButtonKind, value: string): void {
        let state: CalculatorState;

        switch (kind) {
            case 'number':
                state = calc.inputDigit(value);
                break;
            case 'decimal':
                state = calc.inputDecimal();
                break;
            case 'operator':
                state = calc.inputOperator(value as Operator);
                break;
            case 'equals':
                state = calc.calculate();
                break;
            case 'utility':
                if (value === 'clear') state = calc.clear();
                else if (value === 'sign') state = calc.toggleSign();
                else if (value === 'percent') state = calc.inputPercent();
                else if (value === 'backspace') state = calc.backspace();
                else return;
                break;
        }

        render(state);
    }

    function render(state: CalculatorState): void {
        display.textContent = state.display;

        const length = state.display.replace(/[,\s]/g, '').length;
        const step = FONT_STEPS.find((candidate) => length <= candidate.max);
        display.style.fontSize = step?.size ?? 'var(--display-sm)';

        if (clearKey) clearKey.textContent = state.showClear ? 'C' : 'AC';
        backspace.hidden = !state.showClear;

        for (const spec of LAYOUT) {
            if (spec.kind !== 'operator') continue;
            const button = buttons.get(spec.value);
            button?.classList.toggle('key--on', state.activeOperator === spec.value);
        }
    }

    grid.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.key');
        if (!button) return;
        const { kind, value } = button.dataset;
        if (kind && value) apply(kind as ButtonKind, value);
    });

    backspace.addEventListener('click', () => apply('utility', 'backspace'));

    /** Destello breve para que el teclado físico tenga respuesta visual. */
    function flash(value: string): void {
        const button = buttons.get(value);
        if (!button) return;
        button.classList.add('key--flash');
        window.setTimeout(() => button.classList.remove('key--flash'), 110);
    }

    render(calc.getState());

    return {
        enter: () => {},
        onKey: (event) => {
            const action = KEY_ACTIONS[event.key];
            if (!action) return;
            event.preventDefault();
            flash(action[1]);
            apply(action[0], action[1]);
        },
    };
}
