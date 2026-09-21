import { describe, expect, test } from 'bun:test';
import { isUndeliverableEmail, UNDELIVERABLE_EMAIL_SUFFIXES } from '../src/index.ts';

/**
 * The reserved TLDs (RFC 2606) a "send them a reset link" button must not offer for: seed and
 * fixture accounts live there and the mail would only bounce.
 */
describe('isUndeliverableEmail', () => {
  test('the reserved suffixes are exactly .invalid and .test', () => {
    expect([...UNDELIVERABLE_EMAIL_SUFFIXES].sort()).toEqual(['.invalid', '.test']);
  });

  test('refuses .test and .invalid regardless of case, whitespace or subdomain depth', () => {
    expect(isUndeliverableEmail('admin@example.test')).toBe(true);
    expect(isUndeliverableEmail('  Someone@Local.INVALID ')).toBe(true);
    expect(isUndeliverableEmail('a@deep.sub.domain.test')).toBe(true);
  });

  test('accepts ordinary domains, including ones that merely contain the words', () => {
    expect(isUndeliverableEmail('it@qhomemart.id')).toBe(false);
    expect(isUndeliverableEmail('x@example.com')).toBe(false);
    expect(isUndeliverableEmail('x@test.example.com')).toBe(false);
    expect(isUndeliverableEmail('x@invalid.example.org')).toBe(false);
    expect(isUndeliverableEmail('x@testing.io')).toBe(false);
  });

  test('a string without an @ is judged by its whole text as a domain', () => {
    expect(isUndeliverableEmail('example.test')).toBe(true);
    expect(isUndeliverableEmail('')).toBe(false);
  });
});
