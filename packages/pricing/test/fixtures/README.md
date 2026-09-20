# Golden fixtures

Generated. Do not edit.

Every file here is the prototype's own answer to one scenario, captured by
`tools/capture-fixtures.mjs` from `prototypes/talent_suite_pricing_v137.html`.
CI re-runs the capture and fails on any difference, so a hand-edit is a build
break.

To add a case, add a scenario to `tools/scenarios.mjs` and run `pnpm capture`.

If a fixture disagrees with the engine, one of two things is true:

- the engine is wrong — fix the engine; or
- the pricing has deliberately changed — then the change needs a decision from
  Finance recorded first, and the fixtures are re-captured from a new prototype
  version, not patched to agree.

A fixture edited to make a test pass is worse than no fixture, because it still
looks like a safety net.
