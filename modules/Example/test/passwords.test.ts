import { describe, expect, test } from 'bun:test';
import verifiers, { phpassCheck, wordpressBcryptCheck } from '../passwords.ts';

/** Generated with WordPress' own code (class-phpass.php and wp_hash_password()). */
const PASSWORD = 'correct horse battery';
const PHPASS = '$P$BprJqFYnPJNMjpdYJ6tvuG/s0MLJ9/.';
const WP_BCRYPT = '$wp$2y$10$1kfjoKsFgIOv40pHkJeDXO3TtRNjnSeI2uuNeeG.IhYHGnAA3SMVq';

describe('WordPress password verifier (extension point 19)', () => {
  test('phpass portable hashes', () => {
    expect(phpassCheck(PASSWORD, PHPASS)).toBe(true);
    expect(phpassCheck('wrong password', PHPASS)).toBe(false);
    expect(phpassCheck(PASSWORD, `${PHPASS.slice(0, -1)}x`)).toBe(false);
    expect(phpassCheck(PASSWORD, '$P$short')).toBe(false);
  });

  test('WordPress 6.8 bcrypt hashes', async () => {
    expect(await wordpressBcryptCheck(PASSWORD, WP_BCRYPT)).toBe(true);
    expect(await wordpressBcryptCheck('wrong password', WP_BCRYPT)).toBe(false);
  });

  test('the declared verifier claims both formats and nothing else', async () => {
    const [v] = verifiers;
    expect(v?.name).toBe('example.wordpress');
    expect(v?.matches(PHPASS)).toBe(true);
    expect(v?.matches(WP_BCRYPT)).toBe(true);
    expect(v?.matches('$2y$10$plainbcrypt')).toBe(false);
    expect(v?.matches('$argon2id$v=19$m=19456,t=2,p=1$x')).toBe(false);
    expect(await v?.verify(PASSWORD, PHPASS)).toBe(true);
    expect(await v?.verify(PASSWORD, WP_BCRYPT)).toBe(true);
  });
});
