import { describe, expect, test } from 'bun:test';
import { clientIpFromForwarded, isPrivateAddress } from '../src/index.ts';

/**
 * The client IP behind NAT / proxy chains (note.txt issue: "Last Active IP" showed the LAN
 * address of the front proxy instead of the visitor). Rightmost public entry wins; an all-private
 * chain falls back to the leftmost entry; no header at all falls back to the socket address.
 */
describe('clientIpFromForwarded', () => {
  test('a single public hop is the client', () => {
    expect(clientIpFromForwarded('203.0.113.7')).toBe('203.0.113.7');
  });

  test('skips the private addresses proxies and NAT hops append on the right', () => {
    // visitor → perimeter proxy (LAN) → Apache on the host → gateway
    expect(clientIpFromForwarded('203.0.113.7, 192.168.1.10, 127.0.0.1')).toBe('203.0.113.7');
    expect(clientIpFromForwarded('203.0.113.7,10.0.0.5')).toBe('203.0.113.7');
    expect(clientIpFromForwarded('203.0.113.7, 172.18.0.3')).toBe('203.0.113.7');
    expect(clientIpFromForwarded('203.0.113.7, 100.64.0.9')).toBe('203.0.113.7');
    expect(clientIpFromForwarded('2001:db8::1, fd00::1, ::1')).toBe('2001:db8::1');
  });

  test('a spoofed header is beaten by the address the outermost proxy appended', () => {
    // The browser sent "X-Forwarded-For: 8.8.8.8"; the proxy appended what it really saw.
    expect(clientIpFromForwarded('8.8.8.8, 203.0.113.7, 10.0.0.5')).toBe('203.0.113.7');
  });

  test('an all-private chain (LAN visitor, tests) keeps the leftmost entry', () => {
    expect(clientIpFromForwarded('192.168.1.50, 192.168.1.1')).toBe('192.168.1.50');
    expect(clientIpFromForwarded('10.99.1.2')).toBe('10.99.1.2');
    expect(clientIpFromForwarded('127.0.0.1')).toBe('127.0.0.1');
  });

  test('ports and IPv4-mapped IPv6 are normalised', () => {
    expect(clientIpFromForwarded('203.0.113.7:51234, 10.0.0.1')).toBe('203.0.113.7');
    expect(clientIpFromForwarded('[2001:db8::1]:443, 10.0.0.1')).toBe('2001:db8::1');
    expect(clientIpFromForwarded('::ffff:10.0.0.1, 203.0.113.7')).toBe('203.0.113.7');
    expect(clientIpFromForwarded('::ffff:203.0.113.7, ::ffff:10.0.0.1')).toBe('::ffff:203.0.113.7');
  });

  test('without a header the socket address is used; nothing at all is null', () => {
    expect(clientIpFromForwarded(null, '172.18.0.2')).toBe('172.18.0.2');
    expect(clientIpFromForwarded('', '203.0.113.7')).toBe('203.0.113.7');
    expect(clientIpFromForwarded(' , ', null)).toBeNull();
    expect(clientIpFromForwarded(undefined)).toBeNull();
  });

  test('garbage and "unknown" entries never count as the visitor', () => {
    expect(clientIpFromForwarded('unknown, 203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
    expect(clientIpFromForwarded('evil.example, 10.0.0.1')).toBe('evil.example');
    expect(isPrivateAddress('unknown')).toBe(true);
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('isPrivateAddress', () => {
  test('RFC 1918, loopback, link-local, CGNAT and IPv6 ULA/link-local are private', () => {
    for (const ip of [
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '127.0.0.1',
      '169.254.1.1',
      '100.64.0.1',
      '100.127.255.255',
      '0.0.0.0',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  test('public addresses are not', () => {
    for (const ip of [
      '203.0.113.7',
      '8.8.8.8',
      '172.32.0.1',
      '172.15.0.1',
      '100.128.0.1',
      '2001:db8::1',
    ]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});
