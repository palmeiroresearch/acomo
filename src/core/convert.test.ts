import { describe, expect, it } from 'vitest';

import { availableCurrencies, convert, rateOf, type RateTable } from './convert';

// Tasas reales del 21/10/2026, para que los números del test sean reconocibles.
const INFORMAL: RateTable = {
    USD: { cup: 815 },
    EUR: { cup: 912.5 },
    MLC: { cup: 571.21 },
    ZELLE: { cup: 784.94 },
    CAD: { cup: 523.6 },
    MXN: { cup: 51.92 },
};

const OFFICIAL: RateTable = {
    USD: { cup: 729 },
    EUR: { cup: 818.81 },
};

describe('rateOf', () => {
    it('da 1 para el CUP sin que esté en la tabla', () => {
        expect(rateOf('CUP', INFORMAL)).toBe(1);
    });

    it('da null para una moneda ausente', () => {
        expect(rateOf('JPY', INFORMAL)).toBeNull();
    });

    it('trata una tasa de cero como ausente', () => {
        // Una tasa 0 reventaría la división; mejor tratarla como dato inválido.
        expect(rateOf('USD', { USD: { cup: 0 } })).toBeNull();
    });
});

describe('convert', () => {
    it('convierte divisa a CUP', () => {
        expect(convert(100, 'USD', 'CUP', INFORMAL)).toBe(81_500);
    });

    it('convierte CUP a divisa', () => {
        expect(convert(8150, 'CUP', 'USD', INFORMAL)).toBe(10);
    });

    it('cruza dos divisas pasando por CUP', () => {
        const result = convert(1, 'EUR', 'USD', INFORMAL);

        expect(result).toBeCloseTo(912.5 / 815, 10);
    });

    it('devuelve el mismo importe entre monedas iguales', () => {
        expect(convert(37, 'USD', 'USD', INFORMAL)).toBe(37);
    });

    it('da resultados distintos según el mercado', () => {
        // Es la razón de que el mercado sea un parámetro explícito: 100 USD son
        // 81.500 CUP en el informal y 72.900 al Segmento III.
        expect(convert(100, 'USD', 'CUP', INFORMAL)).toBe(81_500);
        expect(convert(100, 'USD', 'CUP', OFFICIAL)).toBe(72_900);
    });

    it('devuelve null si falta una tasa, en vez de propagar NaN', () => {
        expect(convert(10, 'JPY', 'CUP', INFORMAL)).toBeNull();
        expect(convert(10, 'USD', 'JPY', INFORMAL)).toBeNull();
    });

    it('devuelve null con un importe no numérico', () => {
        expect(convert(Number.NaN, 'USD', 'CUP', INFORMAL)).toBeNull();
    });

    it('acepta importes negativos', () => {
        expect(convert(-5, 'USD', 'CUP', INFORMAL)).toBe(-4075);
    });
});

describe('availableCurrencies', () => {
    it('pone el CUP primero y luego las preferidas', () => {
        expect(availableCurrencies(INFORMAL)).toEqual([
            'CUP', 'USD', 'EUR', 'MLC', 'ZELLE', 'CAD', 'MXN',
        ]);
    });

    it('ordena alfabéticamente lo que no es preferido', () => {
        const table: RateTable = { MXN: { cup: 51 }, CAD: { cup: 523 }, GBP: { cup: 1000 } };

        expect(availableCurrencies(table)).toEqual(['CUP', 'CAD', 'GBP', 'MXN']);
    });

    it('omite las monedas con tasa inválida', () => {
        const table: RateTable = { USD: { cup: 815 }, EUR: { cup: 0 } };

        expect(availableCurrencies(table)).toEqual(['CUP', 'USD']);
    });
});
