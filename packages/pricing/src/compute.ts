/**
 * `computeQuote` — the port of v137's `calc()`.
 *
 * Takes a price book and a quote, returns every number that appears on the
 * quote. Euros throughout; the display currency never reaches here.
 */
import {
  countingTiers,
  coveredBySuite,
  engagementPct,
  packDiscFor,
  packPrice,
  segmentFor,
  selectedPackOf,
} from './engine.js';
import type { OneTimeLine, Pack, PriceBook, QuoteInput, QuoteResult, ServiceLine, SubscriptionLine } from './types.js';

const toInt = (v: number): number => (Number.isFinite(v) ? v : 0) | 0;

/** The integration flags live in the set-up map without a fee of their own. */
const INTEGRATIONS = ['ats', 'lms', 'tms'] as const;

export function computeQuote(book: PriceBook, input: QuoteInput): QuoteResult {
  const users = Math.max(1, toInt(input.users));
  const seg = segmentFor(book, input.users);
  const pick = (modId: string): Pack | null => selectedPackOf(book, input.packs, modId);
  const suiteOn = !!pick('suite');

  const subLines: SubscriptionLine[] = [];
  const counting: Array<{ annual: number; pack: Pack }> = [];
  book.modules.forEach((m) => {
    if (coveredBySuite(book, input.packs, m)) return;
    const p = pick(m.id);
    if (!p) return;
    const q = Math.max(1, toInt(input.users));
    const t = packPrice(book, p, q, seg.mult, input.processes);
    subLines.push({
      modId: m.id,
      packId: p.id,
      qty: q,
      unit: t.blended,
      annual: t.tot,
      raw: t.raw,
      perEmp: t.perEmp,
      net: 0, // filled once the discount is known
      hasUsage: !!t.hasUsage,
      usageQty: t.usageQty,
      usageTot: t.usageTot,
      sizeTot: t.sizeTot || 0,
      proTot: t.proTot || 0,
      platformTot: t.raw - t.usageTot - (t.sizeTot || 0) - (t.proTot || 0),
      suiteParts: t.suiteParts ?? null,
      suiteDisc: t.suiteDisc ?? null,
      suiteBonus: t.suiteBonus ?? null,
      legs: t.legs,
    });
    if (m.id !== 'suite') counting.push({ annual: t.tot, pack: p });
  });

  const tiers = countingTiers(book, counting);
  const packCount = suiteOn ? book.fullSuiteCountsAsPacks : tiers.count;
  const notCounted = suiteOn ? [] : tiers.skipped;

  const listSub = subLines.reduce((a, l) => a + l.annual, 0);
  const packPct = packDiscFor(book, packCount);
  const engPct = engagementPct(book, Number(input.years) || 1);
  const discPct = Math.max(0, Number(input.disc) || 0);
  const additive = (book.discountStacking || 'additive') === 'additive';

  let packAmt: number;
  let engAmt: number;
  let discAmt: number;
  let totalPct: number;
  if (additive) {
    totalPct = Math.min(100, packPct + engPct + discPct);
    packAmt = (listSub * packPct) / 100;
    engAmt = (listSub * engPct) / 100;
    discAmt = (listSub * discPct) / 100;
  } else {
    packAmt = (listSub * packPct) / 100;
    const afterPack = listSub - packAmt;
    engAmt = (afterPack * engPct) / 100;
    const afterEng = afterPack - engAmt;
    discAmt = (afterEng * discPct) / 100;
    totalPct = listSub ? (1 - (afterEng - discAmt) / listSub) * 100 : 0;
  }

  // One discount, applied to the whole subscription.
  const rawFactor = 1 - totalPct / 100;
  subLines.forEach((l) => {
    l.net = l.annual * rawFactor;
  });
  const netSub = subLines.reduce((a, l) => a + l.net, 0);
  const effPct = listSub ? (1 - netSub / listSub) * 100 : 0;

  // ── Yearly services ───────────────────────────────────────────────────────
  const anyIntegration = INTEGRATIONS.some((id) => input.setup[id]);
  const yLines: ServiceLine[] = [];
  book.yearly.forEach((y) => {
    if (y.needsIntegration) {
      if (!anyIntegration) return;
      if (!input.yearly[y.id]) return;
    } else if (!input.yearly[y.id]) return;
    if (y.needs && !pick(y.needs) && !suiteOn) return;
    let amt: number;
    let note = '';
    if (y.qty) {
      const raw = Number(input.yearly[`${y.id}_q`]);
      const q = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 1;
      if (q === 0) return;
      amt = y.price * q;
      note = `${q} ${y.per || ''}${q !== 1 && y.per ? 's' : ''}`;
    } else if (y.threshold) {
      const hi = input.users >= y.threshold;
      amt = (hi ? y.priceHigh : y.price) as number;
      note = hi ? `≥ ${y.threshold} users` : `< ${y.threshold} users`;
    } else amt = y.price;
    yLines.push({
      name: y.name,
      amt,
      note,
      auto: !!y.needsIntegration,
      qty: y.qty ? Math.max(0, Math.floor(Number(input.yearly[`${y.id}_q`]) ?? 1)) : null,
      unitPrice: y.price,
    });
  });
  // ADP is a yearly charge that lives in the set-up list.
  book.setup
    .filter((x) => x.recurring)
    .forEach((x) => {
      if (!input.setup[x.id]) return;
      if (x.needs && !pick(x.needs) && !suiteOn) return;
      yLines.push({ name: x.name, amt: x.price, note: '', auto: false, qty: null, unitPrice: null });
    });
  const yearlyTot = yLines.reduce((a, l) => a + l.amt, 0);

  // ── One-time fees ─────────────────────────────────────────────────────────
  const oLines: OneTimeLine[] = [];
  book.setup.forEach((x) => {
    if (x.recurring) return;
    if (!input.setup[x.id]) return;
    // The module this fee belongs to may have been removed since it was ticked.
    if (x.needs && !pick(x.needs) && !suiteOn) return;
    let amt: number;
    let note = '';
    if (x.threshold) {
      const hi = input.users >= x.threshold;
      amt = (hi ? x.priceHigh : x.price) as number;
      note = hi ? `≥ ${x.threshold} users` : `< ${x.threshold} users`;
    } else if (x.qty) {
      const raw = Number(input.setup[`${x.id}_q`]);
      const q = Math.max(0, Math.floor(Number.isFinite(raw) ? raw : x.step || 1));
      if (q === 0) return; // nothing ordered, nothing charged
      amt = x.price * q;
      note = `${q} ${x.per || ''}${q !== 1 && x.per ? 's' : ''}`;
    } else amt = x.price;
    oLines.push({
      name: x.name,
      amt,
      note,
      unit: x.per ?? null,
      qty: x.qty ? Math.max(0, Math.floor(Number(input.setup[`${x.id}_q`]) ?? (x.step || 1))) : null,
      unitPrice: x.price,
    });
  });
  book.aiCredits.forEach((a) => {
    const q = Number(input.ai[a.id]) || 0;
    if (!q) return;
    oLines.push({ name: a.name, amt: a.price * q, note: q > 1 ? `${q} ×` : '', unit: null, qty: null, unitPrice: null });
  });

  const setupGross = oLines.reduce((a, l) => a + l.amt, 0);
  const setupDiscPct = Math.max(0, Number(input.setupDisc) || 0);
  const setupDiscAmt = (setupGross * setupDiscPct) / 100;
  const oneTime = setupGross - setupDiscAmt;

  const arr = netSub + yearlyTot;
  return {
    users,
    segId: seg.id,
    segMult: seg.mult,
    suiteOn,
    packCount,
    notCounted,
    listSub,
    packPct,
    packAmt,
    engPct,
    engAmt,
    discPct,
    discAmt,
    netSub,
    totalPct,
    additive,
    rawFactor,
    effPct,
    subLines,
    yLines,
    yearlyTot,
    oLines,
    setupGross,
    setupDiscPct,
    setupDiscAmt,
    oneTime,
    arr,
    mrr: arr / 12,
    year1: arr + oneTime,
    tcv: arr * (Number(input.years) || 1) + oneTime,
    perUser: users ? arr / users : 0,
  };
}
