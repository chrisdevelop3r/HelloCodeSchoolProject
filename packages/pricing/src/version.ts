/**
 * Versioned price books.
 *
 * Rule 2 from `docs/quote-builder-architecture.md`: a quote is immutable once
 * issued. A quote sent in March must re-render identically in November, after
 * the price book has changed three times. That is only possible if a quote can
 * name the exact prices it was made from, which means the price book stops
 * being a file and becomes a series of versions with effective dates.
 *
 * The rules this enforces:
 *
 * - **Every version is frozen.** Not by convention — the object is deeply frozen
 *   and carries a fingerprint, so an edit either throws or is detected. Drafts
 *   too: a book that can still move would carry a fingerprint that has stopped
 *   describing it.
 * - **Published versions may not overlap.** Two books both claiming to be in
 *   force on the same day is not a query to resolve at read time, it is a data
 *   error, and it is refused when the registry is built rather than discovered
 *   by a rep getting the wrong price.
 * - **You cannot quote from a draft or from a withdrawn book**, but you can
 *   still re-render a quote that was issued from one before it was withdrawn.
 */
import { fingerprint } from './fingerprint.js';
import type { PriceBook } from './types.js';

export type PriceBookStatus =
  /** Being prepared. Cannot be quoted from. */
  | 'draft'
  /** In force for its effective window. The only status a quote may name. */
  | 'published'
  /** Withdrawn. Old quotes still re-render from it; no new quote may use it. */
  | 'archived';

export interface PriceBookVersionInput {
  /** Stable identifier, e.g. `v137`. Quotes store this. */
  id: string;
  label: string;
  status: PriceBookStatus;
  /** ISO 8601. The first moment this book applies. Inclusive. */
  effectiveFrom: string;
  /** ISO 8601, or null for open-ended. Exclusive, so windows can abut exactly. */
  effectiveTo: string | null;
  /** ISO 8601. Required once published; it is when the freeze took effect. */
  publishedAt?: string | null;
  notes?: string;
}

export interface PriceBookVersion extends PriceBookVersionInput {
  readonly publishedAt: string | null;
  readonly book: PriceBook;
  /** Of the book's contents. See `fingerprint.ts` for what it does and does not protect. */
  readonly fingerprint: string;
}

const time = (iso: string, field: string): number => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`${field} is not a date: ${JSON.stringify(iso)}`);
  return t;
};

/** Freeze the whole tree, not just the top object, so no nested rate can move. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Build a version, refusing the states that would be unsafe to price from.
 *
 * The book is cloned before freezing, so freezing a version cannot reach back
 * and immobilise an object its caller is still working on.
 */
export function createVersion(meta: PriceBookVersionInput, book: PriceBook): PriceBookVersion {
  if (!meta.id) throw new Error('A price book version needs an id.');
  const from = time(meta.effectiveFrom, `${meta.id}.effectiveFrom`);
  if (meta.effectiveTo !== null) {
    const to = time(meta.effectiveTo, `${meta.id}.effectiveTo`);
    if (to <= from) {
      throw new Error(`${meta.id}: effectiveTo (${meta.effectiveTo}) is not after effectiveFrom (${meta.effectiveFrom}).`);
    }
  }
  if (meta.status === 'published' && !meta.publishedAt) {
    throw new Error(`${meta.id}: a published version must record when it was published.`);
  }
  if (meta.publishedAt) time(meta.publishedAt, `${meta.id}.publishedAt`);

  // Every version is frozen, drafts included: a book you can still edit would
  // carry a fingerprint that quietly stops describing it. A draft is revised by
  // building a new version from a new book, not by reaching into this one.
  const frozenBook = deepFreeze(structuredClone(book));
  // Shallow on the wrapper — the book is the only part of it with any depth,
  // and it is already frozen above. Deep-freezing here as well would make that
  // line redundant, and a redundant guard is one no test can prove is working.
  return Object.freeze({
    ...meta,
    publishedAt: meta.publishedAt ?? null,
    book: frozenBook,
    fingerprint: fingerprint(frozenBook),
  }) as PriceBookVersion;
}

/**
 * Every version the system knows about, with the rule that at most one may be
 * in force on any given day.
 */
export class PriceBookRegistry {
  private readonly byIdMap = new Map<string, PriceBookVersion>();

  constructor(versions: readonly PriceBookVersion[]) {
    for (const v of versions) {
      if (this.byIdMap.has(v.id)) throw new Error(`Two price book versions share the id ${v.id}.`);
      this.byIdMap.set(v.id, v);
    }
    this.refuseOverlaps();
  }

  private refuseOverlaps(): void {
    const published = this.published().sort(
      (a, b) => time(a.effectiveFrom, a.id) - time(b.effectiveFrom, b.id),
    );
    for (let i = 1; i < published.length; i++) {
      const prev = published[i - 1] as PriceBookVersion;
      const next = published[i] as PriceBookVersion;
      if (prev.effectiveTo === null) {
        throw new Error(
          `${prev.id} is open-ended but ${next.id} starts on ${next.effectiveFrom}. Close ${prev.id} first.`,
        );
      }
      if (time(prev.effectiveTo, prev.id) > time(next.effectiveFrom, next.id)) {
        throw new Error(
          `${prev.id} (to ${prev.effectiveTo}) and ${next.id} (from ${next.effectiveFrom}) are both in force at once.`,
        );
      }
    }
  }

  published(): PriceBookVersion[] {
    return [...this.byIdMap.values()].filter((v) => v.status === 'published');
  }

  all(): PriceBookVersion[] {
    return [...this.byIdMap.values()];
  }

  /** Any version, whatever its status — this is how an old quote finds its book. */
  byId(id: string): PriceBookVersion {
    const v = this.byIdMap.get(id);
    if (!v) throw new Error(`No price book version with id ${id}.`);
    return v;
  }

  /** The published book in force on a date, for making a new quote. */
  effectiveOn(date: string): PriceBookVersion {
    const at = time(date, 'date');
    const hit = this.published().find((v) => {
      if (at < time(v.effectiveFrom, v.id)) return false;
      return v.effectiveTo === null || at < time(v.effectiveTo, v.id);
    });
    if (!hit) throw new Error(`No published price book is in force on ${date}.`);
    return hit;
  }
}
