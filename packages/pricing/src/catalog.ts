/**
 * The bridge between what we quote and what we bill.
 *
 * There are two catalogues and they are not the same thing:
 *
 * - **the price book** — what a rep quotes from. That is v137.
 * - **the Zuora catalogue** — what actually raises an invoice.
 *
 * They are linked, never merged. The price book stays the source of truth for
 * prices; Zuora stays the source of truth for billing. Each billable thing in
 * the book needs a slot naming the Zuora charge it becomes.
 *
 * As of this writing **the new pricing does not exist in Zuora at all**, so
 * every one of those slots is empty. That is precisely why this module exists:
 * rather than leave the gap to be discovered when someone tries to invoice,
 * `billingReadiness` counts it and names it, and `chargeTemplateCsv` produces
 * the list of charges Zuora is missing as something a person can act on.
 */
import { parseCsvRecords, toCsv } from './csv.js';
import type { PriceBook } from './types.js';

export type ChargeKind =
  /** Priced by the engine from the quote's inputs. */
  | 'subscription'
  /** A fixed fee charged every year. */
  | 'recurring-service'
  /** A fixed fee charged once. */
  | 'one-time';

/**
 * Charge models as the prototype itself names them (v137 lines 4261–4341).
 * They are reproduced here rather than re-derived, because how a charge must be
 * modelled in Zuora is a fact about the charge, not about any one quote.
 */
export const CHARGE_MODEL = {
  banded: 'Volume Pricing, Flat Fee per band — quantity is committed recruitments',
  tiered: 'Tiered — employees',
  recurring: 'Recurring flat fee',
  oneTime: 'One-time',
} as const;

export interface CatalogCharge {
  /** Stable across price book versions, e.g. `pack:ta_1`. Quotes and mappings key on it. */
  key: string;
  kind: ChargeKind;
  name: string;
  zuoraChargeModel: string;
  /** What a quantity on the Zuora charge counts. */
  unit: string | null;
}

/** Every billable thing a price book can put on a quote. */
export function catalogCharges(book: PriceBook): CatalogCharge[] {
  const charges: CatalogCharge[] = [];

  for (const module of book.modules) {
    for (const pack of module.packs) {
      charges.push({
        key: `pack:${pack.id}`,
        kind: 'subscription',
        name: pack.name,
        zuoraChargeModel: pack.bandModel ? CHARGE_MODEL.banded : CHARGE_MODEL.tiered,
        unit: pack.bandModel ? 'recruitment' : 'employee',
      });
    }
  }

  for (const fee of book.yearly) {
    charges.push({
      key: `yearly:${fee.id}`,
      kind: 'recurring-service',
      name: fee.name,
      zuoraChargeModel: CHARGE_MODEL.recurring,
      unit: fee.per ?? null,
    });
  }

  // A fee in the set-up list may still be a yearly charge — v137 marks those
  // `recurring`, and they must not be sold to Zuora as one-time.
  for (const fee of book.setup) {
    charges.push({
      key: `setup:${fee.id}`,
      kind: fee.recurring ? 'recurring-service' : 'one-time',
      name: fee.name,
      zuoraChargeModel: fee.recurring ? CHARGE_MODEL.recurring : CHARGE_MODEL.oneTime,
      unit: fee.per ?? null,
    });
  }

  for (const credit of book.aiCredits) {
    charges.push({
      key: `ai:${credit.id}`,
      kind: 'one-time',
      name: credit.name,
      zuoraChargeModel: CHARGE_MODEL.oneTime,
      unit: null,
    });
  }

  const seen = new Set<string>();
  for (const c of charges) {
    if (seen.has(c.key)) throw new Error(`Two catalogue charges share the key ${c.key}.`);
    seen.add(c.key);
  }
  return charges;
}

export interface ZuoraMapping {
  /** Matches `CatalogCharge.key`. */
  key: string;
  productRatePlanId: string;
  productRatePlanChargeId: string;
  productName?: string;
  chargeName?: string;
}

export interface CatalogLink {
  priceBookVersionId: string;
  mappings: readonly ZuoraMapping[];
}

export interface BillingReadiness {
  priceBookVersionId: string;
  total: number;
  mapped: CatalogCharge[];
  /** Charges with nothing in Zuora behind them. The worklist. */
  unmapped: CatalogCharge[];
  /** Mappings pointing at charges this book no longer has. Drift the other way. */
  orphaned: ZuoraMapping[];
  billable: boolean;
}

/** What can be invoiced, what cannot, and what the link has gone stale about. */
export function billingReadiness(book: PriceBook, link: CatalogLink): BillingReadiness {
  const charges = catalogCharges(book);
  const byKey = new Map(link.mappings.map((m) => [m.key, m]));
  const keys = new Set(charges.map((c) => c.key));

  const mapped: CatalogCharge[] = [];
  const unmapped: CatalogCharge[] = [];
  for (const charge of charges) {
    const m = byKey.get(charge.key);
    // A row that exists but has no Zuora ids in it is not a mapping — it is a
    // template row somebody has not filled in yet.
    if (m && m.productRatePlanId && m.productRatePlanChargeId) mapped.push(charge);
    else unmapped.push(charge);
  }

  const orphaned = link.mappings.filter((m) => !keys.has(m.key));
  return {
    priceBookVersionId: link.priceBookVersionId,
    total: charges.length,
    mapped,
    unmapped,
    orphaned,
    billable: unmapped.length === 0 && orphaned.length === 0,
  };
}

/** Refuse to treat a price book as billable while anything is unaccounted for. */
export function assertBillable(book: PriceBook, link: CatalogLink): void {
  const r = billingReadiness(book, link);
  if (r.billable) return;
  const lines: string[] = [];
  if (r.unmapped.length) {
    lines.push(
      `${r.unmapped.length} of ${r.total} charges have no Zuora charge behind them:`,
      ...r.unmapped.map((c) => `  ${c.key} — ${c.name} (${c.zuoraChargeModel})`),
    );
  }
  if (r.orphaned.length) {
    lines.push(
      `${r.orphaned.length} mapping(s) point at charges ${r.priceBookVersionId} no longer has:`,
      ...r.orphaned.map((m) => `  ${m.key}`),
    );
  }
  throw new Error(`Price book ${r.priceBookVersionId} cannot be billed.\n${lines.join('\n')}`);
}

// ── The handoff to whoever builds the Zuora catalogue ────────────────────────

const CSV_COLUMNS = [
  'charge_key',
  'charge_kind',
  'charge_name',
  'unit',
  'zuora_charge_model',
  'product_rate_plan_id',
  'product_rate_plan_charge_id',
  'zuora_product_name',
  'zuora_charge_name',
] as const;

/**
 * Every charge in the book as a spreadsheet, with our four columns filled and
 * the Zuora columns left blank to be filled in and handed back.
 *
 * Pass the current link to pre-fill what is already mapped, so a second round
 * only asks for what is still missing.
 */
export function chargeTemplateCsv(book: PriceBook, link?: CatalogLink): string {
  const byKey = new Map((link?.mappings ?? []).map((m) => [m.key, m]));
  const rows: string[][] = [[...CSV_COLUMNS]];
  for (const charge of catalogCharges(book)) {
    const m = byKey.get(charge.key);
    rows.push([
      charge.key,
      charge.kind,
      charge.name,
      charge.unit ?? '',
      charge.zuoraChargeModel,
      m?.productRatePlanId ?? '',
      m?.productRatePlanChargeId ?? '',
      m?.productName ?? '',
      m?.chargeName ?? '',
    ]);
  }
  return toCsv(rows);
}

/**
 * Read a filled-in template back.
 *
 * Rows without both Zuora ids are dropped rather than stored as empty mappings:
 * a half-filled row means "not done yet", and recording it as a mapping would
 * make `billingReadiness` report a charge as ready when it is not.
 */
export function parseMappingCsv(text: string): ZuoraMapping[] {
  const records = parseCsvRecords(text);
  const mappings: ZuoraMapping[] = [];
  for (const [index, record] of records.entries()) {
    const key = record['charge_key'] ?? '';
    if (!key) throw new Error(`Row ${index + 2} of the mapping CSV has no charge_key.`);
    const productRatePlanId = record['product_rate_plan_id'] ?? '';
    const productRatePlanChargeId = record['product_rate_plan_charge_id'] ?? '';
    if (!productRatePlanId || !productRatePlanChargeId) continue;
    const mapping: ZuoraMapping = { key, productRatePlanId, productRatePlanChargeId };
    if (record['zuora_product_name']) mapping.productName = record['zuora_product_name'];
    if (record['zuora_charge_name']) mapping.chargeName = record['zuora_charge_name'];
    mappings.push(mapping);
  }
  const seen = new Set<string>();
  for (const m of mappings) {
    if (seen.has(m.key)) throw new Error(`The mapping CSV maps ${m.key} twice.`);
    seen.add(m.key);
  }
  return mappings;
}
