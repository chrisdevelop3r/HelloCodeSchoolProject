/**
 * The v137 pricing engine, lifted out of the prototype.
 *
 * Pure: no DOM, no I/O, no clock, no module-level mutable state. Everything the
 * prototype read off the globals `M` (price book) and `S` (quote) is an
 * argument here.
 *
 * This is a port, not a rewrite. The arithmetic is in the same order as v137,
 * float noise and all, because `packages/pricing/test/golden.test.ts` holds it
 * to v137's answers exactly. A tidier expression that rounds differently is a
 * pricing change, and a pricing change needs a decision from Finance before it
 * needs a commit.
 */
import type { Band, Leg, Module, Pack, PackPrice, PriceBook, Segment, SubscriptionLine } from './types.js';

/** v137 truncates user input with `|0` throughout. Keep it. */
const toInt = (v: number): number => (Number.isFinite(v) ? v : 0) | 0;

/** The headcount bracket. A CRM bracket, not something a rep picks. */
export function segmentFor(book: PriceBook, users: number): Segment {
  const n = Math.max(1, toInt(users));
  const hit = book.segments.find((s) => n >= (s.from || 0) && (s.to == null || n <= s.to));
  return hit ?? (book.segments[book.segments.length - 1] as Segment);
}

/**
 * Walk one set of bands. The first band may be a flat fee; the rest are
 * per-unit rates for the quantity falling in that band.
 */
export function bandTotal(bands: Band[] | undefined, qty: number, segMult: number): { tot: number; legs: Leg[] } {
  let tot = 0;
  let prev = 0;
  const legs: Leg[] = [];
  for (const b of bands || []) {
    if (qty <= prev) break;
    if (b.flat !== undefined) {
      tot += b.flat * segMult;
      legs.push({ to: b.to, n: Math.min(qty, b.to || qty), flat: b.flat * segMult, amt: b.flat * segMult });
    } else {
      const hi = b.to === null ? qty : Math.min(qty, b.to as number);
      const n = hi - prev;
      if (n > 0) {
        const r = (b.rate as number) * segMult;
        tot += n * r;
        legs.push({ from: prev + 1, to: b.to, n, r, amt: n * r });
      }
    }
    prev = b.to === null ? qty : (b.to as number);
    if (b.to !== null && qty <= b.to) break;
  }
  return { tot, legs };
}

// ── Predictive hiring band engine ───────────────────────────────────────────
// A power curve through an anchor price, rounded, then turned into graduated
// brackets so the ladder is continuous rather than a cliff at each band edge.

const phExp = (book: PriceBook): number => Math.log2(1 + book.phBands.doublingPct / 100);

const phCoef = (book: PriceBook): number =>
  (book.phBands.anchorSEK * book.phBands.parityPct) / 100 / Math.pow(10, phExp(book));

const phRawSEK = (book: PriceBook, q: number): number => phCoef(book) * Math.pow(Math.max(q, 1), phExp(book));

const phRound = (book: PriceBook, v: number): number => {
  const r = book.phBands.roundTo || 1000;
  return Math.round(v / r) * r;
};

/** Which band a recruitment volume falls in. `bands.length` means above the top. */
export function phBandIdx(book: PriceBook, q: number): number {
  const b = book.phBands.bands;
  for (let i = 0; i < b.length; i++) if (q <= (b[i] as number)) return i;
  return b.length;
}

export interface LadderRung {
  b: number;
  from: number;
  to: number;
  sek: number;
}

/** The published band prices — what a customer sees on the rate card. */
export function phLadder(book: PriceBook): LadderRung[] {
  const b = book.phBands.bands;
  return b.map((to, i) => ({ b: i + 1, from: i ? (b[i - 1] as number) + 1 : 1, to, sek: phRound(book, phRawSEK(book, to)) }));
}

interface Bracket {
  from: number;
  to: number;
  flat: number | null;
  rate: number | null;
  rawRate?: number;
  floored?: boolean;
  cum: number;
}

/**
 * The ladder as graduated brackets: a flat first band, then a marginal rate per
 * recruitment across each later band, never below the floor lever.
 */
function phBrackets(book: PriceBook): Bracket[] {
  const L = phLadder(book);
  const F = book.phFloor;
  const fl = F && F.on ? F.sek : 0;
  let cum = 0;
  return L.map((r, i) => {
    if (i === 0) {
      cum = r.sek;
      return { from: r.from, to: r.to, flat: r.sek, rate: null, cum };
    }
    const prev = L[i - 1] as LadderRung;
    const raw = (r.sek - prev.sek) / (r.to - prev.to);
    const rate = Math.max(raw, fl);
    cum += (r.to - prev.to) * rate;
    return { from: r.from, to: r.to, flat: null, rate, rawRate: raw, floored: rate > raw, cum };
  });
}

/** What `q` committed recruitments cost, in SEK, walking the brackets. */
export function phGradSEK(book: PriceBook, q: number): number {
  q = Math.max(1, toInt(q));
  const B = phBrackets(book);
  const first = B[0] as Bracket;
  if (q <= first.to) return first.flat as number;
  let t = first.flat as number;
  let prev = first.to;
  for (const b of B.slice(1)) {
    if (q > prev) t += (Math.min(q, b.to) - prev) * (b.rate as number);
    prev = b.to;
    if (q <= b.to) break;
  }
  if (q > prev) t += (q - prev) * ((B[B.length - 1] as Bracket).rate as number);
  return Math.round(t);
}

/** The list is stored in SEK; everything the engine returns is euros. */
const sekPerEur = (book: PriceBook): number => (book.fx.SEK as { rate: number }).rate;

/**
 * The size charge: a share of what this company would pay if it ran predictive
 * hiring on every recruitment it makes, rather than only the committed ones.
 */
function phFullSEK(book: PriceBook, emp: number): number {
  const c = book.phSize as NonNullable<PriceBook['phSize']>;
  return phGradSEK(book, Math.max(1, Math.round((emp || 0) * c.hiringPct / 100 - 1e-9)));
}

function phSizeSEK(book: PriceBook, emp: number, q: number): number {
  const c = book.phSize;
  if (!c || !c.on || !emp) return 0;
  const full = phFullSEK(book, emp);
  const base = (full * c.sharePct) / 100;
  // fade: the charge falls away as the commitment approaches full depth.
  if (c.mode === 'fade') {
    const dep = (100 * (q || 0)) / emp;
    const k = Math.max(0, 1 - dep / 8);
    return base * k;
  }
  // floor: the charge is only what the commitment does not already cover.
  if (c.mode === 'floor') return Math.max(0, base - phGradSEK(book, Math.max(1, q || 0)));
  return base;
}

/**
 * What one pack costs a year, before any quote-level discount.
 *
 * Three shapes: the predictive-hiring band model on recruitments, the suite
 * (which is the packs it contains), and everything else — a ladder on
 * employees, optionally with a second ladder on a usage metric.
 */
export function packPrice(
  book: PriceBook,
  pack: Pack,
  employees: number,
  segMult: number,
  processes: number,
): PackPrice {
  if (pack.bandModel) {
    const q = Math.max(1, toInt(processes));
    const i = phBandIdx(book, q);
    const L = phLadder(book);
    const eur = phGradSEK(book, q) / sekPerEur(book);
    const band = i < L.length ? (L[i] as LadderRung) : null;
    const Bq = phBrackets(book);
    const legs: Leg[] = [];
    let prev = 0;
    for (const b of Bq) {
      if (q <= prev) break;
      if (b.flat !== null) {
        legs.push({ part: 'usage', from: 1, to: b.to, n: Math.min(q, b.to), flat: b.flat / sekPerEur(book), amt: b.flat / sekPerEur(book) });
      } else {
        const n = Math.min(q, b.to) - prev;
        legs.push({ part: 'usage', from: b.from, to: b.to, n, r: (b.rate as number) / sekPerEur(book), amt: (n * (b.rate as number)) / sekPerEur(book) });
      }
      prev = b.to;
    }
    if (q > prev) {
      const top = Bq[Bq.length - 1] as Bracket;
      legs.push({ part: 'usage', from: prev + 1, to: null, n: q - prev, r: (top.rate as number) / sekPerEur(book), amt: ((q - prev) * (top.rate as number)) / sekPerEur(book) });
    }
    const sizeSEK = phSizeSEK(book, employees, q);
    const sizeEUR = sizeSEK / sekPerEur(book);
    if (sizeEUR > 0) legs.push({ part: 'size', n: employees, r: sizeEUR / Math.max(1, employees), amt: sizeEUR, label: 'Size charge' });
    let proEUR = 0;
    if (pack.proExtras) {
      const base = eur + sizeEUR;
      (book.phPro || []).forEach((f) => {
        const a = (base * (f.pct || 0)) / 100 + (f.flatSEK || 0) / sekPerEur(book);
        if (a > 0) {
          proEUR += a;
          legs.push({ part: 'pro', n: 1, r: a, amt: a, label: f.name, pct: f.pct, flatSEK: f.flatSEK });
        }
      });
    }
    const tot = eur + sizeEUR + proEUR;
    return {
      tot,
      raw: tot,
      perEmp: employees ? tot / employees : 0,
      legs,
      usageQty: q,
      usageTot: eur,
      sizeTot: sizeEUR,
      proTot: proEUR,
      hasUsage: true,
      blended: employees ? tot / employees : 0,
      band: band ? band.b : 'over',
      bandTo: band ? band.to : null,
    };
  }

  // The suite has no price list of its own — it is the modules it contains,
  // which is how it inherits both metrics.
  if (pack.suiteOf) {
    let raw = 0;
    let usageTot = 0;
    let usageQty = 0;
    let sizeTot = 0;
    let proTot = 0;
    const legs: Leg[] = [];
    pack.suiteOf.forEach((id) => {
      const inner = book.modules.flatMap((m) => m.packs).find((x) => x.id === id);
      if (!inner) return;
      const t = packPrice(book, inner, employees, segMult, processes);
      raw += t.raw;
      usageTot += t.usageTot || 0;
      sizeTot += t.sizeTot || 0;
      proTot += t.proTot || 0;
      usageQty = usageQty || t.usageQty;
      legs.push({ suiteMember: inner.name, amt: t.raw, part: t.hasUsage ? 'usage' : 'platform' });
    });
    const pct = packDiscFor(book, 5);
    const bonus = book.suiteBonusPct || 0;
    const tot = raw * (1 - pct / 100) * (1 - bonus / 100);
    return {
      tot,
      raw,
      perEmp: employees ? tot / employees : 0,
      legs,
      usageQty,
      usageTot,
      sizeTot,
      proTot,
      hasUsage: usageTot > 0,
      suiteParts: raw,
      suiteDisc: pct,
      suiteBonus: bonus,
      blended: employees ? tot / employees : 0,
    };
  }

  const a = bandTotal(pack.bands, employees, segMult);
  a.legs.forEach((l) => {
    l.part = 'platform';
    l.unit = 'employee';
  });
  let raw = a.tot;
  let legs = a.legs;
  let usageQty = 0;
  let usageTot = 0;
  if (pack.usage) {
    usageQty = Math.max(1, toInt(processes));
    const b = bandTotal(pack.usage.bands, usageQty, segMult);
    b.legs.forEach((l) => {
      l.part = 'usage';
      l.unit = (pack.usage as { unit: string }).unit;
    });
    usageTot = b.tot;
    raw += b.tot;
    legs = legs.concat(b.legs);
  }
  // The per-employee rate is what the customer is quoted, so it is what the
  // total is built back up from — the two must agree on the page.
  const perEmp = employees ? Math.round((raw / employees) * 100) / 100 : 0;
  const tot = pack.usage ? raw : perEmp * employees;
  return { tot, raw, perEmp, legs, usageQty, usageTot, hasUsage: !!pack.usage, blended: employees ? tot / employees : 0 };
}

/** The multi-year discount: the deepest rung the term reaches. */
export function engagementPct(book: PriceBook, years: number): number {
  const rows = [...book.engagementDisc].sort((a, b) => a.years - b.years);
  let p = 0;
  rows.forEach((r) => {
    if (years >= r.years) p = r.pct;
  });
  return p;
}

/** The module-count discount: the deepest rung the count reaches. */
export function packDiscFor(book: PriceBook, n: number): number {
  if (n <= 0) return 0;
  const rows = [...book.packDisc].sort((a, b) => a.packs - b.packs);
  let pct = 0;
  rows.forEach((r) => {
    if (n >= r.packs) pct = r.pct;
  });
  return pct;
}

/**
 * Which modules earn their place in the discount grid.
 *
 * Modules count in value order, and only while each is worth more than the
 * discount step it would trigger. Without this, adding a cheap module deepens
 * the discount on everything and the total goes down.
 */
export function countingTiers(
  book: PriceBook,
  lines: Array<{ annual: number; pack: Pack }>,
): { count: number; skipped: string[] } {
  const sorted = [...lines].sort((a, b) => b.annual - a.annual);
  let count = 0;
  let base = 0;
  const skipped: string[] = [];
  for (const l of sorted) {
    const p1 = packDiscFor(book, count) / 100;
    const p2 = packDiscFor(book, count + 1) / 100;
    // what this module must be worth for the deeper discount to still pay
    const bar = p2 > p1 ? (base * (p2 - p1)) / (1 - p2) : 0;
    if (l.annual >= bar) count++;
    else skipped.push(l.pack.name);
    base += l.annual;
  }
  return { count, skipped };
}

// ── Selection helpers ───────────────────────────────────────────────────────

export const moduleById = (book: PriceBook, id: string): Module | undefined => book.modules.find((m) => m.id === id);

export function selectedPackOf(book: PriceBook, packs: Record<string, boolean>, modId: string): Pack | null {
  const m = moduleById(book, modId);
  if (!m) return null;
  return m.packs.find((p) => packs[p.id]) ?? null;
}

/** Which pack ids the chosen Full Suite actually contains. */
export function suiteCovers(book: PriceBook, packs: Record<string, boolean>): string[] {
  const sm = moduleById(book, 'suite');
  const sp = sm ? sm.packs.find((p) => packs[p.id]) : null;
  return sp ? sp.suiteOf || [] : [];
}

export function coveredBySuite(book: PriceBook, packs: Record<string, boolean>, m: Module): boolean {
  if (m.id === 'suite') return false;
  const c = suiteCovers(book, packs);
  return c.length > 0 && m.packs.some((p) => c.includes(p.id));
}

export type { SubscriptionLine };
