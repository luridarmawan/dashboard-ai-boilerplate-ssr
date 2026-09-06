import { type TSchema, t } from 'elysia';

/**
 * Shared API contract pieces (PRD FR-N).
 *
 * The response envelope is explicit — handlers return `ok(...)` and the error hook returns
 * `fail(...)` — rather than magically wrapped, so the OpenAPI document shows exactly what
 * goes over the wire (N-1, N-4) and clients can rely on `success` as a discriminator.
 */

// ---------------------------------------------------------------------------
// Error codes — stable strings clients map to translations (N-4). Add, never rename.
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  'not_found',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'conflict',
  'rate_limited',
  'internal_error',
  'service_unavailable',
  // auth (FR-A)
  'csrf_failed',
  'invalid_credentials',
  'signup_disabled',
  'email_taken',
  'weak_password',
  'token_invalid',
  'token_expired',
  'session_expired',
  'tenant_forbidden',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

export interface PageMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface Ok<T, M = undefined> {
  readonly success: true;
  readonly data: T;
  readonly meta?: M;
}

export interface Fail {
  readonly success: false;
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
  readonly requestId: string;
}

export type Envelope<T, M = undefined> = Ok<T, M> | Fail;

export function ok<T>(data: T): Ok<T>;
export function ok<T, M>(data: T, meta: M): Ok<T, M>;
export function ok<T, M>(data: T, meta?: M): Ok<T, M | undefined> {
  return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

export function fail(code: ErrorCode, message: string, requestId: string, details?: unknown): Fail {
  return {
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
    requestId,
  };
}

/** Pagination meta for `?page`/`?limit` lists (N-5). */
export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

// ---------------------------------------------------------------------------
// TypeBox schemas — attach to routes so the envelope appears in OpenAPI (N-1, N-2)
// ---------------------------------------------------------------------------

// Elysia's UnionEnum: a registered TypeBox kind (compiles for response validation) whose static
// type is the literal union — passing the readonly tuple keeps every literal.
export const ErrorCodeSchema = t.UnionEnum(ERROR_CODES);

export const FailSchema = t.Object({
  success: t.Literal(false),
  error: t.Object({
    code: ErrorCodeSchema,
    message: t.String(),
    details: t.Optional(t.Unknown()),
  }),
  requestId: t.String(),
});

export const PageMetaSchema = t.Object({
  page: t.Integer({ minimum: 1 }),
  limit: t.Integer({ minimum: 1 }),
  total: t.Integer({ minimum: 0 }),
  totalPages: t.Integer({ minimum: 1 }),
});

/** `{ success: true, data: T }` */
export function OkSchema<T extends TSchema>(data: T) {
  return t.Object({ success: t.Literal(true), data });
}

/** `{ success: true, data: T[], meta: PageMeta }` */
export function PageSchema<T extends TSchema>(item: T) {
  return t.Object({ success: t.Literal(true), data: t.Array(item), meta: PageMetaSchema });
}

/** Standard error responses to spread into a route's `response` map. */
export const errorResponses = {
  401: FailSchema,
  403: FailSchema,
  404: FailSchema,
  409: FailSchema,
  422: FailSchema,
  429: FailSchema,
  500: FailSchema,
} as const;
