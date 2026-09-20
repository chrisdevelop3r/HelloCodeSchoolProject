/**
 * The shapes the engine works on.
 *
 * These describe v137's price book as it actually is, not as it should be. The
 * book is captured verbatim from the prototype by `tools/capture-fixtures.mjs`;
 * changing these types without re-capturing makes them a description of
 * nothing.
 */

/** A rung on a price ladder. `to: null` is the open-ended top band. */
export interface Band {
  to: number | null;
  /** A flat fee for the whole band. Mutually exclusive with `rate`. */
  flat?: number;
  /** A per-unit rate for the quantity falling inside this band. */
  rate?: number;
}

export interface Pack {
  id: string;
  name: string;
  /** Employee ladder. Absent on the suite and on band-model packs. */
  bands?: Band[];
  /** A second ladder on a usage metric, charged on top of the employee ladder. */
  usage?: { unit: string; bands?: Band[] };
  /** Predictive hiring: graduated brackets on recruitments, not a `bands` walk. */
  bandModel?: boolean;
  /** Pro tier: adds the `phPro` extras on top of the band model. */
  proExtras?: boolean;
  /** The suite has no list of its own — it is the packs it names. */
  suiteOf?: string[];
  [extra: string]: unknown;
}

export interface Module {
  id: string;
  name: string;
  packs: Pack[];
  [extra: string]: unknown;
}

/** A headcount bracket. It sets AI credits and defaults; it does not price. */
export interface Segment {
  id: string;
  name: string;
  from: number;
  to: number | null;
  mult: number;
  [extra: string]: unknown;
}

export interface Fee {
  id: string;
  name: string;
  price: number;
  /** Charged per year even though it sits in the one-time list. */
  recurring?: boolean;
  /** Priced per unit, quantity taken from the quote. */
  qty?: boolean;
  per?: string;
  /** Default quantity when the quote does not carry one. */
  step?: number;
  /** Steps to `priceHigh` at or above this headcount. */
  threshold?: number;
  priceHigh?: number;
  /** Falls away when this module is not on the quote. */
  needs?: string;
  /** Only offered once some integration is being bought. */
  needsIntegration?: boolean;
  [extra: string]: unknown;
}

export interface AiCredit {
  id: string;
  name: string;
  price: number;
  [extra: string]: unknown;
}

export interface PriceBook {
  fx: Record<string, { sym: string; rate: number }>;
  packDisc: Array<{ packs: number; pct: number }>;
  engagementDisc: Array<{ years: number; pct: number }>;
  phBands: { anchorSEK: number; parityPct: number; doublingPct: number; bands: number[]; roundTo?: number };
  phFloor?: { on: boolean; sek: number };
  phPro?: Array<{ id: string; name: string; pct?: number; flatSEK?: number }>;
  phSize?: { on: boolean; sharePct: number; hiringPct: number; mode: 'flat' | 'fade' | 'floor' };
  fullSuiteCountsAsPacks: number;
  suiteBonusPct?: number;
  discountStacking?: 'additive' | 'sequential';
  segments: Segment[];
  modules: Module[];
  aiCredits: AiCredit[];
  setup: Fee[];
  yearly: Fee[];
  [extra: string]: unknown;
}

/**
 * Everything a quote is priced from.
 *
 * `setup` and `yearly` are the prototype's flat maps: `{ cert: true, cert_q: 3 }`
 * means the fee is on the quote with a quantity of three. `setup` also carries
 * the bare integration flags `ats`, `lms` and `tms`, which have no fee of their
 * own but decide whether integration maintenance may be sold.
 */
export interface QuoteInput {
  users: number;
  processes: number;
  years: number;
  packs: Record<string, boolean>;
  setup: Record<string, boolean | number>;
  yearly: Record<string, boolean | number>;
  ai: Record<string, number>;
  /** A negotiated discount on the subscription, in percent. */
  disc: number;
  /** A discount on the one-time fees only, in percent. */
  setupDisc: number;
}

/** One leg of a price: a band walked, a size charge, a Pro extra. */
export interface Leg {
  part?: 'platform' | 'usage' | 'size' | 'pro';
  unit?: string;
  from?: number;
  to?: number | null;
  n?: number;
  r?: number;
  flat?: number;
  amt: number;
  label?: string;
  pct?: number;
  flatSEK?: number;
  suiteMember?: string;
}

/** What one pack costs before any quote-level discount. */
export interface PackPrice {
  tot: number;
  raw: number;
  perEmp: number;
  legs: Leg[];
  usageQty: number;
  usageTot: number;
  hasUsage: boolean;
  blended: number;
  sizeTot?: number;
  proTot?: number;
  suiteParts?: number;
  suiteDisc?: number;
  suiteBonus?: number;
  band?: number | 'over';
  bandTo?: number | null;
}

export interface SubscriptionLine {
  modId: string;
  packId: string;
  qty: number;
  unit: number;
  annual: number;
  raw: number;
  perEmp: number;
  net: number;
  hasUsage: boolean;
  usageQty: number;
  usageTot: number;
  sizeTot: number;
  proTot: number;
  platformTot: number;
  suiteParts: number | null;
  suiteDisc: number | null;
  suiteBonus: number | null;
  legs: Leg[];
}

export interface ServiceLine {
  name: string;
  amt: number;
  note: string;
  auto: boolean;
  qty: number | null;
  unitPrice: number | null;
}

export interface OneTimeLine {
  name: string;
  amt: number;
  note: string;
  unit: string | null;
  qty: number | null;
  unitPrice: number | null;
}

/**
 * A priced quote. Every amount is in euros — the display currency is a
 * formatting concern and does not reach the engine. `tools/capture-fixtures.mjs`
 * re-proves that against the prototype on every run.
 */
export interface QuoteResult {
  users: number;
  segId: string;
  segMult: number;
  suiteOn: boolean;
  packCount: number;
  notCounted: string[];
  listSub: number;
  packPct: number;
  packAmt: number;
  engPct: number;
  engAmt: number;
  discPct: number;
  discAmt: number;
  netSub: number;
  totalPct: number;
  additive: boolean;
  rawFactor: number;
  effPct: number;
  subLines: SubscriptionLine[];
  yLines: ServiceLine[];
  yearlyTot: number;
  oLines: OneTimeLine[];
  setupGross: number;
  setupDiscPct: number;
  setupDiscAmt: number;
  oneTime: number;
  arr: number;
  mrr: number;
  year1: number;
  tcv: number;
  perUser: number;
}
