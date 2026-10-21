import { type LegacyPasswordVerifier, verifyPassword } from '@core/auth';
import { modulePasswordVerifiers } from './generated/modules.ts';
import { moduleState } from './services.ts';

/**
 * Password checks for the API: the core formats (Argon2, bcrypt) plus the verifiers modules
 * declare in `passwords.ts` (extension point 19) for hashes imported from other systems. Only the
 * verifiers of modules that are switched on count, and they are looked up only when a stored hash
 * is in a foreign format.
 */
async function activeVerifiers(): Promise<readonly LegacyPasswordVerifier[]> {
  const declared: readonly { module: string; verifiers: readonly LegacyPasswordVerifier[] }[] =
    modulePasswordVerifiers;
  if (!declared.length) return [];
  const enabled = await moduleState.enabledFor(null);
  return declared.filter((m) => enabled.has(m.module)).flatMap((m) => m.verifiers);
}

export function checkPassword(plain: string, hash: string | null): Promise<boolean> {
  return verifyPassword(plain, hash, activeVerifiers);
}
