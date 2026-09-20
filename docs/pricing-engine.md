# The pricing engine

Phases 0 and 1 of `docs/quote-builder-architecture.md`, done.

The pricing rules used to exist in exactly one place — untested, inside a
6 840-line HTML file emailed around as v137. They now exist as a tested
TypeScript library with the prototype as its acceptance test.

## What is here

| Path | What it is |
|---|---|
| `prototypes/talent_suite_pricing_v137.html` | The prototype. The reference, not a dependency. |
| `tools/scenarios.mjs` | 73 scenarios across the interesting boundaries. |
| `tools/capture-fixtures.mjs` | Runs them through the prototype's own `calc()`. |
| `packages/pricing/test/fixtures/` | The answers. Generated; never hand-edited. |
| `packages/pricing/data/price-book.v137.json` | v137's `SEED`, captured verbatim. Data, not source. |
| `packages/pricing/src/` | The engine, ported. Pure: no DOM, no I/O, no globals. |
| `tools/mutation-check.mjs` | Ten deliberate breakages the suite must catch. |

## Running it

```bash
pnpm install
pnpm exec playwright install chromium   # only needed for capture

pnpm test            # 108 tests, with the coverage gate
pnpm typecheck
pnpm capture         # re-capture fixtures from the prototype
pnpm capture:check   # fail if any fixture has drifted (CI runs this)
pnpm mutants         # prove the suite still discriminates
pnpm verify          # typecheck + test
```

## Using it

```ts
import { computeQuote } from '@assessio/pricing';
import book from '@assessio/pricing/price-book.v137.json';

const result = computeQuote(book, {
  users: 600, processes: 14, years: 3,
  packs: { suite_p: true },
  setup: {}, yearly: {}, ai: {},
  disc: 10, setupDisc: 0,
});

result.arr;   // annual recurring revenue, in euros
result.tcv;   // total contract value over the term
```

## Three things the code depends on

**Every amount is in euros.** The display currency is a formatting concern and
never reaches the engine. This is not an assumption — `capture-fixtures.mjs`
re-prices every scenario in SEK, NOK and DKK on every run and fails if any of
them differs.

**The engine is pure.** No DOM, no I/O, no clock, no module-level mutable
state. Everything the prototype read off the globals `M` and `S` is an argument.
That is what lets the same code run in the browser for instant feedback and on
the server for the number that is actually quoted.

**The arithmetic is in v137's order, float noise and all.** `14904.955000000002`
is in a fixture because that is what the prototype produces. A tidier expression
that rounds differently is a pricing change, and a pricing change needs a
decision from Finance before it needs a commit.

## What the port did not change

Nothing. It is a port. Three things it preserves that look like bugs and are
not — each one is deliberate in the prototype and commented there:

- **The per-employee rate is what the total is rebuilt from.** `perEmp` is
  rounded to two decimals and multiplied back up, so the quoted rate and the
  quoted total agree on the page. `raw` keeps the unrounded figure.
- **Cheap modules do not count toward the discount grid.** A module counts only
  while it is worth more than the discount step it would trigger — otherwise
  adding a cheap module deepens the discount on everything and the total goes
  down. `countingTiers` reports which ones were skipped.
- **A fee whose module was unticked falls away silently**, rather than being
  charged for something the customer is not buying.

Two branches of the engine are live code that v137's own price book never
reaches: recurring fees inside the set-up list, and a usage ladder on a module
that is not predictive hiring. Both are covered by scenarios that supply a price
book with those shapes, captured from the prototype in the same way.

## What is not here yet

Phase 1 is the library. Still to come, in the architecture doc's order:

- the price book as versioned rows with an effective date, not a single JSON
  file — a quote issued in March must re-render identically in November;
- money as integer minor units with a documented rounding point, so a quote
  cannot disagree with the Zuora invoice by an öre;
- Zod schemas, so a price book is validated before it can price anything;
- Phase 2, the builder UI.

The first two are the ones that matter before anything is issued to a customer.
