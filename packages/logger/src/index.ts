/**
 * The logger (PRD M-1, M-7). One JSON line per event, with the request id where there is one.
 * Masking is INSIDE the logger, not at call sites: any field whose name looks sensitive
 * (password, token, secret, api key, authorization, cookie, session…) is replaced by `***`,
 * recursively, and long bearer/cookie-looking strings inside values are masked too. A call site
 * that forgets to redact therefore still cannot leak; that is the point of P0-with-M-1.
 */
export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  readonly requestId?: string | null;
  readonly [k: string]: unknown;
}

const SENSITIVE_KEY =
  /(pass(word|wd)?|secret|token|api[-_]?key|authorization|cookie|session|credential|private[-_]?key|otp|pin|ssn|card[-_]?number|cvv|x-csrf-token|set-cookie|hash)/i;
/** Key names that only LOOK sensitive but are safe identifiers we want to keep. */
const ALLOW_KEY =
  /^(token_type|hasPassword|password_changed_at|requestId|sessionId|tokenId|session_count|hash_algo)$/;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const COOKIE_PAIR_RE = /\b(crk_session|crk_csrf|sessionid|sid|jwt)=([^;\s]+)/gi;
const LONG_SECRET_RE = /\b(sk|pk|ghp|xox[bap]|AKIA)[A-Za-z0-9_-]{12,}\b/g;

export const MASK = '***';

function maskString(s: string): string {
  return s
    .replace(BEARER_RE, `$1 ${MASK}`)
    .replace(COOKIE_PAIR_RE, `$1=${MASK}`)
    .replace(LONG_SECRET_RE, MASK);
}

/** Deep copy with sensitive keys and secret-looking strings masked. Safe on cycles and non-plain values. */
export function redact<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (depth > 12) return MASK as unknown as T;
  if (typeof value === 'string') return maskString(value) as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskString(value.message),
      stack: value.stack ? maskString(value.stack) : undefined,
    } as unknown as T;
  }
  if (seen.has(value as object)) return '[circular]' as unknown as T;
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k) && !ALLOW_KEY.test(k))
      out[k] = v === null || v === undefined || v === '' ? v : MASK;
    else out[k] = redact(v, depth + 1, seen);
  }
  return out as T;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bound: LogFields): Logger;
}

export interface LoggerOptions {
  /** Static fields on every line (service, instance). */
  readonly base?: LogFields;
  readonly minLevel?: Level;
  /** Sink for the finished line; default: stdout (stderr for error). */
  readonly write?: (level: Level, line: string) => void;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(opts: LoggerOptions = {}): Logger {
  const min = ORDER[opts.minLevel ?? (process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;
  const write =
    opts.write ?? ((level, line) => (level === 'error' ? console.error(line) : console.log(line)));
  const make = (bound: LogFields): Logger => {
    const emit = (level: Level, msg: string, fields?: LogFields) => {
      if (ORDER[level] < min) return;
      const entry = redact({ t: new Date().toISOString(), level, msg, ...bound, ...fields });
      write(level, JSON.stringify(entry));
    };
    return {
      debug: (m, f) => emit('debug', m, f),
      info: (m, f) => emit('info', m, f),
      warn: (m, f) => emit('warn', m, f),
      error: (m, f) => emit('error', m, f),
      child: (more) => make({ ...bound, ...more }),
    };
  };
  return make(opts.base ?? {});
}

/** The process logger. Services call `logger.child({ requestId })` per request. */
export const logger: Logger = createLogger();
