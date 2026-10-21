import { describe, expect, it } from 'vitest';

import {
    describeAge,
    formatChange,
    formatConverted,
    formatEntry,
    formatNumber,
    formatRate,
    toEntry,
} from './format';

describe('formatNumber', () => {
    it('agrupa millares', () => {
        expect(formatNumber(1_234_567)).toBe('1,234,567');
    });

    it('quita los ceros decimales sobrantes', () => {
        expect(formatNumber(10.5)).toBe('10.5');
        expect(formatNumber(10)).toBe('10');
    });

    it('usa notación científica fuera del rango mostrable', () => {
        expect(formatNumber(1e10)).toMatch(/e10$/);
        expect(formatNumber(1e-7)).toMatch(/e-7$/);
    });

    it('devuelve Error para valores no finitos', () => {
        expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('Error');
        expect(formatNumber(Number.NaN)).toBe('Error');
    });
});

describe('toEntry', () => {
    it('produce una forma canónica sin separadores', () => {
        // Es la garantía de que ningún valor vuelva a pasar por parseFloat con
        // comas dentro, que es lo que rompía la calculadora anterior.
        expect(toEntry(1_234_567)).toBe('1234567');
        expect(toEntry(1_234_567)).not.toContain(',');
    });

    it('es reversible con Number()', () => {
        for (const value of [0, 1, -42.5, 1_234_567, 0.000123]) {
            expect(Number(toEntry(value))).toBeCloseTo(value, 9);
        }
    });

    it('limita a 9 dígitos significativos', () => {
        expect(toEntry(1 / 3)).toBe('0.333333333');
    });
});

describe('formatEntry', () => {
    it('agrupa solo la parte entera y deja la decimal intacta', () => {
        expect(formatEntry('1234567.89')).toBe('1,234,567.89');
    });

    it('conserva un punto final a medio teclear', () => {
        expect(formatEntry('12.')).toBe('12.');
    });

    it('conserva los ceros decimales mientras se escriben', () => {
        // Formatear como número daría «1.5» y borraría el 0 que el usuario
        // acaba de teclear.
        expect(formatEntry('1.50')).toBe('1.50');
    });

    it('mantiene el signo negativo', () => {
        expect(formatEntry('-1234')).toBe('-1,234');
        expect(formatEntry('-0')).toBe('-0');
    });

    it('muestra la notación científica tal cual', () => {
        expect(formatEntry('1e10')).toBe('1e10');
    });

    it('trata la cadena vacía como cero', () => {
        expect(formatEntry('')).toBe('0');
    });
});

describe('formato de tasas', () => {
    it('muestra las tasas con dos decimales fijos', () => {
        expect(formatRate(815)).toBe('815.00');
        expect(formatRate(912.5)).toBe('912.50');
    });

    it('ajusta los decimales del resultado a la magnitud', () => {
        // Con dos decimales fijos, una fracción pequeña se mostraría como 0.00.
        expect(formatConverted(81_500)).toBe('81,500');
        expect(formatConverted(0.0012)).toBe('0.0012');
    });

    it('marca el signo de la variación', () => {
        expect(formatChange(52.5)).toBe('+52.5');
        expect(formatChange(-3.8)).toBe('-3.8');
        expect(formatChange(0)).toBe('0');
    });
});

describe('describeAge', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');

    it('clasifica un dato reciente como fresco', () => {
        const age = describeAge('2026-10-21T11:40:00Z', now);

        expect(age.label).toBe('hace 20 min');
        expect(age.freshness).toBe('fresh');
    });

    it('marca como envejecido a partir de 6 h', () => {
        expect(describeAge('2026-10-21T04:00:00Z', now).freshness).toBe('aging');
    });

    it('marca como obsoleto a partir de 24 h', () => {
        const age = describeAge('2026-10-19T12:00:00Z', now);

        expect(age.label).toBe('hace 2 días');
        expect(age.freshness).toBe('stale');
    });

    it('trata una fecha ausente o inválida como obsoleta', () => {
        // Ese era exactamente el estado de la app anterior: datos de hace tres
        // meses presentados sin ninguna señal de antigüedad.
        expect(describeAge(null, now).freshness).toBe('stale');
        expect(describeAge('no es una fecha', now).freshness).toBe('stale');
    });
});
