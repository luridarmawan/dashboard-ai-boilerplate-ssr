/**
 * UUIDv7 (RFC 9562) — THE ONLY ID generator in the whole application (O-6, §4.3.1).
 *
 * There is no `DEFAULT (UUID())` in DDL and no local generator in modules; changing the
 * ID strategy later means editing this file alone. Column width (`char(36)` / `uuid`) is
 * neutral to the UUID version, so the schema does not change with it.
 *
 * 128-bit layout:
 *   unix_ts_ms (48) | ver=7 (4) | rand_a (12) | var=10 (2) | rand_b (62)
 *
 * Monotonic within the same millisecond via the RFC 9562 §6.2 counter method: rand_a is
 * used as a 12-bit counter, seeded randomly with its top bit clear (leaving 2048
 * increments of headroom per ms). On counter overflow the timestamp borrows 1 ms from
 * the future. If the clock goes backwards the last timestamp is kept — IDs stay ordered,
 * merely slightly "ahead" of wall-clock until it catches up. Cursor pagination (N-5)
 * relies on this property.
 */

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export interface UuidV7Options {
  /** Time source in Unix ms. Overridden only in tests. */
  readonly now?: () => number;
  /** Random byte source. Overridden only in tests. */
  readonly random?: (n: number) => Uint8Array;
}

const defaultRandom = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/**
 * Creates a generator with its own monotonic state. The application uses the ready-made
 * `newId()` below; this is exported so the monotonic property can be tested with a
 * controlled clock.
 */
export function createUuidV7Generator(opts: UuidV7Options = {}): () => string {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? defaultRandom;

  let lastMs = -1;
  let seq = 0;

  const seedSeq = (): number => {
    const r = random(2);
    return (((r[0] ?? 0) << 8) | (r[1] ?? 0)) & 0x7ff; // top bit clear → increment headroom
  };

  return function newId(): string {
    let ms = now();

    if (ms <= lastMs) {
      // Same millisecond, or clock went backwards: keep counting on the last timestamp.
      ms = lastMs;
      seq += 1;
      if (seq > 0xfff) {
        // Overflow (>4096 IDs/ms): borrow 1 ms from the future and reseed.
        lastMs += 1;
        ms = lastMs;
        seq = seedSeq();
      }
    } else {
      lastMs = ms;
      seq = seedSeq();
    }

    const b = new Uint8Array(16);
    // 48-bit timestamp, big-endian. Top two bytes via division since the value exceeds 32 bits.
    b[0] = Math.floor(ms / 2 ** 40) & 0xff;
    b[1] = Math.floor(ms / 2 ** 32) & 0xff;
    b[2] = (ms >>> 24) & 0xff;
    b[3] = (ms >>> 16) & 0xff;
    b[4] = (ms >>> 8) & 0xff;
    b[5] = ms & 0xff;

    b[6] = 0x70 | ((seq >>> 8) & 0x0f); // version 7 + top 4 bits of the counter
    b[7] = seq & 0xff; //                   low 8 bits of the counter

    const r = random(8);
    b[8] = 0x80 | ((r[0] ?? 0) & 0x3f); // variant 10xx
    for (let i = 1; i < 8; i++) b[8 + i] = r[i] ?? 0;

    return format(b);
  };
}

function format(b: Uint8Array): string {
  const h = (i: number): string => HEX[b[i] ?? 0] ?? '00';
  return (
    h(0) +
    h(1) +
    h(2) +
    h(3) +
    '-' +
    h(4) +
    h(5) +
    '-' +
    h(6) +
    h(7) +
    '-' +
    h(8) +
    h(9) +
    '-' +
    h(10) +
    h(11) +
    h(12) +
    h(13) +
    h(14) +
    h(15)
  );
}

/** The application's default generator. Core and modules use THIS — never their own. */
export const newId: () => string = createUuidV7Generator();

export function isUuidV7(value: string): boolean {
  return UUID_V7_RE.test(value);
}

/** Recover the timestamp (Unix ms) from a UUIDv7. Useful for cursors and forensics. */
export function uuidV7Time(id: string): number {
  if (!isUuidV7(id)) throw new TypeError(`bukan UUIDv7: ${id}`);
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
