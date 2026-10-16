/**
 * Derives a machine code (`^[a-z][a-z0-9_-]*$`) from a human name, for the forms that offer
 * "leave the code empty and we fill it from the name". Dependency-free on purpose: the web
 * imports it from `@core/contracts/code` into the browser bundle, where TypeBox has no place.
 *
 *   "PT. Maju Jaya"  → "pt_maju_jaya"
 *   "  Café 24/7 "   → "caf_24_7"
 *   "2nd Floor"      → "2nd_floor" is not a valid code (must start with a letter) → "t_2nd_floor"
 *
 * Lower-cases, turns every run of characters outside `a-z0-9` into one `_`, trims the `_` at
 * both ends, prefixes `t_` when the result does not start with a letter, and cuts to `max`.
 * Returns '' when nothing usable is left, so the caller can ask for a code instead of guessing.
 */
export function codeFromName(name: string, max = 32): string {
  let code = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!code) return '';
  if (!/^[a-z]/.test(code)) code = `t_${code}`;
  return code.slice(0, max).replace(/_+$/, '');
}
