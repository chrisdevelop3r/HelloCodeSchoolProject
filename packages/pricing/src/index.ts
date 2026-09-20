export { computeQuote } from './compute.js';
export { canonicalJson, fingerprint } from './fingerprint.js';
export { divergences, issueQuote, rerenderQuote } from './issue.js';
export { createVersion, PriceBookRegistry } from './version.js';
export {
  bandTotal,
  countingTiers,
  coveredBySuite,
  engagementPct,
  moduleById,
  packDiscFor,
  packPrice,
  phBandIdx,
  phGradSEK,
  phLadder,
  segmentFor,
  selectedPackOf,
  suiteCovers,
} from './engine.js';
export type { Divergence, IssuedQuote, IssueRequest } from './issue.js';
export type { PriceBookStatus, PriceBookVersion, PriceBookVersionInput } from './version.js';
export type {
  AiCredit,
  Band,
  Fee,
  Leg,
  Module,
  OneTimeLine,
  Pack,
  PackPrice,
  PriceBook,
  QuoteInput,
  QuoteResult,
  Segment,
  ServiceLine,
  SubscriptionLine,
} from './types.js';
