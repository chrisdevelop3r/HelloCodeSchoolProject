/**
 * The golden scenario matrix.
 *
 * Every entry is an input to the v137 pricing engine. `tools/capture-fixtures.mjs`
 * runs each one inside the prototype and writes the answer to
 * `packages/pricing/test/fixtures/`. The TypeScript port is then held to those
 * answers exactly.
 *
 * Add scenarios here, never by editing a fixture. A fixture is v137's answer,
 * not ours.
 */

/** The quote state the prototype starts from (`SEED_QUOTE` in v137). */
const base = {
  name: 'Acme Inc',
  years: 1,
  users: 600,
  processes: 14,
  packs: {},
  setup: {},
  yearly: {},
  ai: {},
  disc: 0,
  setupDisc: 0,
  reason: '',
};

const quote = (over = {}) => ({ ...base, ...over });
const picked = (...ids) => Object.fromEntries(ids.map((id) => [id, true]));

/** Headcount brackets: 1/200 small, 201/1000 value, 1001/2500 star, 2501+ enterprise. */
const HEADCOUNTS = [1, 100, 200, 201, 250, 1000, 1001, 2500, 2501, 5000];

/** Recruitment band edges: phBands = [10,20,40,80,160,320,640,1280,2560]. */
const PROCESSES = [1, 10, 11, 20, 40, 41, 160, 2560, 2561, 5000];

const scenarios = [];
const add = (name, description, input, overrides = {}) =>
  scenarios.push({ name, description, overrides, input });

// ── Headcount boundaries, one platform module ────────────────────────────────
for (const users of HEADCOUNTS) {
  add(
    `headcount-${users}-ta`,
    `Talent assessment alone at ${users} employees — segment bracket and band ladder`,
    quote({ users, packs: picked('ta_1') }),
  );
}

// ── Recruitment band boundaries, predictive hiring ───────────────────────────
for (const processes of PROCESSES) {
  add(
    `processes-${processes}-ph-starter`,
    `Predictive hiring Starter at ${processes} recruitments — graduated bracket walk`,
    quote({ processes, packs: picked('ph_s') }),
  );
}

// ── Module count against the discount grid ───────────────────────────────────
const LADDER = ['ta_1', 'perf_s', 'eng_s', 'comp_s', 'dev_st', 'ph_s'];
for (let n = 1; n <= LADDER.length; n++) {
  add(
    `modules-${n}`,
    `${n} module${n === 1 ? '' : 's'} — module-count discount and the countingTiers bar`,
    quote({ packs: picked(...LADDER.slice(0, n)) }),
  );
}

// ── The cheap-module case countingTiers exists to stop ───────────────────────
add(
  'counting-tiers-cheap-module-skipped',
  'A tiny module next to a large one must not deepen the discount on everything',
  quote({ users: 5000, packs: picked('ta_1', 'perf_s', 'eng_s') }),
);

// ── Suite vs the same modules à la carte ─────────────────────────────────────
add('suite-starter', 'Full Suite Starter — inherited metrics, suite discount and bonus', quote({ packs: picked('suite_s') }));
add('suite-pro', 'Full Suite Pro — the Pro members of every module', quote({ packs: picked('suite_p') }));
add(
  'suite-starter-plus-covered-module',
  'A module already inside the suite must not be charged twice',
  quote({ packs: picked('suite_s', 'ta_1') }),
);
add(
  'suite-starter-plus-uncovered-module',
  'A module outside the suite is charged on top',
  quote({ packs: picked('suite_s', 'dev_ss') }),
);
add('a-la-carte-equivalent-of-suite-starter', 'The suite members bought separately', quote({ packs: picked('ph_s', 'ta_1', 'perf_s', 'dev_st', 'eng_s', 'comp_s') }));

// ── Term length against the engagement grid ──────────────────────────────────
for (const years of [1, 2, 3, 4, 5]) {
  add(
    `term-${years}y`,
    `${years}-year term — engagement discount and TCV`,
    quote({ years, packs: picked('ta_1', 'perf_s') }),
  );
}

// ── Discount stacking: the same quote both ways ──────────────────────────────
const stackingQuote = quote({ years: 3, disc: 10, packs: picked('ta_1', 'perf_s', 'eng_s') });
add('stacking-additive', 'Three discounts added together', stackingQuote, { discountStacking: 'additive' });
add('stacking-sequential', 'The same three discounts applied one after another', stackingQuote, { discountStacking: 'sequential' });
add(
  'stacking-additive-capped-at-100',
  'Additive stacking must not take the subscription below zero',
  quote({ years: 5, disc: 90, packs: picked('ta_1', 'perf_s', 'eng_s', 'comp_s', 'dev_st') }),
  { discountStacking: 'additive' },
);

// ── The three open levers from the pricing report ────────────────────────────
add(
  'ph-floor-on',
  'Predictive hiring with the per-recruitment floor switched on',
  quote({ processes: 400, packs: picked('ph_s') }),
  { phFloor: { on: true, sek: 3500 } },
);
add(
  'ph-size-flat',
  'Predictive hiring with the size charge on, flat mode',
  quote({ users: 2000, processes: 40, packs: picked('ph_s') }),
  { phSize: { on: true, sharePct: 20, hiringPct: 15, mode: 'flat' } },
);
add(
  'ph-size-fade',
  'Size charge fading out as committed recruitments approach full depth',
  quote({ users: 2000, processes: 40, packs: picked('ph_s') }),
  { phSize: { on: true, sharePct: 20, hiringPct: 15, mode: 'fade' } },
);
add(
  'ph-size-floor',
  'Size charge as a floor under the recruitment price',
  quote({ users: 2000, processes: 40, packs: picked('ph_s') }),
  { phSize: { on: true, sharePct: 20, hiringPct: 15, mode: 'floor' } },
);
add(
  'ph-pro-extras-priced',
  'Pro extras once Finance has put numbers on them',
  quote({ users: 2000, processes: 40, packs: picked('ph_p') }),
  {
    phPro: [
      { id: 'lense', name: 'Personal Lense', pct: 5, flatSEK: 0 },
      { id: 'lensmkr', name: 'AI Lens Maker', pct: 0, flatSEK: 25000 },
      { id: 'insight', name: 'Extremes & Learning agility', pct: 2.5, flatSEK: 10000 },
    ],
  },
);
add(
  'ph-pro-extras-unpriced',
  'Pro extras at their v137 placeholder of zero — no line should appear',
  quote({ users: 2000, processes: 40, packs: picked('ph_p') }),
);

// ── Services, one-time fees and AI credits ───────────────────────────────────
add(
  'setup-fees-flat',
  'Flat one-time fees',
  quote({ packs: picked('ta_1'), setup: { onb_std: true, migrate: true } }),
);
add(
  'setup-fees-quantity',
  'Quantity-priced fees, including the consultancy step of 10',
  quote({ packs: picked('ph_s'), setup: { cert: true, cert_q: 3, consult: true, consult_q: 20, mgr_ws: true, mgr_ws_q: 2 } }),
);
add(
  'setup-fee-quantity-zero-is-not-charged',
  'A quantity of zero must drop the line, not charge nothing for it',
  quote({ packs: picked('ph_s'), setup: { cert: true, cert_q: 0 } }),
);
add(
  'setup-fee-needs-removed-module',
  'A fee whose module was unticked must fall away',
  quote({ packs: picked('ta_1'), setup: { cert: true, cert_q: 2 } }),
);
add(
  'yearly-services',
  'Recurring services, including the academy quantity',
  quote({ packs: picked('ta_1'), yearly: { academy: true, academy_q: 4, csm: true, support: true } }),
);
add(
  'yearly-integration-maintenance-without-integration',
  'Integration maintenance must not appear when no integration was bought',
  quote({ packs: picked('ta_1'), yearly: { maint: true } }),
);
add(
  'yearly-integration-maintenance-with-integration',
  'Integration maintenance once an ATS integration is on the quote',
  quote({ packs: picked('ta_1'), setup: { ats: true, integ: true, integ_q: 1 }, yearly: { maint: true } }),
);
add(
  'ai-credits',
  'Extra AI credit packs',
  quote({ packs: picked('ta_1'), ai: { ai_10: 2, ai_50: 1 } }),
);
add(
  'setup-discount',
  'A discount on the one-time fees only',
  quote({ packs: picked('ta_1'), setup: { onb_std: true, migrate: true }, setupDisc: 25 }),
);

// ── Threshold-priced fees, either side of the line ───────────────────────────
// No fee in v137's own book carries a threshold, so the branch is dead there.
// These two put one in, because the branch is still in the engine and a future
// price book will use it.
const THRESHOLD_SETUP = [{ id: 'onb_std', name: 'Onboarding & implementation', price: 3500, threshold: 1000, priceHigh: 9000, group: 'Getting started' }];
const THRESHOLD_YEARLY = [{ id: 'support', name: 'Premium support', price: 3000, threshold: 1000, priceHigh: 7500 }];
add(
  'threshold-fee-below-the-line',
  'A threshold-priced fee under the headcount it steps at',
  quote({ users: 999, packs: picked('ta_1'), setup: { onb_std: true }, yearly: { support: true } }),
  { setup: THRESHOLD_SETUP, yearly: THRESHOLD_YEARLY },
);
add(
  'threshold-fee-on-the-line',
  'Exactly at the threshold — v137 reads it as the high price',
  quote({ users: 1000, packs: picked('ta_1'), setup: { onb_std: true }, yearly: { support: true } }),
  { setup: THRESHOLD_SETUP, yearly: THRESHOLD_YEARLY },
);
add(
  'threshold-fee-above-the-line',
  'Over the threshold',
  quote({ users: 4000, packs: picked('ta_1'), setup: { onb_std: true }, yearly: { support: true } }),
  { setup: THRESHOLD_SETUP, yearly: THRESHOLD_YEARLY },
);

// ── Degenerate inputs the engine must survive ────────────────────────────────
add('empty-quote', 'Nothing selected — every total is zero', quote());
add('one-employee', 'A single employee', quote({ users: 1, processes: 1, packs: picked('ta_1') }));
add('zero-users-clamps-to-one', 'Headcount of zero is clamped, not divided by', quote({ users: 0, packs: picked('ta_1') }));
add('zero-processes-clamps-to-one', 'Recruitments of zero is clamped, not divided by', quote({ users: 600, processes: 0, packs: picked('ph_s') }));

// ── Quantity and term edges a rep can actually produce ───────────────────────
add('term-zero-years', 'A term of zero falls back to one year', quote({ years: 0, packs: picked('ta_1') }));
add(
  'stacking-sequential-empty-quote',
  'Sequential stacking with nothing to discount must not divide by zero',
  quote(),
  { discountStacking: 'sequential' },
);
add('yearly-quantity-omitted', 'A per-seat service ticked without a quantity defaults to one', quote({ packs: picked('ta_1'), yearly: { academy: true } }));
add('yearly-quantity-one', 'A quantity of one is not pluralised', quote({ packs: picked('ta_1'), yearly: { academy: true, academy_q: 1 } }));
add('yearly-quantity-zero', 'A quantity of zero drops the service', quote({ packs: picked('ta_1'), yearly: { academy: true, academy_q: 0 } }));
add(
  'integration-bought-but-maintenance-not-ticked',
  'Buying an integration offers maintenance, it does not add it',
  quote({ packs: picked('ta_1'), setup: { ats: true, integ: true, integ_q: 1 } }),
);
add(
  'yearly-fee-needs-a-module-that-is-not-on-the-quote',
  'A service tied to a module falls away with the module',
  quote({ packs: picked('ta_1'), yearly: { csm: true } }),
  { yearly: [{ id: 'csm', name: 'Named customer success manager', price: 6000, needs: 'ph' }] },
);
add(
  'setup-quantity-omitted-uses-the-step',
  'Consultancy ticked without a quantity is sold in its step of ten',
  quote({ packs: picked('ta_1'), setup: { consult: true } }),
);

// ── Branches v137's own price book never reaches ─────────────────────────────
// Both are live code in the engine and both will be used by a future book, so
// they are captured from the prototype rather than guessed at in a unit test.
add(
  'recurring-fee-in-the-setup-list',
  'A fee that sits under set-up but is charged every year',
  quote({ packs: picked('ta_1'), setup: { adp: true, onb_std: true } }),
  {
    setup: [
      { id: 'onb_std', name: 'Onboarding & implementation', price: 3500, group: 'Getting started' },
      { id: 'adp', name: 'Advanced data protection', price: 4200, recurring: true, group: 'Getting started' },
    ],
  },
);
add(
  'usage-ladder-outside-the-band-model',
  'A module charged on employees and on a usage metric, both as plain ladders',
  quote({ users: 800, processes: 120, packs: picked('usage_1') }),
  {
    modules: [
      {
        id: 'usage',
        name: 'Usage-metered module',
        packs: [
          {
            id: 'usage_1',
            name: 'Usage-metered module Pro',
            bands: [{ to: 100, flat: 2000 }, { to: 1000, rate: 12 }, { to: null, rate: 4 }],
            usage: { unit: 'assessment', bands: [{ to: 50, flat: 1500 }, { to: null, rate: 25 }] },
          },
        ],
      },
    ],
  },
);

// ── A whole deal, end to end ─────────────────────────────────────────────────
add(
  'full-enterprise-deal',
  'Enterprise suite, three years, services, credits and a negotiated discount',
  quote({
    users: 3200,
    processes: 180,
    years: 3,
    disc: 12,
    setupDisc: 50,
    packs: picked('suite_p'),
    setup: { onb_ent: true, ats: true, integ: true, integ_q: 2, cert: true, cert_q: 5, consult: true, consult_q: 40 },
    yearly: { academy: true, academy_q: 10, csm: true, support: true, maint: true },
    ai: { ai_50: 2 },
  }),
);

export default scenarios;
