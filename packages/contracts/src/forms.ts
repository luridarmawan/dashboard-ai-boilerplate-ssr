import { Value } from '@sinclair/typebox/value';
import { type TSchema, t } from 'elysia';

/**
 * Request bodies shared by the API routes AND the web forms (PRD L-17: one schema, one truth).
 * The API validates them at the edge (N-1); the web validates the same schema in its form
 * actions before calling the API, so field errors render next to the field — with or without
 * JavaScript — and the two can never disagree.
 */

/** A UUID path/body parameter. Shape only — existence is the handler's 404. */
export const Id = t.String({
  minLength: 36,
  maxLength: 36,
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
});

export const Email = t.String({ format: 'email', maxLength: 191 });
export const Password = t.String({ minLength: 1, maxLength: 256 });
const Name = t.String({ minLength: 1, maxLength: 191 });
const LocaleCode = t.String({ minLength: 2, maxLength: 8 });
const Status = t.Union([t.Literal(0), t.Literal(1)]);

// ---- auth ----
export const LoginBody = t.Object({ email: Email, password: Password });
export const RegisterBody = t.Object({ email: Email, password: Password, name: Name });

// ---- profile (D-4) ----
/** Optional, free-form E.164-ish contact number: digits with optional +, spaces, dashes. */
export const Phone = t.Optional(
  t.Nullable(t.String({ pattern: '^\\+?[0-9][0-9 \\-]{0,30}$', maxLength: 32 })),
);
export const ProfileBody = t.Object({
  name: t.Optional(Name),
  phone: Phone,
  locale: t.Optional(LocaleCode),
  theme: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
  avatarUrl: t.Optional(t.Nullable(t.String({ maxLength: 512 }))),
  /** Sidebar rail (F-8): a shell preference that follows the user, not the browser. */
  sidebarCollapsed: t.Optional(t.Boolean()),
});
export const PasswordChangeBody = t.Object({
  currentPassword: Password,
  newPassword: Password,
});

// ---- users (D-1) ----
export const UserCreateBody = t.Object({
  email: Email,
  name: Name,
  phone: Phone,
  password: t.Optional(Password),
  locale: t.Optional(LocaleCode),
  groupIds: t.Optional(t.Array(Id, { maxItems: 50 })),
});
export const UserUpdateBody = t.Object({
  name: t.Optional(Name),
  phone: Phone,
  locale: t.Optional(LocaleCode),
  statusId: t.Optional(Status),
  isSuperadmin: t.Optional(t.Boolean()),
  groupIds: t.Optional(t.Array(Id, { maxItems: 50 })),
});

// ---- 2FA TOTP (A-11) ----
export const MfaCode = t.String({ minLength: 6, maxLength: 20 });
/** Second login step: the challenge token from POST /auth/login plus a TOTP or recovery code. */
export const MfaLoginBody = t.Object({
  challenge: t.String({ minLength: 20, maxLength: 128 }),
  code: MfaCode,
});
export const MfaCodeBody = t.Object({ code: MfaCode });
export const MfaDisableBody = t.Object({ password: Password });

// ---- outgoing webhooks (J-5) ----
export const WebhookBody = t.Object({
  name: Name,
  url: t.String({ minLength: 12, maxLength: 512, pattern: '^https?://' }),
  /** Core event names, or `*` for all of them. */
  events: t.Array(t.String({ minLength: 1, maxLength: 64 }), { minItems: 1, maxItems: 50 }),
  enabled: t.Optional(t.Boolean()),
});
export const WebhookUpdateBody = t.Partial(WebhookBody);

// ---- groups (D-2) ----
export const GroupCode = t.String({ minLength: 2, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' });
export const GroupCreateBody = t.Object({
  code: GroupCode,
  name: Name,
  description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  permissions: t.Optional(t.Array(t.String({ maxLength: 191 }), { maxItems: 500 })),
});
export const GroupUpdateBody = t.Object({
  code: t.Optional(GroupCode),
  name: t.Optional(Name),
  description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
});
export const GroupPermissionsBody = t.Object({
  permissions: t.Array(t.String({ maxLength: 191 }), { maxItems: 500 }),
});

// ---- tenants (D-3) ----
export const ClientCode = t.String({ minLength: 2, maxLength: 32, pattern: '^[a-z][a-z0-9_-]*$' });
export const ClientCreateBody = t.Object({
  code: ClientCode,
  name: Name,
  parentId: t.Optional(t.Nullable(Id)),
  settings: t.Optional(t.Nullable(t.Record(t.String(), t.Unknown()))),
});
export const ClientUpdateBody = t.Object({
  name: t.Optional(Name),
  parentId: t.Optional(t.Nullable(Id)),
  settings: t.Optional(t.Nullable(t.Record(t.String(), t.Unknown()))),
  statusId: t.Optional(Status),
});

// ---- validating a posted form against a schema ----

export type FieldErrors = Record<string, string>;

export interface FormValidation<T> {
  readonly ok: boolean;
  /** Converted value (strings coerced to numbers/booleans where the schema says so). */
  readonly value: T;
  /** First error per top-level field, keyed by field name; `_` for root-level problems. */
  readonly errors: FieldErrors;
}

/**
 * Validate a plain object (e.g. from FormData) against a TypeBox schema. `Value.Convert` turns
 * "1" into 1 and "on"/"true" into true where the schema expects it, then `Value.Check` decides.
 * Field errors come straight from TypeBox, so they match what the API would say.
 */
export function validateForm<S extends TSchema>(
  schema: S,
  input: unknown,
): FormValidation<S['static']> {
  const value = Value.Convert(schema, Value.Clean(schema, structuredClone(input))) as S['static'];
  if (Value.Check(schema, value)) return { ok: true, value, errors: {} };
  const errors: FieldErrors = {};
  for (const e of Value.Errors(schema, value)) {
    const field = e.path.split('/').filter(Boolean)[0] ?? '_';
    if (!(field in errors)) errors[field] = e.message;
  }
  return { ok: false, value, errors };
}

/**
 * FormData → plain object for `validateForm`: repeated keys become arrays, empty strings become
 * `undefined` (so optional fields stay optional), and keys listed in `arrays` are always arrays.
 */
export function formToObject(
  form: FormData,
  opts: { arrays?: readonly string[]; nullable?: readonly string[] } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const arrays = new Set(opts.arrays ?? []);
  const nullable = new Set(opts.nullable ?? []);
  for (const key of new Set(form.keys())) {
    if (key.startsWith('_')) continue; // csrf & friends
    const all = form.getAll(key).filter((v): v is string => typeof v === 'string');
    if (arrays.has(key)) {
      out[key] = all.filter((v) => v !== '');
      continue;
    }
    const v = all[all.length - 1] ?? '';
    if (v === '') out[key] = nullable.has(key) ? null : undefined;
    else out[key] = v;
  }
  for (const key of arrays) if (!(key in out)) out[key] = [];
  return out;
}
