import { describe, expect, it } from 'vitest';

import { Calculator } from './calculator';

/** Teclea una secuencia de dígitos y puntos, como lo haría un usuario. */
function type(calc: Calculator, keys: string): void {
    for (const key of keys) {
        if (key === '.') calc.inputDecimal();
        else calc.inputDigit(key);
    }
}

function display(calc: Calculator): string {
    return calc.getState().display;
}

describe('regresiones del código anterior', () => {
    it('encadena una operación sobre un resultado con separador de millares', () => {
        // El bug original: `calculate()` e `inputOperator()` hacían
        // parseFloat("1,500"), que da 1, así que esto devolvía 3.
        const calc = new Calculator();

        type(calc, '500');
        calc.inputOperator('*');
        type(calc, '3');
        calc.calculate();
        expect(display(calc)).toBe('1,500');

        calc.inputOperator('+');
        type(calc, '2');
        calc.calculate();

        expect(display(calc)).toBe('1,502');
    });

    it('mantiene la precisión al encadenar varios resultados agrupados', () => {
        const calc = new Calculator();

        type(calc, '1234567');
        calc.inputOperator('+');
        type(calc, '1');
        calc.calculate();
        expect(display(calc)).toBe('1,234,568');

        calc.inputOperator('-');
        type(calc, '568');
        calc.calculate();

        expect(display(calc)).toBe('1,234,000');
    });

    it('muestra Error al dividir por cero', () => {
        // El original asignaba 'Error' y luego llamaba a _reset(), que lo
        // sobreescribía con '0'.
        const calc = new Calculator();

        type(calc, '5');
        calc.inputOperator('/');
        type(calc, '0');
        calc.calculate();

        expect(display(calc)).toBe('Error');
        expect(calc.getState().isError).toBe(true);
    });

    it('sale del estado de error al teclear un número nuevo', () => {
        const calc = new Calculator();

        type(calc, '5');
        calc.inputOperator('/');
        type(calc, '0');
        calc.calculate();
        type(calc, '7');

        expect(display(calc)).toBe('7');
        expect(calc.getState().isError).toBe(false);
    });

    it('borra un solo dígito con backspace', () => {
        // Backspace estaba mapeado a AC: borraba todo.
        const calc = new Calculator();

        type(calc, '123');
        calc.backspace();

        expect(display(calc)).toBe('12');
    });

    it('deja el estado consistente tras un porcentaje', () => {
        // El original no reiniciaba `waitingForSecond`, así que el dígito
        // siguiente borraba el porcentaje recién calculado.
        const calc = new Calculator();

        type(calc, '200');
        calc.inputOperator('+');
        type(calc, '10');
        calc.inputPercent();
        expect(display(calc)).toBe('20');

        calc.calculate();

        expect(display(calc)).toBe('220');
    });
});

describe('aritmética básica', () => {
    it('suma, resta, multiplica y divide', () => {
        const cases: [string, '+' | '-' | '*' | '/', string, string][] = [
            ['7', '+', '8', '15'],
            ['10', '-', '25', '-15'],
            ['12', '*', '12', '144'],
            ['144', '/', '12', '12'],
        ];

        for (const [a, op, b, expected] of cases) {
            const calc = new Calculator();
            type(calc, a);
            calc.inputOperator(op);
            type(calc, b);
            calc.calculate();
            expect(display(calc)).toBe(expected);
        }
    });

    it('resuelve la operación pendiente al pulsar otro operador', () => {
        const calc = new Calculator();

        type(calc, '2');
        calc.inputOperator('+');
        type(calc, '3');
        calc.inputOperator('*');

        expect(display(calc)).toBe('5');

        type(calc, '4');
        calc.calculate();

        expect(display(calc)).toBe('20');
    });

    it('repite la última operación con `=` sucesivos', () => {
        const calc = new Calculator();

        type(calc, '2');
        calc.inputOperator('+');
        type(calc, '3');
        calc.calculate();
        expect(display(calc)).toBe('5');

        calc.calculate();
        expect(display(calc)).toBe('8');

        calc.calculate();
        expect(display(calc)).toBe('11');
    });

    it('deja de repetir cuando se pulsa un operador nuevo', () => {
        const calc = new Calculator();

        type(calc, '10');
        calc.inputOperator('+');
        type(calc, '5');
        calc.calculate();
        calc.inputOperator('-');
        type(calc, '5');
        calc.calculate();

        expect(display(calc)).toBe('10');
    });

    it('calcula decimales sin arrastrar error de coma flotante visible', () => {
        const calc = new Calculator();

        type(calc, '0.1');
        calc.inputOperator('+');
        type(calc, '0.2');
        calc.calculate();

        expect(display(calc)).toBe('0.3');
    });
});

describe('entrada de números', () => {
    it('suprime los ceros a la izquierda', () => {
        const calc = new Calculator();

        type(calc, '0005');

        expect(display(calc)).toBe('5');
    });

    it('admite un solo punto decimal', () => {
        const calc = new Calculator();

        type(calc, '1.2');
        calc.inputDecimal();
        type(calc, '5');

        expect(display(calc)).toBe('1.25');
    });

    it('agrupa los millares en la entrada en curso', () => {
        const calc = new Calculator();

        type(calc, '1234567');

        expect(display(calc)).toBe('1,234,567');
    });

    it('limita la entrada a 9 dígitos', () => {
        const calc = new Calculator();

        type(calc, '1234567890123');

        expect(display(calc)).toBe('123,456,789');
    });

    it('no cuenta el punto ni el signo en el límite de dígitos', () => {
        const calc = new Calculator();

        type(calc, '0.12345678');

        expect(display(calc)).toBe('0.12345678');
    });

    it('conserva un punto a medio escribir', () => {
        const calc = new Calculator();

        type(calc, '12.');

        expect(display(calc)).toBe('12.');
    });
});

describe('signo', () => {
    it('alterna el signo del número en pantalla', () => {
        const calc = new Calculator();

        type(calc, '42');
        calc.toggleSign();
        expect(display(calc)).toBe('-42');

        calc.toggleSign();
        expect(display(calc)).toBe('42');
    });

    it('permite teclear el signo antes del operando', () => {
        const calc = new Calculator();

        type(calc, '5');
        calc.inputOperator('*');
        calc.toggleSign();
        type(calc, '3');
        calc.calculate();

        expect(display(calc)).toBe('-15');
    });
});

describe('borrado', () => {
    it('C borra solo la entrada y AC reinicia el cálculo', () => {
        const calc = new Calculator();

        type(calc, '50');
        calc.inputOperator('+');
        type(calc, '25');

        calc.clear(); // C — queda la suma pendiente
        expect(display(calc)).toBe('0');
        type(calc, '10');
        calc.calculate();
        expect(display(calc)).toBe('60');

        calc.clear(); // AC — tras un resultado reinicia todo
        expect(display(calc)).toBe('0');
        expect(calc.getState().showClear).toBe(false);
    });

    it('backspace sobre un resultado lo descarta', () => {
        const calc = new Calculator();

        type(calc, '9');
        calc.inputOperator('+');
        type(calc, '1');
        calc.calculate();
        calc.backspace();

        expect(display(calc)).toBe('0');
    });

    it('backspace sobre un solo dígito deja cero', () => {
        const calc = new Calculator();

        type(calc, '7');
        calc.backspace();

        expect(display(calc)).toBe('0');
    });
});

describe('estado para la UI', () => {
    it('resalta el operador pendiente y lo suelta al teclear', () => {
        const calc = new Calculator();

        type(calc, '8');
        expect(calc.getState().activeOperator).toBeNull();

        calc.inputOperator('/');
        expect(calc.getState().activeOperator).toBe('/');

        type(calc, '2');
        expect(calc.getState().activeOperator).toBeNull();
    });

    it('cambia AC por C en cuanto hay algo que borrar', () => {
        const calc = new Calculator();

        expect(calc.getState().showClear).toBe(false);

        type(calc, '1');

        expect(calc.getState().showClear).toBe(true);
    });
});

describe('números extremos', () => {
    it('pasa a notación científica con magnitudes muy grandes', () => {
        const calc = new Calculator();

        type(calc, '999999999');
        calc.inputOperator('*');
        type(calc, '999999999');
        calc.calculate();

        expect(display(calc)).toMatch(/e/);
    });

    it('sigue operando sobre un resultado en notación científica', () => {
        const calc = new Calculator();

        type(calc, '999999999');
        calc.inputOperator('*');
        type(calc, '999999999');
        calc.calculate();
        calc.inputOperator('/');
        type(calc, '999999999');
        calc.calculate();

        // Vuelve al rango decimal normal, no a 0 ni a Error.
        expect(display(calc)).toMatch(/^[\d,]+$/);
    });
});
