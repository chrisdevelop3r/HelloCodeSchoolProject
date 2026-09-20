/**
 * The link between what we quote and what we bill.
 *
 * The state these tests describe is the state we are actually in: the new
 * pricing is not in Zuora, so nothing is mapped and nothing is billable. The
 * point of the module is that this is counted and named rather than discovered
 * when someone tries to raise an invoice.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertBillable,
  billingReadiness,
  catalogCharges,
  CHARGE_MODEL,
  chargeTemplateCsv,
  parseCsv,
  parseCsvRecords,
  parseMappingCsv,
  toCsv,
} from '../src/index.js';
import type { CatalogLink, PriceBook } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(join(here, '../data/price-book.v137.json'), 'utf8')) as PriceBook;

const link = (over: Partial<CatalogLink> = {}): CatalogLink => ({
  priceBookVersionId: 'v137',
  mappings: [],
  ...over,
});

const mapAll = (): CatalogLink =>
  link({
    mappings: catalogCharges(book).map((c) => ({
      key: c.key,
      productRatePlanId: `prp-${c.key}`,
      productRatePlanChargeId: `prpc-${c.key}`,
    })),
  });

describe('catalogCharges', () => {
  it('finds every billable thing in the book', () => {
    const charges = catalogCharges(book);
    const packs = book.modules.flatMap((m) => m.packs).length;
    expect(charges).toHaveLength(packs + book.yearly.length + book.setup.length + book.aiCredits.length);
  });

  it('keys are stable and unique', () => {
    const keys = catalogCharges(book).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('pack:ta_1');
    expect(keys).toContain('yearly:csm');
    expect(keys).toContain('setup:cert');
    expect(keys).toContain('ai:ai_10');
  });

  it('gives predictive hiring the banded model and everything else tiered', () => {
    const charges = catalogCharges(book);
    expect(charges.find((c) => c.key === 'pack:ph_s')?.zuoraChargeModel).toBe(CHARGE_MODEL.banded);
    expect(charges.find((c) => c.key === 'pack:ph_s')?.unit).toBe('recruitment');
    expect(charges.find((c) => c.key === 'pack:ta_1')?.zuoraChargeModel).toBe(CHARGE_MODEL.tiered);
    expect(charges.find((c) => c.key === 'pack:ta_1')?.unit).toBe('employee');
  });

  it('gives the suite its own charge, because a quote shows it as one line', () => {
    expect(catalogCharges(book).some((c) => c.key === 'pack:suite_s')).toBe(true);
  });

  it('does not sell a recurring set-up fee to Zuora as a one-time charge', () => {
    const withAdp: PriceBook = {
      ...book,
      setup: [{ id: 'adp', name: 'Advanced data protection', price: 4200, recurring: true }],
    };
    const charge = catalogCharges(withAdp).find((c) => c.key === 'setup:adp');
    expect(charge?.kind).toBe('recurring-service');
    expect(charge?.zuoraChargeModel).toBe(CHARGE_MODEL.recurring);
  });

  it('refuses a book whose charges would collide', () => {
    const clashing: PriceBook = {
      ...book,
      aiCredits: [
        { id: 'dup', name: 'One', price: 1 },
        { id: 'dup', name: 'Two', price: 2 },
      ],
    };
    expect(() => catalogCharges(clashing)).toThrow(/share the key ai:dup/);
  });
});

describe('billingReadiness', () => {
  it('reports the whole book as unbillable today, because Zuora has none of it', () => {
    const r = billingReadiness(book, link());
    expect(r.billable).toBe(false);
    expect(r.mapped).toHaveLength(0);
    expect(r.unmapped).toHaveLength(r.total);
    expect(r.total).toBeGreaterThan(20);
  });

  it('is billable once every charge has a Zuora charge behind it', () => {
    const r = billingReadiness(book, mapAll());
    expect(r.billable).toBe(true);
    expect(r.unmapped).toHaveLength(0);
  });

  it('does not count a half-filled row as mapped', () => {
    const half = link({
      mappings: [{ key: 'pack:ta_1', productRatePlanId: 'prp-1', productRatePlanChargeId: '' }],
    });
    expect(billingReadiness(book, half).mapped).toHaveLength(0);
    const other = link({
      mappings: [{ key: 'pack:ta_1', productRatePlanId: '', productRatePlanChargeId: 'prpc-1' }],
    });
    expect(billingReadiness(book, other).mapped).toHaveLength(0);
  });

  it('notices a mapping left behind by a charge that no longer exists', () => {
    const stale = mapAll();
    const r = billingReadiness(book, {
      ...stale,
      mappings: [...stale.mappings, { key: 'pack:retired_1', productRatePlanId: 'p', productRatePlanChargeId: 'c' }],
    });
    expect(r.orphaned.map((m) => m.key)).toEqual(['pack:retired_1']);
    expect(r.billable).toBe(false);
  });
});

describe('assertBillable', () => {
  it('passes silently when everything is mapped', () => {
    expect(() => assertBillable(book, mapAll())).not.toThrow();
  });

  it('names the charges Zuora is missing', () => {
    try {
      assertBillable(book, link());
      expect.unreachable('should have refused');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('cannot be billed');
      expect(message).toContain('pack:ta_1 — Talent assessment Pro');
      expect(message).toContain(CHARGE_MODEL.tiered);
    }
  });

  it('names stale mappings too', () => {
    const stale = mapAll();
    expect(() =>
      assertBillable(book, {
        ...stale,
        mappings: [...stale.mappings, { key: 'gone:1', productRatePlanId: 'p', productRatePlanChargeId: 'c' }],
      }),
    ).toThrow(/no longer has:\n {2}gone:1/);
  });
});

describe('CSV', () => {
  it('survives a round trip through commas, quotes and newlines', () => {
    const rows = [
      ['plain', 'has,comma', 'has"quote'],
      ['has\nnewline', '', 'trailing '],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('quotes only the fields that need it', () => {
    expect(toCsv([['a', 'b,c']])).toBe('a,"b,c"\n');
  });

  it('reads CRLF the same as LF', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps a trailing empty field', () => {
    expect(parseCsv('a,')).toEqual([['a', '']]);
  });

  it('keeps a row that is one empty quoted field', () => {
    expect(parseCsv('""')).toEqual([['']]);
  });

  it('refuses a file that ends mid-quote rather than guessing', () => {
    expect(() => parseCsv('a,"unterminated')).toThrow(/ends inside a quoted field/);
  });

  it('reads records by header name, not by column position', () => {
    const moved = 'b,a\n2,1\n';
    expect(parseCsvRecords(moved)).toEqual([{ a: '1', b: '2' }]);
  });

  it('ignores blank lines and pads short rows', () => {
    expect(parseCsvRecords('a,b\n\n1\n')).toEqual([{ a: '1', b: '' }]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsvRecords('')).toEqual([]);
  });
});

describe('the Zuora handoff', () => {
  it('produces a template with one row per charge and the Zuora columns blank', () => {
    const records = parseCsvRecords(chargeTemplateCsv(book));
    expect(records).toHaveLength(catalogCharges(book).length);
    expect(records.every((r) => r['product_rate_plan_id'] === '')).toBe(true);
    expect(records[0]?.['zuora_charge_model']).toBeTruthy();
  });

  it('pre-fills what is already mapped, so a second round asks only for the rest', () => {
    const partial = link({
      mappings: [{ key: 'pack:ta_1', productRatePlanId: 'prp-9', productRatePlanChargeId: 'prpc-9', productName: 'TA' }],
    });
    const records = parseCsvRecords(chargeTemplateCsv(book, partial));
    const ta = records.find((r) => r['charge_key'] === 'pack:ta_1');
    expect(ta?.['product_rate_plan_id']).toBe('prp-9');
    expect(ta?.['zuora_product_name']).toBe('TA');
  });

  it('survives the charge model strings, which contain commas', () => {
    const records = parseCsvRecords(chargeTemplateCsv(book));
    const ph = records.find((r) => r['charge_key'] === 'pack:ph_s');
    expect(ph?.['zuora_charge_model']).toBe(CHARGE_MODEL.banded);
  });

  it('round-trips a filled-in template back into mappings', () => {
    const filled = chargeTemplateCsv(book, mapAll());
    const mappings = parseMappingCsv(filled);
    expect(mappings).toHaveLength(catalogCharges(book).length);
    expect(billingReadiness(book, link({ mappings })).billable).toBe(true);
  });

  it('drops rows nobody has filled in yet', () => {
    expect(parseMappingCsv(chargeTemplateCsv(book))).toEqual([]);
  });

  it('keeps the optional names when they are given', () => {
    const csv =
      'charge_key,product_rate_plan_id,product_rate_plan_charge_id,zuora_product_name,zuora_charge_name\n' +
      'pack:ta_1,prp-1,prpc-1,Talent Suite,TA Annual\n';
    expect(parseMappingCsv(csv)).toEqual([
      {
        key: 'pack:ta_1',
        productRatePlanId: 'prp-1',
        productRatePlanChargeId: 'prpc-1',
        productName: 'Talent Suite',
        chargeName: 'TA Annual',
      },
    ]);
  });

  it('refuses a row with no charge key, naming the spreadsheet row', () => {
    const csv = 'charge_key,product_rate_plan_id,product_rate_plan_charge_id\n,prp-1,prpc-1\n';
    expect(() => parseMappingCsv(csv)).toThrow(/Row 2 of the mapping CSV has no charge_key/);
  });

  it('refuses a spreadsheet saved without the charge_key column', () => {
    const csv = 'product_rate_plan_id,product_rate_plan_charge_id\nprp-1,prpc-1\n';
    expect(() => parseMappingCsv(csv)).toThrow(/Row 2 of the mapping CSV has no charge_key/);
  });

  it('treats a spreadsheet saved without the id columns as nothing filled in', () => {
    expect(parseMappingCsv('charge_key\npack:ta_1\n')).toEqual([]);
  });

  it('refuses a charge mapped to two different Zuora charges', () => {
    const csv =
      'charge_key,product_rate_plan_id,product_rate_plan_charge_id\n' +
      'pack:ta_1,prp-1,prpc-1\npack:ta_1,prp-2,prpc-2\n';
    expect(() => parseMappingCsv(csv)).toThrow(/maps pack:ta_1 twice/);
  });
});
