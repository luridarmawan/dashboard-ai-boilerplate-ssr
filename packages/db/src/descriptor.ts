/**
 * Dialect-neutral schema descriptor (PRD §4.3).
 *
 * This is THE ONLY way to define a table — in core and in modules alike. A descriptor is
 * pure data; `bun db:codegen` translates it into a Drizzle schema per dialect using the
 * portability rules of §4.3 (UUID → char(36) ascii_bin / uuid, datetime(3) /
 * timestamptz(3), json / jsonb, enum → varchar + application constraint, etc.).
 *
 * Deliberately ABSENT because they are not portable: native enums, array columns,
 * partial indexes, dialect-specific types. If a need does not fit, extend this contract —
 * never drop raw SQL into domain code.
 */

export type ColumnType =
  | { readonly kind: 'uuid' }
  | { readonly kind: 'varchar'; readonly length: number; readonly identifier: boolean }
  | { readonly kind: 'text' }
  | { readonly kind: 'longtext' }
  | { readonly kind: 'int' }
  | { readonly kind: 'bigint' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'datetime' }
  | { readonly kind: 'json' }
  | { readonly kind: 'decimal' }
  | { readonly kind: 'enum'; readonly values: readonly string[]; readonly length: number };

export type DefaultValue =
  | { readonly kind: 'now' }
  | { readonly kind: 'literal'; readonly value: string | number | boolean };

export interface ColumnDef {
  readonly type: ColumnType;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  readonly onUpdateNow: boolean;
  readonly default?: DefaultValue;
}

export interface IndexDef {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}

export interface TenantSpec {
  /** `true` = `client_id NOT NULL`; `{ nullable: true }` = NULL allowed as the global value (E-2 pattern). */
  readonly nullable: boolean;
}

export interface TableDef {
  readonly name: string;
  readonly tenant: TenantSpec | null;
  readonly softDelete: boolean;
  readonly columns: Readonly<Record<string, ColumnDef>>;
  readonly indexes: readonly IndexDef[];
}

/** `status_id` semantics are defined once, here (O-4). Never reinterpret them elsewhere. */
export const STATUS = {
  INACTIVE: 0,
  ACTIVE: 1,
  ARCHIVED: 2,
} as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];

/** Columns owned by the contract; tables must not redefine them. */
export const RESERVED_COLUMNS = [
  'id',
  'client_id',
  'status_id',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

/** MySQL identifier limit (also safe for PostgreSQL's 63). */
const MAX_IDENTIFIER = 63;
const NAME_RE = /^[a-z][a-z0-9_]*$/;

// ---------------------------------------------------------------------------
// Column builder — immutable; every method returns a new copy.
// ---------------------------------------------------------------------------

export class Col {
  constructor(readonly def: ColumnDef) {}

  nullable(): Col {
    return new Col({ ...this.def, nullable: true });
  }
  default(value: string | number | boolean): Col {
    return new Col({ ...this.def, default: { kind: 'literal', value } });
  }
  defaultNow(): Col {
    if (this.def.type.kind !== 'datetime') {
      throw new DescriptorError('defaultNow() hanya untuk kolom datetime');
    }
    return new Col({ ...this.def, default: { kind: 'now' } });
  }
  /** Refreshed by the application on UPDATE — not a DB trigger, to stay portable. */
  onUpdateNow(): Col {
    if (this.def.type.kind !== 'datetime') {
      throw new DescriptorError('onUpdateNow() hanya untuk kolom datetime');
    }
    return new Col({ ...this.def, onUpdateNow: true });
  }
}

const mk = (type: ColumnType): Col =>
  new Col({ type, nullable: false, primaryKey: false, onUpdateNow: false });

export const col = {
  /** UUIDv7 from `newId()`. char(36) ascii_bin on MySQL, uuid on PostgreSQL. */
  uuid: (): Col => mk({ kind: 'uuid' }),
  /** Human text: utf8mb4_unicode_ci. */
  varchar: (length: number): Col => {
    assertLength(length, 1, 16383, 'varchar');
    return mk({ kind: 'varchar', length, identifier: false });
  },
  /** Codes/slugs/machine keys: ascii_bin — byte comparison, immune to MySQL vs MariaDB collation differences. */
  identifier: (length = 64): Col => {
    assertLength(length, 1, 255, 'identifier');
    return mk({ kind: 'varchar', length, identifier: true });
  },
  text: (): Col => mk({ kind: 'text' }),
  longtext: (): Col => mk({ kind: 'longtext' }),
  int: (): Col => mk({ kind: 'int' }),
  bigint: (): Col => mk({ kind: 'bigint' }),
  boolean: (): Col => mk({ kind: 'boolean' }),
  /** Always UTC, millisecond precision. Time-zone conversion belongs to the presentation layer. */
  datetime: (): Col => mk({ kind: 'datetime' }),
  /** Never query inside JSON in portable code — MariaDB stores it as longtext. */
  json: (): Col => mk({ kind: 'json' }),
  /** decimal(18,4). Money is never a float. */
  money: (): Col => mk({ kind: 'decimal' }),
  /** varchar + application constraint — native enums are forbidden (§4.3). */
  enum: (values: readonly string[], length = 32): Col => {
    if (values.length === 0) throw new DescriptorError('enum butuh minimal satu nilai');
    if (new Set(values).size !== values.length) throw new DescriptorError('nilai enum duplikat');
    for (const v of values) {
      if (v.length > length) {
        throw new DescriptorError(`nilai enum "${v}" melebihi panjang ${length}`);
      }
    }
    return mk({ kind: 'enum', values, length });
  },
};

// ---------------------------------------------------------------------------
// defineTable
// ---------------------------------------------------------------------------

export interface DefineTableOptions {
  readonly name: string;
  /** `false` = global table (e.g. `clients`); `true` = tenant-scoped; `{ nullable: true }` = global-fallback pattern (E-2). */
  readonly tenant: boolean | TenantSpec;
  /** Defaults to `true` (O-5). Disable only for append-only tables such as the audit log. */
  readonly softDelete?: boolean;
  readonly columns: Readonly<Record<string, Col>>;
  readonly indexes?: readonly {
    readonly columns: readonly string[];
    readonly unique?: boolean;
    readonly name?: string;
  }[];
}

export class DescriptorError extends Error {
  override name = 'DescriptorError';
}

export function defineTable(opts: DefineTableOptions): TableDef {
  const { name } = opts;
  assertName(name, 'tabel');

  const tenant: TenantSpec | null =
    opts.tenant === false ? null : opts.tenant === true ? { nullable: false } : opts.tenant;
  const softDelete = opts.softDelete ?? true;

  // Contract columns (O-4, O-5, O-6) are always present and always in this order.
  const columns: Record<string, ColumnDef> = {
    id: { ...col.uuid().def, primaryKey: true },
  };
  if (tenant) {
    columns.client_id = { ...col.uuid().def, nullable: tenant.nullable };
  }

  for (const [key, c] of Object.entries(opts.columns)) {
    assertName(key, `kolom di tabel ${name}`);
    if ((RESERVED_COLUMNS as readonly string[]).includes(key)) {
      throw new DescriptorError(
        `tabel ${name}: kolom "${key}" milik kontrak dan tidak boleh didefinisikan ulang`,
      );
    }
    columns[key] = c.def;
  }

  columns.status_id = col.int().default(STATUS.ACTIVE).def;
  columns.created_at = col.datetime().defaultNow().def;
  columns.updated_at = col.datetime().defaultNow().onUpdateNow().def;
  if (softDelete) columns.deleted_at = col.datetime().nullable().def;

  const indexes: IndexDef[] = [];
  const seen = new Set<string>();
  for (const ix of opts.indexes ?? []) {
    if (ix.columns.length === 0) throw new DescriptorError(`tabel ${name}: indeks tanpa kolom`);
    for (const c of ix.columns) {
      if (!(c in columns)) {
        throw new DescriptorError(`tabel ${name}: indeks merujuk kolom "${c}" yang tidak ada`);
      }
    }
    // B-0: indexes on tenant tables ALWAYS start with client_id so they stay selective as tenants grow.
    if (tenant && ix.columns[0] !== 'client_id') {
      throw new DescriptorError(
        `tabel ${name}: indeks (${ix.columns.join(', ')}) harus diawali client_id (B-0)`,
      );
    }
    const ixName = ix.name ?? `${name}_${ix.columns.join('_')}_${ix.unique ? 'uq' : 'idx'}`;
    assertName(ixName, `indeks di tabel ${name}`);
    if (seen.has(ixName)) throw new DescriptorError(`tabel ${name}: indeks "${ixName}" duplikat`);
    seen.add(ixName);
    indexes.push({ name: ixName, columns: [...ix.columns], unique: ix.unique ?? false });
  }
  // A tenant table with no index at all still needs one on client_id; otherwise every
  // per-tenant query becomes a full scan as soon as tenants multiply.
  if (tenant && indexes.length === 0) {
    indexes.push({ name: `${name}_client_id_idx`, columns: ['client_id'], unique: false });
  }

  return { name, tenant, softDelete, columns, indexes };
}

function assertName(value: string, what: string): void {
  if (!NAME_RE.test(value)) {
    throw new DescriptorError(
      `${what}: nama "${value}" harus huruf kecil/angka/underscore dan diawali huruf`,
    );
  }
  if (value.length > MAX_IDENTIFIER) {
    throw new DescriptorError(
      `${what}: nama "${value}" melebihi ${MAX_IDENTIFIER} karakter (batas identifier)`,
    );
  }
}

function assertLength(n: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new DescriptorError(`${what}: panjang ${n} di luar rentang ${min}–${max}`);
  }
}
