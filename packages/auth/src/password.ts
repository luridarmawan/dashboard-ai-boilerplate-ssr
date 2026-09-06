/**
 * Password hashing (PRD A-1): Argon2id via Bun's built-in implementation. Parameters follow the
 * OWASP minimum (m=19 MiB, t=2, p=1); `needsRehash` lets a later cost increase migrate hashes on
 * the next successful login instead of forcing a reset.
 */
const ARGON2 = { algorithm: 'argon2id', memoryCost: 19_456, timeCost: 2 } as const;

export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, ARGON2);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    // Constant-ish time for accounts without a password (OAuth-only) — do not reveal that.
    await Bun.password.hash(plain, ARGON2);
    return false;
  }
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  return (
    !hash.startsWith('$argon2id$') || !hash.includes(`m=${ARGON2.memoryCost},t=${ARGON2.timeCost}`)
  );
}

/** Minimum policy (kept deliberately simple; length beats complexity rules). */
export function passwordProblems(plain: string): string[] {
  const p: string[] = [];
  if (plain.length < 10) p.push('minimal 10 karakter');
  if (plain.length > 256) p.push('maksimal 256 karakter');
  if (/^\s|\s$/.test(plain)) p.push('tidak boleh diawali/diakhiri spasi');
  return p;
}
