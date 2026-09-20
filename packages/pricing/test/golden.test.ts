/**
 * The Phase 0 gate.
 *
 * Every fixture is v137's own answer, captured by `tools/capture-fixtures.mjs`.
 * The port is held to them exactly — not to a tolerance — because a port that
 * is "close enough" on a price is a customer conversation about an invoice.
 *
 * A failure here means one of two things, and it matters which:
 *   - the port is wrong, or
 *   - the pricing has deliberately changed, in which case the change needs a
 *     decision recorded before the fixtures are re-captured.
 * It never means the fixture should be edited.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeQuote } from '../src/index.js';
import type { PriceBook, QuoteInput, QuoteResult } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, 'fixtures');

interface Fixture {
  name: string;
  description: string;
  priceBook: string;
  overrides: Partial<PriceBook>;
  input: QuoteInput;
  expected: QuoteResult;
}

const book = JSON.parse(readFileSync(join(here, '../data/price-book.v137.json'), 'utf8')) as PriceBook;
const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort();
const fixtures = files.map((f) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as Fixture);

describe('the extracted engine reproduces v137', () => {
  it('has fixtures to check against', () => {
    // An empty fixture directory would make every other test in this file pass
    // without running the engine once.
    expect(fixtures.length).toBeGreaterThan(40);
  });

  for (const f of fixtures) {
    it(`${f.name} — ${f.description}`, () => {
      const result = computeQuote({ ...book, ...f.overrides }, f.input);
      // Through JSON so the comparison is against the same shape the fixture
      // holds: NaN and undefined become null exactly as they did on capture.
      expect(JSON.parse(JSON.stringify(result))).toEqual(f.expected);
    });
  }
});
