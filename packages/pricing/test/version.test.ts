/**
 * The November re-render.
 *
 * "A quote sent in March must re-render identically in November, after the
 * price book has changed three times" is the requirement these tests exist to
 * hold. Most of what follows is the supporting machinery; the test that matters
 * is `re-renders a March quote in November`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  computeQuote,
  createVersion,
  divergences,
  fingerprint,
  issueQuote,
  PriceBookRegistry,
  rerenderQuote,
} from '../src/index.js';
import type { PriceBook, PriceBookVersionInput, QuoteInput } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(join(here, '../data/price-book.v137.json'), 'utf8')) as PriceBook;

const quote = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  users: 600,
  processes: 14,
  years: 3,
  packs: { ta_1: true, perf_s: true },
  setup: {},
  yearly: {},
  ai: {},
  disc: 0,
  setupDisc: 0,
  ...over,
});

const meta = (over: Partial<PriceBookVersionInput> = {}): PriceBookVersionInput => ({
  id: 'v137',
  label: 'Talent Suite v137',
  status: 'published',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  publishedAt: '2025-12-20',
  ...over,
});

/** A book that prices differently, for standing in as "the price book changed". */
const cheaper = (): PriceBook => ({
  ...book,
  packDisc: book.packDisc.map((r) => ({ ...r, pct: r.pct + 10 })),
});

describe('canonicalJson', () => {
  it('does not care what order the keys were written in', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('does care what order an array is in', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('treats an undefined field as absent, because JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('renders an undefined root as null, because there is no JSON for undefined', () => {
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('handles null, nested objects and arrays of objects', () => {
    expect(canonicalJson({ a: null, b: [{ y: 1, x: 2 }] })).toBe('{"a":null,"b":[{"x":2,"y":1}]}');
  });
});

describe('fingerprint', () => {
  it('is stable for the same content', () => {
    expect(fingerprint(book)).toBe(fingerprint(structuredClone(book)));
  });

  it('changes when a single rate changes', () => {
    const nudged = structuredClone(book);
    const pack = nudged.modules[2]?.packs[0];
    (pack?.bands as Array<{ rate?: number }>)[1]!.rate = 38.3207;
    expect(fingerprint(nudged)).not.toBe(fingerprint(book));
  });

  it('is sixteen hex characters', () => {
    expect(fingerprint(book)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('createVersion', () => {
  it('refuses a version with no id', () => {
    expect(() => createVersion(meta({ id: '' }), book)).toThrow(/needs an id/);
  });

  it('refuses a date it cannot read', () => {
    expect(() => createVersion(meta({ effectiveFrom: 'Q1 next year' }), book)).toThrow(/not a date/);
    expect(() => createVersion(meta({ effectiveTo: 'soon' }), book)).toThrow(/not a date/);
    expect(() => createVersion(meta({ publishedAt: 'yesterday' }), book)).toThrow(/not a date/);
  });

  it('refuses a window that ends before it starts', () => {
    expect(() => createVersion(meta({ effectiveTo: '2025-06-01' }), book)).toThrow(/is not after/);
  });

  it('refuses a published version that does not say when it was published', () => {
    expect(() => createVersion(meta({ publishedAt: null }), book)).toThrow(/when it was published/);
  });

  it('freezes a published book all the way down', () => {
    const v = createVersion(meta(), book);
    expect(() => {
      (v.book.modules[2]!.packs[0]!.bands as Array<{ rate?: number }>)[1]!.rate = 1;
    }).toThrow(TypeError);
    expect(() => {
      (v as { id: string }).id = 'tampered';
    }).toThrow(TypeError);
  });

  it('does not freeze the callers own book while doing it', () => {
    const mine = structuredClone(book);
    createVersion(meta(), mine);
    expect(() => {
      mine.suiteBonusPct = 5;
    }).not.toThrow();
  });

  it('freezes a draft too, so its fingerprint cannot go stale', () => {
    // A draft is revised by building a new version, never by editing this one:
    // a book that could still move would carry a fingerprint describing what it
    // used to be.
    const v = createVersion(meta({ id: 'v138', status: 'draft', publishedAt: null }), structuredClone(book));
    expect(Object.isFrozen(v.book)).toBe(true);
    expect(() => {
      (v.book as { suiteBonusPct?: number }).suiteBonusPct = 5;
    }).toThrow(TypeError);
  });
});

describe('PriceBookRegistry', () => {
  it('refuses two versions with the same id', () => {
    expect(() => new PriceBookRegistry([createVersion(meta(), book), createVersion(meta(), book)])).toThrow(
      /share the id/,
    );
  });

  it('refuses two published books in force at the same time', () => {
    const a = createVersion(meta({ id: 'a', effectiveTo: '2026-07-01' }), book);
    const b = createVersion(meta({ id: 'b', effectiveFrom: '2026-06-01', effectiveTo: null }), book);
    expect(() => new PriceBookRegistry([a, b])).toThrow(/both in force at once/);
  });

  it('refuses a new book after an open-ended one', () => {
    const a = createVersion(meta({ id: 'a', effectiveTo: null }), book);
    const b = createVersion(meta({ id: 'b', effectiveFrom: '2026-06-01' }), book);
    expect(() => new PriceBookRegistry([a, b])).toThrow(/open-ended/);
  });

  it('allows windows that abut exactly, because the end is exclusive', () => {
    const a = createVersion(meta({ id: 'a', effectiveTo: '2026-07-01' }), book);
    const b = createVersion(meta({ id: 'b', effectiveFrom: '2026-07-01', effectiveTo: null }), book);
    const registry = new PriceBookRegistry([a, b]);
    expect(registry.effectiveOn('2026-06-30').id).toBe('a');
    expect(registry.effectiveOn('2026-07-01').id).toBe('b');
  });

  it('ignores drafts and withdrawn books when checking for clashes', () => {
    const live = createVersion(meta({ id: 'live' }), book);
    const draft = createVersion(meta({ id: 'draft', status: 'draft', publishedAt: null }), book);
    const gone = createVersion(meta({ id: 'gone', status: 'archived' }), book);
    expect(() => new PriceBookRegistry([live, draft, gone])).not.toThrow();
    expect(new PriceBookRegistry([live, draft, gone]).published()).toHaveLength(1);
  });

  it('includes the first day and excludes the last', () => {
    const v = createVersion(meta({ effectiveFrom: '2026-03-01', effectiveTo: '2026-04-01' }), book);
    const registry = new PriceBookRegistry([v]);
    expect(registry.effectiveOn('2026-03-01').id).toBe('v137');
    expect(registry.effectiveOn('2026-03-31').id).toBe('v137');
    expect(() => registry.effectiveOn('2026-04-01')).toThrow(/No published price book/);
    expect(() => registry.effectiveOn('2026-02-28')).toThrow(/No published price book/);
  });

  it('rejects a date it cannot read', () => {
    expect(() => new PriceBookRegistry([createVersion(meta(), book)]).effectiveOn('never')).toThrow(/not a date/);
  });

  it('finds a withdrawn book by id, so old quotes still have theirs', () => {
    const gone = createVersion(meta({ id: 'v136', status: 'archived' }), book);
    const registry = new PriceBookRegistry([gone]);
    expect(registry.byId('v136').id).toBe('v136');
    expect(registry.all()).toHaveLength(1);
    expect(() => registry.byId('v999')).toThrow(/No price book version with id/);
  });
});

describe('issueQuote', () => {
  const march = createVersion(meta({ id: 'v137', effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01' }), book);
  const registry = new PriceBookRegistry([march]);

  it('prices from the book in force on the day it was issued', () => {
    const issued = issueQuote(registry, { quoteId: 'Q-1', issuedAt: '2026-03-15', input: quote() });
    expect(issued.priceBookVersionId).toBe('v137');
    expect(issued.priceBookFingerprint).toBe(march.fingerprint);
    expect(issued.result.arr).toBeGreaterThan(0);
  });

  it('refuses to quote from a draft', () => {
    const draft = createVersion(meta({ id: 'v138', status: 'draft', publishedAt: null }), book);
    const r = new PriceBookRegistry([draft]);
    expect(() => issueQuote(r, { quoteId: 'Q', issuedAt: '2026-03-15', input: quote(), priceBookVersionId: 'v138' })).toThrow(
      /is draft; a quote may only be issued from a published book/,
    );
  });

  it('refuses to quote from a withdrawn book', () => {
    const gone = createVersion(meta({ id: 'v136', status: 'archived' }), book);
    const r = new PriceBookRegistry([gone]);
    expect(() => issueQuote(r, { quoteId: 'Q', issuedAt: '2026-03-15', input: quote(), priceBookVersionId: 'v136' })).toThrow(
      /is archived/,
    );
  });

  it('refuses when no book was in force that day', () => {
    expect(() => issueQuote(registry, { quoteId: 'Q', issuedAt: '2025-01-01', input: quote() })).toThrow(
      /No published price book is in force/,
    );
  });

  it('does not let a later edit to the caller’s input rewrite the quote', () => {
    const input = quote();
    const issued = issueQuote(registry, { quoteId: 'Q-2', issuedAt: '2026-03-15', input });
    input.users = 9999;
    expect(issued.input.users).toBe(600);
  });
});

describe('re-rendering an issued quote', () => {
  const march = createVersion(meta({ id: 'v137', effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01' }), book);

  it('re-renders a March quote in November, after the book has been replaced twice', () => {
    // March: issue against the book in force.
    const atIssue = new PriceBookRegistry([march]);
    const issued = issueQuote(atIssue, { quoteId: 'Q-MAR', issuedAt: '2026-03-15', input: quote() });

    // Summer and autumn: two new books, both pricing differently, and the
    // March book is withdrawn.
    const november = new PriceBookRegistry([
      createVersion(meta({ id: 'v137', status: 'archived', effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01' }), book),
      createVersion(meta({ id: 'v138', effectiveFrom: '2026-07-01', effectiveTo: '2026-10-01' }), cheaper()),
      createVersion(meta({ id: 'v139', effectiveFrom: '2026-10-01', effectiveTo: null }), cheaper()),
    ]);

    // The new books really would price this quote differently…
    expect(computeQuote(november.byId('v139').book, issued.input).arr).not.toBe(issued.result.arr);

    // …and the March quote is completely unmoved.
    expect(rerenderQuote(november, issued)).toEqual(issued.result);
  });

  it('refuses when a published book has been edited underneath it', () => {
    const issued = issueQuote(new PriceBookRegistry([march]), {
      quoteId: 'Q-EDIT',
      issuedAt: '2026-03-15',
      input: quote(),
    });
    // The same id, redeployed with different contents — what actually happens
    // when someone edits the JSON and ships it.
    const edited = new PriceBookRegistry([
      createVersion(meta({ id: 'v137', effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01' }), cheaper()),
    ]);
    expect(() => rerenderQuote(edited, issued)).toThrow(/A published price book has been edited/);
  });

  it('refuses when the book is intact but the numbers no longer come out the same', () => {
    const registry = new PriceBookRegistry([march]);
    const issued = issueQuote(registry, { quoteId: 'Q-DRIFT', issuedAt: '2026-03-15', input: quote() });
    // Stand in for a pricing change shipped in the engine.
    const tampered = structuredClone(issued);
    tampered.result.arr = issued.result.arr + 1;
    tampered.result.subLines[0]!.annual = 0;
    expect(() => rerenderQuote(registry, tampered)).toThrow(/the engine's answer has changed/);
  });

  it('names every field that moved, not just that something did', () => {
    const registry = new PriceBookRegistry([march]);
    const issued = issueQuote(registry, { quoteId: 'Q-NAMES', issuedAt: '2026-03-15', input: quote() });
    const tampered = structuredClone(issued);
    tampered.result.arr = 1;
    try {
      rerenderQuote(registry, tampered);
      expect.unreachable('should have refused');
    } catch (e) {
      expect((e as Error).message).toContain('arr: issued 1, now');
    }
  });

  it('lists the extra fields when there are more than five', () => {
    const registry = new PriceBookRegistry([march]);
    const issued = issueQuote(registry, { quoteId: 'Q-MANY', issuedAt: '2026-03-15', input: quote() });
    const tampered = structuredClone(issued);
    for (const key of ['arr', 'mrr', 'tcv', 'netSub', 'listSub', 'year1', 'perUser'] as const) {
      tampered.result[key] = -1;
    }
    expect(() => rerenderQuote(registry, tampered)).toThrow(/and 2 more/);
  });
});

describe('divergences', () => {
  it('finds nothing between equal values', () => {
    expect(divergences({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('reports a scalar difference at the root', () => {
    expect(divergences(1, 2)).toEqual([{ path: '(root)', issued: 1, now: 2 }]);
  });

  it('reports a field that is present on one side only', () => {
    expect(divergences({ a: 1 }, { a: 1, b: 2 })).toEqual([{ path: 'b', issued: undefined, now: 2 }]);
  });

  it('reports a type change rather than descending into it', () => {
    expect(divergences({ a: { b: 1 } }, { a: null })).toEqual([{ path: 'a', issued: { b: 1 }, now: null }]);
  });

  it('walks into arrays by index', () => {
    expect(divergences([1, 2], [1, 3])).toEqual([{ path: '1', issued: 2, now: 3 }]);
  });
});
