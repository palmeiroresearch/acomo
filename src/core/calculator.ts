/**
 * Lógica de la calculadora. Pura, sin DOM, para poder testearla entera.
 *
 * ## Por qué se reescribió el estado
 *
 * La versión anterior guardaba el valor actual en `displayValue`, **ya
 * formateado con separadores de millares**, y después lo volvía a leer con
 * `parseFloat`. Como `parseFloat("1,500")` devuelve `1`, la secuencia
 * `500 × 3 = + 2 =` daba **3** en lugar de 1502. `toggleSign` e `inputPercent`
 * limpiaban las comas antes de parsear; `inputOperator` y `calculate` no.
 *
 * Aquí el estado separa las dos cosas:
 *
 * - `#entry` es la entrada en curso en **forma canónica** (sin separadores),
 *   la única fuente de verdad numérica.
 * - El formateo ocurre solo al construir el estado de salida.
 *
 * Así el bug no se parchea: deja de ser representable.
 *
 * El otro cambio estructural es el error. Antes se asignaba la cadena
 * `'Error'` a `displayValue` y acto seguido se llamaba a `_reset()`, que la
 * sobreescribía con `'0'` — de modo que `5 ÷ 0 =` mostraba `0`. Ahora el error
 * es un flag aparte del valor, así que ningún reset puede pisarlo.
 */

import { MAX_DIGITS, formatEntry, toEntry } from './format';

export type Operator = '+' | '-' | '*' | '/';

export interface CalculatorState {
    /** Texto listo para la pantalla. */
    readonly display: string;
    /** `true` → el botón debe decir «C»; `false` → «AC». */
    readonly showClear: boolean;
    /** Operador que debe aparecer resaltado, si hay alguno pendiente. */
    readonly activeOperator: Operator | null;
    readonly isError: boolean;
}

const ZERO_ENTRIES = new Set(['0', '-0']);

function countDigits(entry: string): number {
    let total = 0;
    for (const char of entry) {
        if (char >= '0' && char <= '9') total += 1;
    }
    return total;
}

export class Calculator {
    /** Entrada en curso, siempre canónica: dígitos, un punto y un signo. */
    #entry = '0';
    #accumulator: number | null = null;
    #operator: Operator | null = null;
    /** El próximo dígito empieza una entrada nueva (se acaba de pulsar operador). */
    #awaitingEntry = false;
    /** Se acaba de pulsar `=`: el próximo dígito empieza un cálculo nuevo. */
    #justEvaluated = false;
    #error = false;
    /** Para repetir la última operación al pulsar `=` varias veces. */
    #lastOperator: Operator | null = null;
    #lastOperand: number | null = null;

    getState(): CalculatorState {
        return {
            display: this.#error ? 'Error' : formatEntry(this.#entry),
            showClear: this.#error || !ZERO_ENTRIES.has(this.#entry) || this.#accumulator !== null,
            activeOperator: this.#awaitingEntry ? this.#operator : null,
            isError: this.#error,
        };
    }

    inputDigit(digit: string): CalculatorState {
        if (this.#error) this.#reset();

        if (this.#awaitingEntry || this.#justEvaluated) {
            // Tras un operador o un `=`, el dígito abre una entrada nueva.
            // El signo tecleado con ± antes del dígito sí se conserva.
            const sign = this.#awaitingEntry && this.#entry.startsWith('-') && ZERO_ENTRIES.has(this.#entry)
                ? '-'
                : '';
            this.#entry = digit === '0' ? `${sign}0` : `${sign}${digit}`;
            this.#awaitingEntry = false;
            this.#justEvaluated = false;
            return this.getState();
        }

        if (ZERO_ENTRIES.has(this.#entry)) {
            // Sin ceros a la izquierda, pero preservando un «-0» previo.
            if (digit !== '0') {
                this.#entry = `${this.#entry.startsWith('-') ? '-' : ''}${digit}`;
            }
            return this.getState();
        }

        if (countDigits(this.#entry) >= MAX_DIGITS) return this.getState();

        this.#entry += digit;
        return this.getState();
    }

    inputDecimal(): CalculatorState {
        if (this.#error) this.#reset();

        if (this.#awaitingEntry || this.#justEvaluated) {
            this.#entry = '0.';
            this.#awaitingEntry = false;
            this.#justEvaluated = false;
            return this.getState();
        }

        if (!this.#entry.includes('.')) this.#entry += '.';
        return this.getState();
    }

    inputOperator(operator: Operator): CalculatorState {
        if (this.#error) return this.getState();

        const current = this.#currentValue();

        if (this.#accumulator !== null && this.#operator !== null && !this.#awaitingEntry) {
            // Encadenado: se resuelve la operación pendiente antes de aceptar
            // la nueva, como en iOS.
            const result = compute(this.#accumulator, this.#operator, current);
            if (result === null) return this.#fail();
            this.#accumulator = result;
            this.#entry = toEntry(result);
        } else {
            this.#accumulator = current;
        }

        this.#operator = operator;
        this.#awaitingEntry = true;
        this.#justEvaluated = false;
        // Pulsar un operador cancela el «repetir última operación» de `=`.
        this.#lastOperator = null;
        this.#lastOperand = null;
        return this.getState();
    }

    calculate(): CalculatorState {
        if (this.#error) return this.getState();

        let result: number | null;

        if (this.#justEvaluated && this.#lastOperator !== null && this.#lastOperand !== null) {
            // `=` repetido reaplica la última operación sobre el resultado.
            result = compute(this.#currentValue(), this.#lastOperator, this.#lastOperand);
        } else if (this.#accumulator !== null && this.#operator !== null) {
            const second = this.#currentValue();
            this.#lastOperator = this.#operator;
            this.#lastOperand = second;
            result = compute(this.#accumulator, this.#operator, second);
        } else {
            return this.getState();
        }

        if (result === null) return this.#fail();

        this.#entry = toEntry(result);
        this.#accumulator = null;
        this.#operator = null;
        this.#awaitingEntry = false;
        this.#justEvaluated = true;
        return this.getState();
    }

    /** `C` borra la entrada en curso; `AC` reinicia todo. */
    clear(): CalculatorState {
        if (this.#error || ZERO_ENTRIES.has(this.#entry) || this.#justEvaluated) {
            this.#reset();
            return this.getState();
        }

        this.#entry = '0';
        this.#awaitingEntry = false;
        return this.getState();
    }

    toggleSign(): CalculatorState {
        if (this.#error) return this.getState();

        if (this.#awaitingEntry) {
            // Permite teclear el signo antes del operando: `5 × ± 3` → −3.
            this.#entry = '-0';
            this.#awaitingEntry = false;
            return this.getState();
        }

        this.#entry = this.#entry.startsWith('-') ? this.#entry.slice(1) : `-${this.#entry}`;

        if (this.#justEvaluated) {
            // Cambiar el signo del resultado se considera empezar a editarlo.
            this.#accumulator = null;
            this.#operator = null;
            this.#justEvaluated = false;
        }
        return this.getState();
    }

    inputPercent(): CalculatorState {
        if (this.#error) return this.getState();

        const current = this.#currentValue();
        const hasSecondOperand = !this.#awaitingEntry;

        // Con suma o resta, el porcentaje se interpreta sobre el primer
        // operando: `200 + 10 %` son 20, no 0.1. Con producto y división se
        // interpreta como fracción.
        const relative =
            this.#accumulator !== null &&
            hasSecondOperand &&
            (this.#operator === '+' || this.#operator === '-');

        const result = relative
            ? this.#accumulator! * (current / 100)
            : current / 100;

        this.#entry = toEntry(result);
        // El original no reiniciaba este flag y dejaba el estado inconsistente:
        // el siguiente dígito borraba el porcentaje recién calculado.
        this.#awaitingEntry = false;
        this.#justEvaluated = false;
        return this.getState();
    }

    /** Borra el último carácter. No existía: la tecla Backspace hacía un AC. */
    backspace(): CalculatorState {
        if (this.#error) {
            this.#reset();
            return this.getState();
        }

        if (this.#justEvaluated || this.#awaitingEntry) {
            // No se puede «retroceder» dentro de un resultado: se descarta.
            this.#entry = '0';
            this.#justEvaluated = false;
            this.#awaitingEntry = false;
            return this.getState();
        }

        const trimmed = this.#entry.slice(0, -1);
        this.#entry = trimmed === '' || trimmed === '-' ? '0' : trimmed;
        return this.getState();
    }

    /** Valor numérico de la entrada en curso. Nunca ve un separador de millares. */
    #currentValue(): number {
        const value = Number(this.#entry);
        return Number.isFinite(value) ? value : 0;
    }

    #fail(): CalculatorState {
        this.#reset();
        this.#error = true;
        return this.getState();
    }

    #reset(): void {
        this.#entry = '0';
        this.#accumulator = null;
        this.#operator = null;
        this.#awaitingEntry = false;
        this.#justEvaluated = false;
        this.#error = false;
        this.#lastOperator = null;
        this.#lastOperand = null;
    }
}

/** `null` señala una operación imposible (división por cero). */
function compute(a: number, operator: Operator, b: number): number | null {
    switch (operator) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? null : a / b;
    }
}
