/**
 * Unit tests for the parts of the engine the golden fixtures cannot reach:
 * defensive guards, and behaviour under a price book v137 never had.
 *
 * The golden fixtures are the contract. These are for the edges a captured
 * scenario cannot express, because v137's own book never goes there.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bandTotal, countingTiers, engagementPct, packDiscFor, phGradSEK, phLadder, segmentFor, suiteCovers } from '../src/index.js';
import type { Pack, PriceBook } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(join(here, '../data/price-book.v137.json'), 'utf8')) as PriceBook;

describe('bandTotal', () => {
  it('stops when a band starts at or below where the last one ended', () => {
    // An open-ended band followed by another is malformed, and the ladder must
    // stop rather than charge the same employees twice.
    const bands = [{ to: null, rate: 10 }, { to: 200, rate: 99 }];
    expect(bandTotal(bands, 50, 1)).toEqual({ tot: 500, legs: [{ from: 1, to: null, n: 50, r: 10, amt: 500 }] });
  });

  it('does not add a flat band that sits behind an open-ended one', () => {
    // A flat band charges its whole fee regardless of quantity, so this is the
    // shape where a missing guard silently inflates the price.
    const bands = [{ to: null, rate: 10 }, { to: 30, flat: 777 }];
    expect(bandTotal(bands, 50, 1).tot).toBe(500);
  });

  it('charges nothing for no bands', () => {
    expect(bandTotal(undefined, 500, 1)).toEqual({ tot: 0, legs: [] });
  });

  it('applies the segment multiplier to flat and rated bands alike', () => {
    const bands = [{ to: 10, flat: 100 }, { to: null, rate: 5 }];
    expect(bandTotal(bands, 20, 2).tot).toBe(100 * 2 + 10 * 5 * 2);
  });
});

describe('segmentFor', () => {
  it('clamps a headcount of zero into the first bracket', () => {
    expect(segmentFor(book, 0).id).toBe('small');
  });

  it('falls back to the last bracket when none matches', () => {
    // A book whose brackets leave a gap must still price, not throw.
    const gapped = { ...book, segments: [{ id: 'a', name: 'A', from: 1, to: 10, mult: 1 }] };
    expect(segmentFor(gapped, 5000).id).toBe('a');
  });
});

describe('the discount grids', () => {
  it('gives nothing for no modules', () => {
    expect(packDiscFor(book, 0)).toBe(0);
    expect(packDiscFor(book, -1)).toBe(0);
  });

  it('reads the deepest rung the count reaches, whatever order the rows are in', () => {
    const shuffled = { ...book, packDisc: [...book.packDisc].reverse() };
    expect(packDiscFor(shuffled, 4)).toBe(packDiscFor(book, 4));
  });

  it('holds at the top rung beyond the end of the grid', () => {
    expect(packDiscFor(book, 99)).toBe(packDiscFor(book, 6));
    expect(engagementPct(book, 99)).toBe(engagementPct(book, 5));
  });

  it('gives a part-year term the rung below it', () => {
    expect(engagementPct(book, 2.5)).toBe(engagementPct(book, 2));
  });
});

describe('countingTiers', () => {
  const pack = (name: string) => ({ id: name, name } as Pack);

  it('counts nothing for an empty quote', () => {
    expect(countingTiers(book, [])).toEqual({ count: 0, skipped: [] });
  });

  it('skips a module worth less than the discount it would trigger', () => {
    const r = countingTiers(book, [
      { annual: 100000, pack: pack('big') },
      { annual: 1, pack: pack('tiny') },
    ]);
    expect(r.count).toBe(1);
    expect(r.skipped).toEqual(['tiny']);
  });

  it('counts a module that pays for the deeper discount', () => {
    const r = countingTiers(book, [
      { annual: 10000, pack: pack('one') },
      { annual: 10000, pack: pack('two') },
    ]);
    expect(r).toEqual({ count: 2, skipped: [] });
  });
});

describe('the predictive hiring ladder', () => {
  it('is published one rung per configured band', () => {
    expect(phLadder(book).map((r) => r.to)).toEqual(book.phBands.bands);
  });

  it('never charges less for more recruitments', () => {
    let last = -Infinity;
    for (const q of [1, 5, 10, 11, 40, 100, 640, 2560, 2561, 10000]) {
      const v = phGradSEK(book, q);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('clamps a commitment of zero to one recruitment', () => {
    expect(phGradSEK(book, 0)).toBe(phGradSEK(book, 1));
  });
});

describe('suiteCovers', () => {
  it('covers nothing when no suite is picked', () => {
    expect(suiteCovers(book, { ta_1: true })).toEqual([]);
  });

  it('names the packs the chosen suite contains', () => {
    expect(suiteCovers(book, { suite_s: true })).toContain('ta_1');
  });
});
