/**
 * Issuing a quote, and re-rendering one that was issued earlier.
 *
 * An issued quote records three things beyond its own inputs: which price book
 * version priced it, that book's fingerprint, and the numbers that came out.
 * Together they make the November re-render checkable rather than hopeful.
 *
 * `rerenderQuote` does not read the stored numbers back. It recomputes from the
 * stored inputs against the stored book and *compares*. That distinction is the
 * whole point: reading the stored total back would always agree with itself and
 * would prove nothing.
 */
import { computeQuote } from './compute.js';
import { canonicalJson } from './fingerprint.js';
import type { PriceBookRegistry } from './version.js';
import type { QuoteInput, QuoteResult } from './types.js';

export interface IssuedQuote {
  quoteId: string;
  /** ISO 8601. Also what chooses the price book, when one is not named. */
  issuedAt: string;
  priceBookVersionId: string;
  priceBookFingerprint: string;
  input: QuoteInput;
  result: QuoteResult;
}

export interface IssueRequest {
  quoteId: string;
  issuedAt: string;
  input: QuoteInput;
  /**
   * Price from this exact version rather than whichever is in force. For
   * re-issuing against a book that has since been superseded; it still refuses
   * a draft or a withdrawn one.
   */
  priceBookVersionId?: string;
}

export function issueQuote(registry: PriceBookRegistry, request: IssueRequest): IssuedQuote {
  const version = request.priceBookVersionId
    ? registry.byId(request.priceBookVersionId)
    : registry.effectiveOn(request.issuedAt);

  if (version.status !== 'published') {
    throw new Error(
      `Price book ${version.id} is ${version.status}; a quote may only be issued from a published book.`,
    );
  }

  return {
    quoteId: request.quoteId,
    issuedAt: request.issuedAt,
    priceBookVersionId: version.id,
    priceBookFingerprint: version.fingerprint,
    // Cloned so that later edits to the caller's object cannot rewrite history.
    input: structuredClone(request.input),
    result: computeQuote(version.book, request.input),
  };
}

export interface Divergence {
  path: string;
  issued: unknown;
  now: unknown;
}

/** Every leaf where two results disagree, so a failure names the line, not just the quote. */
export function divergences(issued: unknown, now: unknown, path = ''): Divergence[] {
  if (canonicalJson(issued) === canonicalJson(now)) return [];
  const bothObjects =
    issued !== null && now !== null && typeof issued === 'object' && typeof now === 'object';
  if (!bothObjects) return [{ path: path || '(root)', issued, now }];

  const keys = new Set([
    ...Object.keys(issued as Record<string, unknown>),
    ...Object.keys(now as Record<string, unknown>),
  ]);
  const found: Divergence[] = [];
  for (const key of keys) {
    found.push(
      ...divergences(
        (issued as Record<string, unknown>)[key],
        (now as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      ),
    );
  }
  return found;
}

/**
 * Re-price an issued quote and prove it still comes out the same.
 *
 * Refuses, loudly and separately, on the two ways this can go wrong:
 *
 * - **the book moved** — someone edited a published price book, so the quote's
 *   own prices are no longer recoverable from it;
 * - **the engine moved** — the book is intact but the code now answers
 *   differently, which means a pricing change shipped without anyone deciding
 *   it should apply to quotes already in customers' hands.
 *
 * Neither is a case for returning the stored number and moving on.
 */
export function rerenderQuote(registry: PriceBookRegistry, issued: IssuedQuote): QuoteResult {
  const version = registry.byId(issued.priceBookVersionId);

  if (version.fingerprint !== issued.priceBookFingerprint) {
    throw new Error(
      `Quote ${issued.quoteId} was issued from price book ${version.id} at fingerprint ` +
        `${issued.priceBookFingerprint}, which now fingerprints ${version.fingerprint}. ` +
        'A published price book has been edited.',
    );
  }

  const now = computeQuote(version.book, issued.input);
  const drift = divergences(issued.result, now);
  if (drift.length > 0) {
    const shown = drift
      .slice(0, 5)
      .map((d) => `  ${d.path}: issued ${JSON.stringify(d.issued)}, now ${JSON.stringify(d.now)}`)
      .join('\n');
    const more = drift.length > 5 ? `\n  …and ${drift.length - 5} more` : '';
    throw new Error(
      `Quote ${issued.quoteId} no longer re-renders to the numbers it was issued with. ` +
        `The price book is unchanged, so the engine's answer has changed:\n${shown}${more}`,
    );
  }
  return now;
}
