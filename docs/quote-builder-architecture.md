# Quote Builder — from prototype to product

Reference prototype: `prototypes/talent_suite_pricing_v137.html` (v137, 6 840 lines, 520 KB).

---

## 1. What the prototype actually is

| Part | Lines | Verdict |
|---|---|---|
| `<style>` block 1 (app shell, design tokens) | 10–3 665 | **Keep the tokens, rewrite the rules** |
| HTML markup (topbar, tabs, panels) | 3 666–3 841 | Throw away — it is render targets, not structure |
| `<script>` — `SEED` price book | 3 847–4 060 | **Becomes versioned data in a database** |
| `<script>` — pricing engine (`bandTotal`, `tieredTotal`, discounts, FX) | 4 090–~4 600 | **The crown jewels. Extract first, change last.** |
| `<script>` — renderers (`renderV2`, `renderV3`, `v3*`, DOM wiring) | ~4 600–6 838 | Rewrite as components |
| `<style>` block 2 + `q3CSS()` (the generated quote document) | 5 943–5 977 | **Becomes a server-rendered PDF template** |

Properties that decide the migration:

- **No persistence at all.** State lives in two module-level variables, `M` (the live price book)
  and `S` (the current quote). A browser refresh loses the quote. There is no `localStorage`,
  no `fetch`, no server.
- **No identity.** No users, no teams, no "who quoted this".
- **Export is client-side `Blob` downloads** — JSON, CSV, and a self-contained HTML quote
  document opened via `URL.createObjectURL`. The "Accept this proposal" button is an `alert()`.
- **Two builder generations ship side by side** (`Builder v1` and `Builder v2`, plus `renderV2Light`
  and the whole `v3*` family). Roughly a third of the JavaScript is superseded UI kept for comparison.
- **The pricing rules are genuinely non-trivial**: graduated tier ladders with a flat first band,
  a power-curve band ladder for Predictive Hiring (`price = a × recruitments^exp`), module-count
  discounts, engagement (multi-year) discounts with a configurable `additive` vs `sequential`
  stacking mode, headcount→segment bracketing, a headcount→recruitment interpolation curve,
  and four currencies off hardcoded FX rates.

That last point is the whole reason this is worth building properly. The UI is replaceable;
the pricing logic is the institutional asset, and it currently exists in exactly one place,
untested, inside a file that is emailed around as v137.

---

## 2. Target architecture

```
apps/
  web/            Next.js (App Router) + TypeScript + React   — the builder UI
  api/            (optional split; start inside apps/web route handlers)
packages/
  pricing/        Pure TS. No DOM, no I/O. The extracted engine.
  pricing-schema/ Zod schemas for the price book + quote input/output
  ui/             Design-token-driven components
services/
  pdf/            Chromium (Playwright) renders the quote HTML → PDF
```

**Stack recommendation** (opinionated, pick-and-move-on):

- **Next.js + TypeScript** — one deployable, server components for the read-heavy price book,
  route handlers for the API. You do not need a separate backend service on day one.
- **PostgreSQL + Prisma** (or Drizzle) — quotes, price-book versions, users, audit log.
- **Zod** — one schema, validated on both sides of the wire.
- **Vitest** for the engine, **Playwright** for the builder flow.
- **SSO via your existing IdP** (Entra ID / Okta) — this is internal sales tooling, do not
  build password auth.
- **PDF via Playwright**, not a JS PDF library. `q3QuoteHTML()` already produces a complete
  standalone document; print it. You keep pixel parity with what sales already approved.

### The three rules that matter more than the stack

**1. The server owns the price.** The client may recompute for instant feedback, but the number
on the quote is computed server-side and persisted. Otherwise anyone with devtools can quote
anything. Same engine package, imported in both places — that is the point of extracting it
as a pure library.

**2. A quote is immutable once issued.** Store, on every quote:
inputs (headcount, modules, term, currency), the **price-book version id**, the **locked FX rate**,
and the computed line items. A quote sent in March must re-render identically in November after
the price book has changed three times. The prototype cannot do this — `M` is mutable global state
and the "levers" edit it live.

**3. Money is integer minor units.** The seed rates (`38.3206`, `2.4257`) are fine as *inputs*,
but every total must be computed in a decimal type or integer öre/cents with an explicit,
documented rounding point. A quote that disagrees with the Zuora invoice by one öre becomes
a real customer conversation.

---

## 3. Migration plan

### Phase 0 — Golden tests (do this before touching anything)

Before any refactor, freeze the prototype's current behaviour:

1. Open v137, enumerate ~40 scenarios across the interesting boundaries — headcount at
   100/101/250/1000/2500/5000, 1–6 modules, 1–5 year terms, all four currencies,
   suite vs à la carte, PH bands on and off, both discount stacking modes.
2. For each, capture inputs → full output (ARR, MRR, TCV, per-line amounts) as JSON fixtures.
3. Those fixtures are the acceptance test for the extracted engine.

**This phase is the load-bearing one.** Without it every later refactor is a guess, and — see
§4 — an agent loop has nothing objective to converge on.

### Phase 1 — Extract `packages/pricing`

Lift `bandTotal`, `tieredTotal`, `tieredTotalAt`, `segmentFor`, the PH band ladder, the discount
stacking and the FX conversion into pure TypeScript functions. Signature shape:

```ts
computeQuote(priceBook: PriceBook, input: QuoteInput): QuoteResult
```

No `document`, no globals, no `M`. Run the Phase 0 fixtures. Green means the maths survived.

At the same time, move `SEED` out of code into `price-book.v1.json` validated by a Zod schema.
The price book stops being a source file and becomes data with an effective date.

### Phase 2 — Frontend

Rebuild **Builder v2 only** — delete v1 and the comparison renderers. The CSS custom properties
at the top of the file (`--ink`, `--accent`, `--paper`, `--r`, `--shadow`…) are already a design
system; port them to CSS Modules or Tailwind theme tokens and keep the visual language exactly.
The quote document template (`q3CSS` + `q3QuoteHTML`) moves to the PDF service largely as-is.

### Phase 3 — Backend

- `POST /api/quotes` → validate, compute server-side, persist, return id
- `GET /api/quotes/:id` → re-render from the stored snapshot
- `GET /api/price-book/current` → the active version
- **Approval workflow**: discount above a threshold sets `status: pending_approval` and notifies
  a manager. This is the feature that turns a calculator into a system of record.
- **Audit log**: who changed which lever, when, on which quote.
- Deal room: replace the `alert()` with a signed public URL + e-signature provider webhook.

### Phase 4 — Integrations

CRM (quote attaches to an opportunity), Zuora (the tier ladders already map to Zuora Tiered
Pricing — the comments in the prototype say so), e-sign.

### Suggested sequencing

| Phase | Rough effort | Ships what |
|---|---|---|
| 0 Golden tests | 1–2 days | Safety net |
| 1 Engine extraction | 3–5 days | Tested, reusable pricing library |
| 2 Frontend rebuild | 2–3 weeks | The builder, as a real app |
| 3 Backend + auth + PDF | 2–3 weeks | Saved quotes, approvals, audit |
| 4 Integrations | ongoing | CRM / Zuora / e-sign |

Phases 0–1 are worth doing even if the rest is postponed indefinitely. A tested pricing library
is valuable on its own; a 6 800-line HTML file is not.

---

## 4. Multi-agent development loop

The four-role setup (architect / developer / tester / manager) is real and works, with one
condition covered at the end of this section.

### Option A — Subagents (start here)

Committed to the repo as `.claude/agents/*.md`, one file per role:

```markdown
---
name: pricing-tester
description: Writes and runs tests for the pricing engine. Use after any change to packages/pricing.
tools: Read, Glob, Grep, Bash, Write, Edit
model: sonnet
---
You are a test engineer. Every pricing change must be covered by a golden-fixture
test before it is considered done. Never weaken or delete a failing assertion to
get green — report the failure instead.
```

Each subagent gets its own context window and reports back to the main session. Lowest cost,
no configuration beyond the files, and the role definitions are version-controlled alongside
the code.

### Option B — Agent teams (the literal four-colleagues version)

Experimental, off by default. Enable with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in
`settings.json`. Teammates are full independent Claude Code sessions that share a task list
and **message each other directly** rather than only reporting to a lead. Costs materially
more tokens — each teammate is a separate session with its own context.

Worth it for: parallel review, competing-hypothesis debugging, cross-layer work where frontend,
backend and tests are owned by different teammates. Not worth it for sequential work or edits
to the same files.

Docs recommend 3–5 teammates, and the same subagent definition files can be reused as teammate
roles.

### Option C — `/loop`

Runs a prompt or slash command on a schedule, or self-paced. Useful for the outer loop:
"run the test suite, fix what is red, stop when green".

### The condition — and it is the whole game

An agent loop makes the product better **only when it terminates on a gate the agents cannot
argue with.** Left to review each other's prose, LLM agents converge on *agreement*, not on
*correctness*: the tester says it looks good, the manager says ship it, and nothing improved.

So the loop must close on machine-checkable facts:

- `vitest run` — the Phase 0 golden fixtures, green
- `tsc --noEmit` — clean
- `playwright test` — the builder flow, green
- a coverage floor on `packages/pricing`

Which is why **Phase 0 is the prerequisite for Phase 4 being worth anything.** Build the golden
fixtures first, then point the agent team at them. Enforce it mechanically with a `TeammateIdle`
hook that exits with code 2 when the suite is red — the teammate is not allowed to go idle on
a failing build.

Two practical guards, both learned the hard way:

- **Give each agent a different set of files.** Two agents editing the same file overwrite
  each other.
- **Never let an agent "fix" a test by weakening it.** Put it in the role prompt, and review
  test diffs like production code. A pricing suite that was edited to pass is worse than no
  suite, because it looks like a safety net.

---

## 5. Recommendation

Do Phase 0 and Phase 1 this week, by hand or with a single agent — they are small, and they are
what makes everything after them verifiable. Spin up the four-role team at Phase 2, when there
is a green suite for it to defend and enough parallel surface (components, API, tests) for
three or four agents to work without colliding.
