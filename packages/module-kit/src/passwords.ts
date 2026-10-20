import { ModuleContractError } from './contract.ts';
import { namespaceOf } from './manifest.ts';

/**
 * Password verifier contract (extension point 19; file `passwords.ts`).
 *
 * The core hashes with Argon2id and also verifies bcrypt. A module that brings users over from
 * another system — with that system's hashes copied verbatim — declares here how to check those
 * hashes, so the users can sign in with the password they already have. The core:
 *   - asks a verifier only for a stored hash that is neither Argon2 nor bcrypt, and only when
 *     the verifier's `matches` says the format is its own (first match wins, in module order);
 *   - skips verifiers of a module that is switched off;
 *   - rehashes the account to Argon2id on the next successful login, so the foreign hash is gone
 *     after one sign-in and the verifier can be retired once every imported user has signed in.
 *
 * A verifier is pure code: no database, no network, no state. A wrong password answers `false`;
 * an exception counts as `false` too.
 */
export interface PasswordVerifierDef {
  /** `<ns>.<name>`, e.g. `legacy.wordpress`. */
  readonly name: string;
  /** Does this verifier understand the hash? Keep it cheap — usually a prefix check. */
  readonly matches: (hash: string) => boolean;
  readonly verify: (plain: string, hash: string) => boolean | Promise<boolean>;
}

const NAME_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;

/** Declare a module's password verifiers (`passwords.ts`). Names must carry the module namespace. */
export function definePasswordVerifiers(
  moduleName: string,
  verifiers: readonly PasswordVerifierDef[],
): readonly PasswordVerifierDef[] {
  const ns = namespaceOf(moduleName);
  const seen = new Set<string>();
  for (const v of verifiers) {
    if (!NAME_RE.test(v.name))
      throw new ModuleContractError(`nama verifikator sandi "${v.name}" tidak valid`);
    if (!v.name.startsWith(`${ns}.`))
      throw new ModuleContractError(`nama verifikator sandi "${v.name}" harus diawali "${ns}."`);
    if (seen.has(v.name)) throw new ModuleContractError(`verifikator sandi "${v.name}" duplikat`);
    seen.add(v.name);
    if (typeof v.matches !== 'function' || typeof v.verify !== 'function')
      throw new ModuleContractError(
        `verifikator sandi "${v.name}": matches dan verify harus fungsi`,
      );
  }
  return verifiers;
}
