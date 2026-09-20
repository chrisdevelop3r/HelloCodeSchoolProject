/**
 * Validation at the front door.
 *
 * Every rule here is one that would otherwise produce a wrong number rather
 * than an error. The engine itself stays permissive on purpose — see
 * `defensive.test.ts` — so these are about what may become a version someone
 * can quote from.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createVersion, fingerprint, isPriceBook, parsePriceBook, PriceBookInvalid } from '../src/index.js';
import type { PriceBook } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(join(here, '../data/price-book.v137.json'), 'utf8')) as PriceBook;

/** A copy of the real book with one thing wrong with it. */
const broken = (mutate: (b: PriceBook) => void): PriceBook => {
  const copy = structuredClone(book);
  mutate(copy);
  return copy;
};

const problemsOf = (b: PriceBook): readonly string[] => {
  try {
    parsePriceBook(b);
    return [];
  } catch (e) {
    return (e as PriceBookInvalid).problems;
  }
};

const refuses = (b: PriceBook, pattern: RegExp): void => {
  const problems = problemsOf(b);
  expect(problems.length, `expected a refusal, got none`).toBeGreaterThan(0);
  expect(problems.join('\n')).toMatch(pattern);
};

describe('the real price book', () => {
  it('validates', () => {
    expect(() => parsePriceBook(book)).not.toThrow();
    expect(isPriceBook(book)).toBe(true);
  });
});

describe('validation does not rewrite what it validates', () => {
  // The fingerprint in version.ts is taken over the book. If validation handed
  // back zod's rebuilt copy, it could silently change what a quote was priced
  // from — a stripped field is a different book.
  it('hands back the very same object', () => {
    expect(parsePriceBook(book)).toBe(book);
  });

  it('keeps fields the engine never reads', () => {
    const withExtras = broken((b) => {
      (b as Record<string, unknown>)['internalNote'] = 'approved by Finance 2025-12-19';
      (b.modules[0] as Record<string, unknown>)['stage'] = 'live';
    });
    const parsed = parsePriceBook(withExtras) as Record<string, unknown>;
    expect(parsed['internalNote']).toBe('approved by Finance 2025-12-19');
    expect(fingerprint(parsed)).toBe(fingerprint(withExtras));
  });

  it('leaves a version fingerprinting exactly the book it was given', () => {
    const v = createVersion(
      { id: 'v137', label: 'v137', status: 'published', effectiveFrom: '2026-01-01', effectiveTo: null, publishedAt: '2025-12-20' },
      book,
    );
    expect(v.fingerprint).toBe(fingerprint(book));
  });
});

describe('a book that would price silently wrong', () => {
  it('refuses a pack with no way of being priced', () => {
    refuses(
      broken((b) => {
        delete b.modules[2]!.packs[0]!.bands;
      }),
      /must be priceable/,
    );
  });

  it('refuses a band that is both a flat fee and a rate', () => {
    refuses(
      broken((b) => {
        (b.modules[2]!.packs[0]!.bands as unknown as Array<Record<string, unknown>>)[1]!['flat'] = 100;
      }),
      /exactly one of flat or rate/,
    );
  });

  it('refuses a band that is neither', () => {
    refuses(
      broken((b) => {
        delete (b.modules[2]!.packs[0]!.bands as unknown as Array<Record<string, unknown>>)[1]!['rate'];
      }),
      /exactly one of flat or rate/,
    );
  });

  it('refuses recruitment bands that do not increase, because the ladder divides by the gap', () => {
    refuses(
      broken((b) => {
        b.phBands.bands = [10, 20, 20, 40];
      }),
      /must strictly increase/,
    );
  });

  it('refuses a threshold fee with no high price to step to', () => {
    refuses(
      broken((b) => {
        b.setup[0]!.threshold = 1000;
      }),
      /needs a priceHigh/,
    );
  });

  it('refuses a suite naming a pack the book does not have', () => {
    refuses(
      broken((b) => {
        b.modules[0]!.packs[0]!.suiteOf = ['ta_1', 'ghost_1'];
      }),
      /contains ghost_1, which is not a pack/,
    );
  });

  it('refuses a fee needing a module the book does not have', () => {
    refuses(
      broken((b) => {
        b.setup[2]!.needs = 'nonexistent';
      }),
      /needs module nonexistent/,
    );
  });

  it('refuses two packs sharing an id', () => {
    refuses(
      broken((b) => {
        b.modules[3]!.packs[0]!.id = 'ta_1';
      }),
      /duplicate pack id ta_1/,
    );
  });

  it('refuses two modules sharing an id', () => {
    refuses(
      broken((b) => {
        b.modules[3]!.id = 'ta';
      }),
      /duplicate module id ta/,
    );
  });
});

describe('currency rules', () => {
  it('refuses a euro rate that is not exactly 1, because the engine computes in euros', () => {
    refuses(
      broken((b) => {
        b.fx['EUR'] = { sym: '€', rate: 1.02 };
      }),
      /fx.EUR must exist with a rate of exactly 1/,
    );
  });

  it('refuses a book with no euro rate at all', () => {
    refuses(
      broken((b) => {
        delete b.fx['EUR'];
      }),
      /fx.EUR must exist/,
    );
  });

  it('refuses a book with no SEK rate, because the recruitment ladder is listed in SEK', () => {
    refuses(
      broken((b) => {
        delete b.fx['SEK'];
      }),
      /fx.SEK must exist/,
    );
  });

  it('refuses a rate of zero, which the recruitment ladder divides by', () => {
    refuses(
      broken((b) => {
        b.fx['SEK'] = { sym: 'kr', rate: 0 };
      }),
      /fx\.SEK\.rate/,
    );
  });
});

describe('the shape of the book itself', () => {
  it('refuses a book with no modules', () => {
    refuses(
      broken((b) => {
        b.modules = [];
      }),
      /modules/,
    );
  });

  it('refuses a module with no packs', () => {
    refuses(
      broken((b) => {
        b.modules[2]!.packs = [];
      }),
      /packs/,
    );
  });

  it('refuses a segment that ends before it starts', () => {
    refuses(
      broken((b) => {
        b.segments[1]!.to = 1;
      }),
      /must end at or after it starts/,
    );
  });

  it('refuses a discount deeper than 100 per cent', () => {
    refuses(
      broken((b) => {
        b.packDisc[1]!.pct = 150;
      }),
      /packDisc\.1\.pct/,
    );
  });

  it('refuses a stacking mode nobody implements', () => {
    refuses(
      broken((b) => {
        (b as Record<string, unknown>)['discountStacking'] = 'multiplicative';
      }),
      /discountStacking/,
    );
  });

  it('refuses something that is not a book at all', () => {
    expect(() => parsePriceBook(null)).toThrow(PriceBookInvalid);
    expect(() => parsePriceBook('a price book')).toThrow(PriceBookInvalid);
    expect(isPriceBook(undefined)).toBe(false);
  });
});

describe('the refusal itself', () => {
  it('says where the problem is, not just that there is one', () => {
    const problems = problemsOf(
      broken((b) => {
        b.modules[2]!.packs[0]!.name = '';
      }),
    );
    expect(problems.some((p) => p.startsWith('modules.2.packs.0.name:'))).toBe(true);
  });

  it('reports every problem at once, so a bad book takes one round not five', () => {
    const problems = problemsOf(
      broken((b) => {
        b.modules[2]!.packs[0]!.name = '';
        b.segments[1]!.to = 1;
        b.packDisc[1]!.pct = 150;
      }),
    );
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it('reads as one message when it is thrown', () => {
    try {
      parsePriceBook(broken((b) => { b.modules = []; }));
      expect.unreachable('should have refused');
    } catch (e) {
      expect((e as Error).name).toBe('PriceBookInvalid');
      expect((e as Error).message).toContain('This price book cannot be used');
    }
  });
});

describe('createVersion', () => {
  it('will not build a version from a book that cannot price', () => {
    expect(() =>
      createVersion(
        { id: 'bad', label: 'bad', status: 'draft', effectiveFrom: '2026-01-01', effectiveTo: null },
        broken((b) => {
          delete b.modules[2]!.packs[0]!.bands;
        }),
      ),
    ).toThrow(PriceBookInvalid);
  });
});
