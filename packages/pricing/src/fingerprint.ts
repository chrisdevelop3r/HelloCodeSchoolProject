/**
 * A stable fingerprint of a price book.
 *
 * Used to detect that a published price book has been changed since a quote
 * was issued from it. Two books with the same content fingerprint the same,
 * whatever order their keys happen to be in.
 *
 * **This is drift detection, not tamper protection.** It is a plain hash with
 * no secret in it, so anyone who can edit a book can also edit the recorded
 * fingerprint. It catches the failure that actually happens — someone edits a
 * published book and quotes issued last quarter quietly start re-rendering at
 * this quarter's prices — and it does not pretend to catch an attacker.
 * Signing belongs server-side, where there is a key to sign with.
 *
 * Deliberately pure TypeScript rather than `node:crypto`, because the engine
 * runs in the browser as well as on the server.
 */

/**
 * JSON with object keys in a fixed order, so reformatting a file cannot change
 * its fingerprint and reordering two fields cannot hide a change.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` is absent from JSON, so it must not contribute here either —
    // otherwise `{ a: undefined }` and `{}` would fingerprint differently while
    // serialising identically.
    .filter(([, v]) => v !== undefined)
    // Object keys are unique, so there is no equal case to handle.
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

const FNV_OFFSET_BASIS = 0xcbf2_9ce4_8422_2325n;
const FNV_PRIME = 0x0000_0100_0000_01b3n;
const SIXTY_FOUR_BITS = 0xffff_ffff_ffff_ffffn;

/**
 * FNV-1a, 64-bit, over the canonical JSON, as 16 hex characters.
 *
 * BigInt rather than 32-bit halves: a price book is hashed once when it is
 * loaded, so clarity is worth more here than speed, and the half-word version
 * of this is easy to get subtly wrong.
 */
export function fingerprint(value: unknown): string {
  const text = canonicalJson(value);
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & SIXTY_FOUR_BITS;
  }
  return hash.toString(16).padStart(16, '0');
}
