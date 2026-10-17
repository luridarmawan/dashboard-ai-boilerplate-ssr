import { describe, expect, test } from 'bun:test';
import { isUniqueViolation } from '../src/transaction.ts';

describe('isUniqueViolation', () => {
  test('recognises each dialect, also when wrapped as a cause', () => {
    expect(isUniqueViolation({ code: 'ER_DUP_ENTRY', errno: 1062 })).toBe(true);
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(true);
    expect(isUniqueViolation(new Error('query failed', { cause: { code: 'ER_DUP_ENTRY' } }))).toBe(
      true,
    );
    expect(isUniqueViolation(new Error('timeout'))).toBe(false);
    expect(isUniqueViolation({ code: 'ER_LOCK_DEADLOCK' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
