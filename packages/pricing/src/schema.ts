/**
 * Validation for a price book.
 *
 * The engine is deliberately permissive — it is a pure function and it will
 * price whatever it is handed, filling in defaults for anything absent (see
 * `test/defensive.test.ts` for exactly what it does). That is the right
 * behaviour for the engine and the wrong behaviour for the front door, because
 * a book missing a rate prices silently rather than loudly.
 *
 * So validation guards the door: `createVersion` runs this, and a book that
 * cannot price correctly never becomes a version anyone can quote from.
 *
 * Every rule here is one that would otherwise produce a wrong number rather
 * than an error — a pack with no way to be priced, a band ladder that divides
 * by zero, a threshold fee with no high price to step to.
 */
import { z } from 'zod';
import type { PriceBook } from './types.js';

const pct = z.number().min(0).max(100);

/**
 * `looseObject` throughout: v137's book carries fields the engine does not read
 * (`stage`, `job`, `note`, `desc`, `included`…) and stripping them would change
 * the book's fingerprint. Validation must never rewrite what it validates.
 */
const bandSchema = z
  .looseObject({
    to: z.number().positive().nullable(),
    flat: z.number().optional(),
    rate: z.number().optional(),
  })
  .refine((b) => (b.flat === undefined) !== (b.rate === undefined), {
    message: 'a band needs exactly one of flat or rate',
  });

const packSchema = z
  .looseObject({
    id: z.string().min(1),
    name: z.string().min(1),
    bands: z.array(bandSchema).min(1).optional(),
    usage: z
      .looseObject({ unit: z.string().min(1), bands: z.array(bandSchema).min(1).optional() })
      .optional(),
    bandModel: z.boolean().optional(),
    proExtras: z.boolean().optional(),
    suiteOf: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine((p) => p.bands !== undefined || p.bandModel === true || p.suiteOf !== undefined, {
    // Without one of the three the pack prices at zero and says nothing.
    message: 'a pack must be priceable: it needs bands, bandModel or suiteOf',
  });

const moduleSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  packs: z.array(packSchema).min(1),
});

const segmentSchema = z
  .looseObject({
    id: z.string().min(1),
    name: z.string().min(1),
    from: z.number().int().min(0),
    to: z.number().int().positive().nullable(),
    mult: z.number().positive(),
  })
  .refine((s) => s.to === null || s.to >= s.from, { message: 'a segment must end at or after it starts' });

const feeSchema = z
  .looseObject({
    id: z.string().min(1),
    name: z.string().min(1),
    price: z.number().min(0),
    recurring: z.boolean().optional(),
    qty: z.boolean().optional(),
    per: z.string().optional(),
    step: z.number().positive().optional(),
    threshold: z.number().positive().optional(),
    priceHigh: z.number().min(0).optional(),
    needs: z.string().min(1).optional(),
    needsIntegration: z.boolean().optional(),
  })
  .refine((f) => f.threshold === undefined || f.priceHigh !== undefined, {
    // Otherwise crossing the threshold charges `undefined`.
    message: 'a fee with a threshold needs a priceHigh to step to',
  });

const fxSchema = z
  .record(z.string().min(1), z.looseObject({ sym: z.string().min(1), rate: z.number().positive() }))
  .refine((fx) => fx['EUR']?.rate === 1, {
    // Every amount the engine returns is already in euros, so the euro rate is
    // the identity by construction. Anything else silently re-denominates.
    message: 'fx.EUR must exist with a rate of exactly 1, because the engine computes in euros',
  })
  .refine((fx) => fx['SEK'] !== undefined, {
    // The predictive-hiring ladder is listed in SEK and divided by this rate.
    message: 'fx.SEK must exist: the predictive hiring ladder is priced in SEK',
  });

const phBandsSchema = z
  .looseObject({
    anchorSEK: z.number().positive(),
    parityPct: z.number().positive(),
    doublingPct: z.number().positive(),
    bands: z.array(z.number().int().positive()).min(1),
    roundTo: z.number().positive().optional(),
  })
  .refine((b) => b.bands.every((to, i) => i === 0 || to > (b.bands[i - 1] as number)), {
    // The bracket rates divide by the gap between consecutive bands.
    message: 'phBands.bands must strictly increase, or the bracket ladder divides by zero',
  });

const bookSchema = z.looseObject({
  fx: fxSchema,
  packDisc: z.array(z.looseObject({ packs: z.number().int().min(0), pct })).min(1),
  engagementDisc: z.array(z.looseObject({ years: z.number().positive(), pct })).min(1),
  phBands: phBandsSchema,
  phFloor: z.looseObject({ on: z.boolean(), sek: z.number().min(0) }).optional(),
  phPro: z
    .array(z.looseObject({ id: z.string().min(1), name: z.string().min(1), pct: pct.optional(), flatSEK: z.number().optional() }))
    .optional(),
  phSize: z
    .looseObject({
      on: z.boolean(),
      sharePct: pct,
      hiringPct: z.number().positive(),
      mode: z.enum(['flat', 'fade', 'floor']),
    })
    .optional(),
  fullSuiteCountsAsPacks: z.number().int().min(0),
  suiteBonusPct: pct.optional(),
  discountStacking: z.enum(['additive', 'sequential']).optional(),
  segments: z.array(segmentSchema).min(1),
  modules: z.array(moduleSchema).min(1),
  aiCredits: z.array(z.looseObject({ id: z.string().min(1), name: z.string().min(1), price: z.number().min(0) })),
  setup: z.array(feeSchema),
  yearly: z.array(feeSchema),
});

/** Rules that need the whole book, not one field of it. */
const priceBookSchema = bookSchema.superRefine((book, ctx) => {
  const moduleIds = new Set<string>();
  for (const [i, m] of book.modules.entries()) {
    if (moduleIds.has(m.id)) {
      ctx.addIssue({ code: 'custom', path: ['modules', i, 'id'], message: `duplicate module id ${m.id}` });
    }
    moduleIds.add(m.id);
  }

  const packIds = new Set<string>();
  for (const [i, m] of book.modules.entries()) {
    for (const [j, p] of m.packs.entries()) {
      if (packIds.has(p.id)) {
        ctx.addIssue({ code: 'custom', path: ['modules', i, 'packs', j, 'id'], message: `duplicate pack id ${p.id}` });
      }
      packIds.add(p.id);
    }
  }

  for (const [i, m] of book.modules.entries()) {
    for (const [j, p] of m.packs.entries()) {
      for (const [k, member] of (p.suiteOf ?? []).entries()) {
        if (!packIds.has(member)) {
          ctx.addIssue({
            code: 'custom',
            path: ['modules', i, 'packs', j, 'suiteOf', k],
            // The engine skips a member it cannot find, so the suite quietly
            // costs less than it should.
            message: `${p.id} contains ${member}, which is not a pack in this book`,
          });
        }
      }
    }
  }

  for (const list of ['setup', 'yearly'] as const) {
    for (const [i, fee] of book[list].entries()) {
      if (fee.needs !== undefined && !moduleIds.has(fee.needs)) {
        ctx.addIssue({
          code: 'custom',
          path: [list, i, 'needs'],
          // A fee needing a module that does not exist can never be sold.
          message: `${fee.id} needs module ${fee.needs}, which is not in this book`,
        });
      }
    }
  }
});

export class PriceBookInvalid extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`This price book cannot be used:\n${problems.map((p) => `  ${p}`).join('\n')}`);
    this.name = 'PriceBookInvalid';
  }
}

/**
 * Check a price book and hand back **the object that was passed in**.
 *
 * Deliberately not the parsed copy. Zod's output is a rebuilt object, and the
 * fingerprint in `version.ts` is taken over the book — so returning the copy
 * would let validation silently change what a quote was priced from. Validation
 * answers a question; it does not get to edit the answer.
 */
export function parsePriceBook(value: unknown): PriceBook {
  const result = priceBookSchema.safeParse(value);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const where = issue.path.length ? issue.path.join('.') : '(book)';
      return `${where}: ${issue.message}`;
    });
    throw new PriceBookInvalid(problems);
  }
  return value as PriceBook;
}

/** True when the book would price correctly, without throwing. */
export function isPriceBook(value: unknown): value is PriceBook {
  return priceBookSchema.safeParse(value).success;
}
