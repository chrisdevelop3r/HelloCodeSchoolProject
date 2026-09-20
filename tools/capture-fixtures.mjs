/**
 * Phase 0 — freeze v137's behaviour.
 *
 * Loads the prototype in Chromium, dumps its price book, then runs every
 * scenario in `tools/scenarios.mjs` through the prototype's own `calc()` and
 * writes the answers to `packages/pricing/test/fixtures/`.
 *
 * The fixtures are generated. Never hand-edit one: CI re-runs this tool and
 * fails on any difference, so a hand-edit is a build break, and a fixture
 * edited to match the port is worse than no fixture at all.
 *
 *   node tools/capture-fixtures.mjs           # write
 *   node tools/capture-fixtures.mjs --check   # fail if anything would change
 *
 * Set PLAYWRIGHT_CHROMIUM_PATH when Chromium is installed outside Playwright's
 * own cache.
 */
import { chromium } from 'playwright';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import scenarios from './scenarios.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PROTOTYPE = join(root, 'prototypes/talent_suite_pricing_v137.html');
const FIXTURES = join(root, 'packages/pricing/test/fixtures');
const PRICE_BOOK = join(root, 'packages/pricing/data/price-book.v137.json');
const check = process.argv.includes('--check');

/**
 * Turn the prototype's `calc()` result into JSON.
 *
 * This is a projection and nothing else — it renames and drops, it never
 * computes. Any arithmetic here would be arithmetic the fixtures no longer
 * test.
 */
function project(r) {
  const line = (l) => ({
    modId: l.mod.id,
    packId: l.pack.id,
    qty: l.qty,
    unit: l.unit,
    annual: l.annual,
    raw: l.raw,
    perEmp: l.perEmp,
    net: l.net,
    hasUsage: !!l.hasUsage,
    usageQty: l.usageQty ?? null,
    usageTot: l.usageTot ?? null,
    sizeTot: l.sizeTot,
    proTot: l.proTot,
    platformTot: l.platformTot,
    suiteParts: l.suiteParts ?? null,
    suiteDisc: l.suiteDisc ?? null,
    suiteBonus: l.suiteBonus ?? null,
    legs: l.legs,
  });
  return {
    users: r.users,
    segId: r.seg.id,
    segMult: r.seg.mult,
    suiteOn: r.suiteOn,
    packCount: r.packCount,
    notCounted: r.notCounted,
    listSub: r.listSub,
    packPct: r.packPct,
    packAmt: r.packAmt,
    engPct: r.engPct,
    engAmt: r.engAmt,
    discPct: r.discPct,
    discAmt: r.discAmt,
    netSub: r.netSub,
    totalPct: r.totalPct,
    additive: r.additive,
    rawFactor: r.rawFactor,
    effPct: r.effPct,
    subLines: r.subLines.map(line),
    yLines: r.yLines.map((y) => ({
      name: y.name,
      amt: y.amt,
      note: y.note,
      auto: !!y.auto,
      qty: y.qty ?? null,
      unitPrice: y.unitPrice ?? null,
    })),
    yearlyTot: r.yearlyTot,
    oLines: r.oLines.map((o) => ({
      name: o.name,
      amt: o.amt,
      note: o.note,
      unit: o.unit ?? null,
      qty: o.qty ?? null,
      unitPrice: o.unitPrice ?? null,
    })),
    setupGross: r.setupGross,
    setupDiscPct: r.setupDiscPct,
    setupDiscAmt: r.setupDiscAmt,
    oneTime: r.oneTime,
    arr: r.arr,
    mrr: r.mrr,
    year1: r.year1,
    tcv: r.tcv,
    perUser: r.perUser,
  };
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(pathToFileURL(PROTOTYPE).href);
if (!(await page.evaluate(() => typeof calc === 'function'))) {
  throw new Error('The prototype did not finish loading — calc() is not defined.');
}

// The price book is data, not source. Take it verbatim, before any scenario
// has had a chance to touch it.
const priceBook = await page.evaluate(() => structuredClone(M));
await page.evaluate((snapshot) => {
  globalThis.__BOOK = snapshot;
  globalThis.__run = ({ overrides, input, currency }, projectSrc) => {
    // Every scenario starts from the same book, so no scenario can leak into
    // the next through a lever it changed.
    M = { ...structuredClone(globalThis.__BOOK), ...structuredClone(overrides) };
    S = structuredClone(input);
    CUR = currency || 'EUR';
    // eslint-disable-next-line no-eval
    return (0, eval)(`(${projectSrc})`)(calc());
  };
}, priceBook);

const projectSrc = project.toString();
const written = new Map();

for (const s of scenarios) {
  const result = await page.evaluate(
    ([s, src]) => globalThis.__run(s, src),
    [{ overrides: s.overrides, input: s.input, currency: 'EUR' }, projectSrc],
  );

  // The engine returns euros; the display currency is a formatting concern.
  // Prove it rather than assume it — if this ever fires, the fixtures need a
  // currency axis and `computeQuote` needs a currency argument.
  for (const currency of ['SEK', 'NOK', 'DKK']) {
    const other = await page.evaluate(
      ([s, src]) => globalThis.__run(s, src),
      [{ overrides: s.overrides, input: s.input, currency }, projectSrc],
    );
    if (JSON.stringify(other) !== JSON.stringify(result)) {
      throw new Error(`Scenario ${s.name} priced differently in ${currency}: calc() is not currency-independent.`);
    }
  }

  written.set(`${s.name}.json`, `${JSON.stringify({
    name: s.name,
    description: s.description,
    priceBook: 'v137',
    overrides: s.overrides,
    input: s.input,
    expected: result,
  }, null, 2)}\n`);
}

if (pageErrors.length) throw new Error(`The prototype threw while capturing:\n${pageErrors.join('\n')}`);
await browser.close();

const bookJson = `${JSON.stringify(priceBook, null, 2)}\n`;

if (check) {
  const failures = [];
  const onDisk = new Set((await readdir(FIXTURES).catch(() => [])).filter((f) => f.endsWith('.json')));
  for (const [file, body] of written) {
    const current = await readFile(join(FIXTURES, file), 'utf8').catch(() => null);
    if (current !== body) failures.push(`fixture ${file} does not match v137`);
    onDisk.delete(file);
  }
  for (const stale of onDisk) failures.push(`fixture ${stale} has no scenario`);
  if ((await readFile(PRICE_BOOK, 'utf8').catch(() => null)) !== bookJson) {
    failures.push('price-book.v137.json does not match the prototype');
  }
  if (failures.length) {
    console.error(`${failures.length} fixture(s) out of date:\n  ${failures.join('\n  ')}`);
    console.error('\nRun `pnpm capture` and commit the result. Do not edit fixtures by hand.');
    process.exit(1);
  }
  console.log(`${written.size} fixtures match the prototype.`);
} else {
  await rm(FIXTURES, { recursive: true, force: true });
  await mkdir(FIXTURES, { recursive: true });
  await mkdir(dirname(PRICE_BOOK), { recursive: true });
  for (const [file, body] of written) await writeFile(join(FIXTURES, file), body);
  await writeFile(PRICE_BOOK, bookJson);
  console.log(`Captured ${written.size} fixtures from v137.`);
}
