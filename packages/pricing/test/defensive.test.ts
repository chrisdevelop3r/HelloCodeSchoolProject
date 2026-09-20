/**
 * What the engine does with a price book that is missing pieces.
 *
 * v137's book is complete, so the golden fixtures never reach these defaults.
 * They are still live code, and the first thing a half-built book v2 will hit,
 * so the behaviour is pinned down here rather than discovered in a deal room.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeQuote, packPrice, phGradSEK, segmentFor, suiteCovers } from '../src/index.js';
import type { PriceBook, QuoteInput } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(join(here, '../data/price-book.v137.json'), 'utf8')) as PriceBook;

const quote = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  users: 600,
  processes: 14,
  years: 1,
  packs: {},
  setup: {},
  yearly: {},
  ai: {},
  disc: 0,
  setupDisc: 0,
  ...over,
});

const without = (key: keyof PriceBook): PriceBook => {
  const copy = { ...book };
  delete copy[key];
  return copy;
};

describe('a price book missing a field', () => {
  it('stacks discounts additively when the book does not say', () => {
    const r = computeQuote(without('discountStacking'), quote({ years: 3, disc: 10, packs: { ta_1: true, perf_s: true } }));
    expect(r.additive).toBe(true);
  });

  it('gives the suite no bonus when the book does not name one', () => {
    const r = computeQuote(without('suiteBonusPct'), quote({ packs: { suite_s: true } }));
    expect(r.subLines[0]?.suiteBonus).toBe(0);
  });

  it('charges no Pro extras when the book lists none', () => {
    const r = computeQuote(without('phPro'), quote({ packs: { ph_p: true } }));
    expect(r.subLines[0]?.proTot).toBe(0);
  });

  it('rounds the recruitment ladder to the nearest thousand when no step is set', () => {
    const noStep = { ...book, phBands: { ...book.phBands, roundTo: undefined as unknown as number } };
    expect(phGradSEK(noStep, 10) % 1000).toBe(0);
  });

  it('treats a bracket with no lower bound as starting at one', () => {
    const open = { ...book, segments: [{ id: 'all', name: 'All', from: undefined as unknown as number, to: null, mult: 1 }] };
    expect(segmentFor(open, 1).id).toBe('all');
  });

  it('skips a suite member that is not in the book', () => {
    const broken = {
      ...book,
      modules: book.modules.map((m) =>
        m.id === 'suite' ? { ...m, packs: m.packs.map((p) => ({ ...p, suiteOf: ['ta_1', 'does_not_exist'] })) } : m,
      ),
    };
    const r = computeQuote(broken, quote({ packs: { suite_s: true } }));
    expect(r.subLines[0]?.legs).toHaveLength(1);
  });

  it('covers nothing when the chosen suite pack names no members', () => {
    const empty = {
      ...book,
      modules: book.modules.map((m) => (m.id === 'suite' ? { ...m, packs: m.packs.map((p) => ({ ...p, suiteOf: undefined })) } : m)),
    };
    expect(suiteCovers(empty, { suite_s: true })).toEqual([]);
  });

  it('treats a flat top band as covering the whole quantity', () => {
    const flatTop = { id: 'x', name: 'X', bands: [{ to: null, flat: 5000 }] };
    const r = packPrice({ ...book }, flatTop, 600, 1, 14);
    expect(r.legs[0]?.n).toBe(600);
  });
});

describe('a quote with no employees', () => {
  // `computeQuote` clamps headcount to one, so this only happens when a caller
  // reaches past it into the engine. It must return zero, not NaN or Infinity.
  it('prices a plain module at zero rather than dividing by zero', () => {
    const pack = book.modules.find((m) => m.id === 'ta')?.packs[0];
    const r = packPrice(book, pack!, 0, 1, 14);
    expect(r.perEmp).toBe(0);
    expect(r.blended).toBe(0);
  });

  it('prices predictive hiring at zero per employee', () => {
    const pack = book.modules.find((m) => m.id === 'ph')?.packs[0];
    const r = packPrice(book, pack!, 0, 1, 14);
    expect(r.perEmp).toBe(0);
    expect(r.blended).toBe(0);
  });

  it('prices the suite at zero per employee', () => {
    const pack = book.modules.find((m) => m.id === 'suite')?.packs[0];
    const r = packPrice(book, pack!, 0, 1, 14);
    expect(r.perEmp).toBe(0);
    expect(r.blended).toBe(0);
  });
});

describe('a quote with unusable numbers', () => {
  it('reads a headcount that is not a number as one employee', () => {
    const r = computeQuote(book, quote({ users: Number.NaN, packs: { ta_1: true } }));
    expect(r.users).toBe(1);
  });

  it('reads a recruitment commitment that is not a number as one', () => {
    const nan = computeQuote(book, quote({ processes: Number.NaN, packs: { ph_s: true } }));
    const one = computeQuote(book, quote({ processes: 1, packs: { ph_s: true } }));
    expect(nan.arr).toBe(one.arr);
  });
});

describe('the size charge', () => {
  const sized = (mode: 'flat' | 'fade' | 'floor'): PriceBook => ({
    ...book,
    phSize: { on: true, sharePct: 20, hiringPct: 15, mode },
  });

  it('is nothing when the company has no employees', () => {
    const pack = book.modules.find((m) => m.id === 'ph')?.packs[0];
    expect(packPrice(sized('flat'), pack!, 0, 1, 40).sizeTot).toBe(0);
  });

  it('fades to nothing once the commitment is deep enough', () => {
    const pack = book.modules.find((m) => m.id === 'ph')?.packs[0];
    // 8% of headcount is where the fade reaches zero.
    expect(packPrice(sized('fade'), pack!, 1000, 1, 80).sizeTot).toBe(0);
  });

  it('never goes below zero in floor mode', () => {
    const pack = book.modules.find((m) => m.id === 'ph')?.packs[0];
    expect(packPrice(sized('floor'), pack!, 1000, 1, 5000).sizeTot).toBe(0);
  });
});
