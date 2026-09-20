/**
 * Does the golden suite actually discriminate?
 *
 * A suite that passes is not evidence of anything until you have seen it fail
 * for the right reason. This breaks the engine in ten specific ways — each one
 * a mistake a port could plausibly make — and requires every one to be caught.
 *
 * A survivor is either a gap in the fixtures or an equivalent mutation. Both
 * are worth knowing; neither is resolved by deleting the mutant.
 *
 *   node tools/mutation-check.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = join(root, 'packages/pricing');

/** [name, file, what it currently says, what the mutant makes it say] */
const MUTANTS = [
  ['per-employee rate no longer rounded', 'src/engine.ts', 'Math.round((raw / employees) * 100) / 100', 'raw / employees'],
  ['additive discounts no longer capped at 100%', 'src/compute.ts', 'Math.min(100, packPct + engPct + discPct)', 'packPct + engPct + discPct'],
  ['suite bonus dropped', 'src/engine.ts', 'const bonus = book.suiteBonusPct || 0;', 'const bonus = 0;'],
  ['every module counts toward the discount grid', 'src/engine.ts', 'if (l.annual >= bar) count++;', 'if (true) count++;'],
  ['recruitment ladder no longer rounded', 'src/engine.ts', 'return Math.round(t);', 'return t;'],
  ['band ladder keeps walking past its end', 'src/engine.ts', 'if (qty <= prev) break;', 'if (false) break;'],
  ['headcount no longer clamped to one', 'src/compute.ts', 'const users = Math.max(1, toInt(input.users));', 'const users = toInt(input.users);'],
  ['threshold fee steps one employee late', 'src/compute.ts', 'const hi = input.users >= x.threshold;', 'const hi = input.users > x.threshold;'],
  ['AI credit quantity ignored', 'src/compute.ts', 'amt: a.price * q', 'amt: a.price'],
  ['a quantity of zero is still charged', 'src/compute.ts', 'if (q === 0) return; // nothing ordered', 'if (false) return; // nothing ordered'],
  ['a published price book is no longer frozen', 'src/version.ts', 'const frozenBook = deepFreeze(structuredClone(book));', 'const frozenBook = structuredClone(book);'],
  ['a price book version can be relabelled after the fact', 'src/version.ts', 'return Object.freeze({', 'return ({'],
  ['deepFreeze stops at the top level', 'src/version.ts', 'deepFreeze((value as Record<string, unknown>)[key]);', 'void key;'],
  ['two price books may be in force at once', 'src/version.ts', 'this.refuseOverlaps();', ''],
  ['a price book window includes its end date', 'src/version.ts', 'return v.effectiveTo === null || at < time(v.effectiveTo, v.id);', 'return v.effectiveTo === null || at <= time(v.effectiveTo, v.id);'],
  ['a quote may be issued from a draft', 'src/issue.ts', "if (version.status !== 'published') {", 'if (false) {'],
  ['an edited price book goes unnoticed', 'src/issue.ts', 'if (version.fingerprint !== issued.priceBookFingerprint) {', 'if (false) {'],
  ['a re-render trusts the stored numbers', 'src/issue.ts', 'if (drift.length > 0) {', 'if (false) {'],
  ['an issued quote keeps a live reference to its input', 'src/issue.ts', 'input: structuredClone(request.input),', 'input: request.input,'],
];

const suitePasses = () => {
  try {
    execFileSync('npx', ['vitest', 'run'], { cwd: pkg, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

if (!suitePasses()) {
  console.error('The suite is already red. Fix that before asking whether it discriminates.');
  process.exit(1);
}

const survivors = [];
for (const [name, file, from, to] of MUTANTS) {
  const path = join(pkg, file);
  const original = readFileSync(path, 'utf8');
  if (!original.includes(from)) {
    console.error(`Mutant "${name}" no longer applies — ${file} has moved on. Update the mutant.`);
    process.exit(1);
  }
  try {
    writeFileSync(path, original.replace(from, to));
    const caught = !suitePasses();
    console.log(`${caught ? 'caught  ' : 'SURVIVED'}  ${name}`);
    if (!caught) survivors.push(name);
  } finally {
    writeFileSync(path, original);
  }
}

if (survivors.length) {
  console.error(`\n${survivors.length} mutant(s) survived. The suite does not cover:\n  ${survivors.join('\n  ')}`);
  process.exit(1);
}
console.log(`\nAll ${MUTANTS.length} mutants caught.`);
