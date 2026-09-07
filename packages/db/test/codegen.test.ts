import { describe, expect, test } from 'bun:test';
import { tables } from '../schema/index.ts';
import { camel, emitMysql, emitPg } from '../src/codegen/emit.ts';
import { col, defineTable } from '../src/descriptor.ts';

/**
 * The emitters are tested as pure functions: the §4.3 portability rules must be visible
 * in the output, and forbidden constructs must not appear. This is the "DDL states an
 * explicit charset" guard at the source level; the migration-SQL-level guard follows once
 * drizzle-kit runs in CI.
 */

const probe = defineTable({
  name: 'probe',
  tenant: true,
  columns: {
    code: col.identifier(16),
    title: col.varchar(100),
    body: col.text(),
    blob: col.longtext(),
    qty: col.int(),
    big: col.bigint(),
    flag: col.boolean().default(false),
    when: col.datetime().nullable(),
    meta: col.json().nullable(),
    price: col.money(),
    state: col.enum(['draft', 'live'], 8).default('draft'),
  },
  indexes: [{ columns: ['client_id', 'code'], unique: true }, { columns: ['client_id', 'when'] }],
});

describe('emitMysql — aturan §4.3 untuk MySQL/MariaDB', () => {
  const out = emitMysql([probe]);

  test('UUID = char(36) ascii_bin lewat customType, bukan char() bawaan', () => {
    expect(out).toContain("id: uuidChar('id').primaryKey()");
    expect(out).toContain("client_id: uuidChar('client_id').notNull()");
    expect(out).not.toMatch(/\bchar\(/);
  });

  test('identifier → ascii; teks manusia → utf8mb4', () => {
    expect(out).toContain("code: asciiVarchar('code', { length: 16 }).notNull()");
    expect(out).toContain("title: utf8Varchar('title', { length: 100 }).notNull()");
    expect(out).toContain("body: utf8Text('body').notNull()");
    expect(out).toContain("blob: utf8LongText('blob').notNull()");
  });

  test('enum menjadi varchar — tidak pernah enum native', () => {
    expect(out).toContain(
      'state: utf8Varchar(\'state\', { length: 8 }).notNull().default("draft")',
    );
    expect(out).not.toMatch(/mysqlEnum|\benum\(/);
  });

  test('datetime(3) UTC, json, decimal(18,4), boolean', () => {
    expect(out).toContain("when: datetime('when', { fsp: 3 })");
    expect(out).toContain(
      "created_at: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`)",
    );
    expect(out).toContain(
      "updated_at: datetime('updated_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`).$onUpdate(() => new Date())",
    );
    expect(out).toContain("meta: json('meta')");
    expect(out).toContain("price: decimal('price', { precision: 18, scale: 4 }).notNull()");
    expect(out).toContain("flag: boolean('flag').notNull().default(false)");
  });

  test('prefix tabel lewat mysqlTableCreator (O-2) dan indeks diawali client_id', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal text of generated code
    expect(out).toContain('mysqlTableCreator((name) => `${TABLE_PREFIX}${name}`)');
    expect(out).toContain("uniqueIndex('probe_client_id_code_uq').on(t.client_id, t.code)");
    expect(out).toContain("index('probe_client_id_when_idx').on(t.client_id, t.when)");
  });

  test('metadata tenant untuk penjaga B-3', () => {
    expect(out).toMatch(
      /export const tenantTables: ReadonlySet<string> = new Set\(\['probe'\]\.map\(\(n\) => `\$\{TABLE_PREFIX\}\$\{n\}`\)\)/,
    );
  });
});

describe('emitPg — aturan §4.3 untuk PostgreSQL', () => {
  const out = emitPg([probe]);

  test('uuid native, timestamptz(3), jsonb, numeric(18,4)', () => {
    expect(out).toContain("id: uuid('id').primaryKey()");
    expect(out).toContain(
      "when: timestamp('when', { withTimezone: true, precision: 3, mode: 'date' })",
    );
    expect(out).toContain(
      "created_at: timestamp('created_at', { withTimezone: true, precision: 3, mode: 'date' }).notNull().defaultNow()",
    );
    expect(out).toContain("meta: jsonb('meta')");
    expect(out).toContain("price: numeric('price', { precision: 18, scale: 4 }).notNull()");
  });

  test('tidak ada sisa dialek MySQL, dan enum tetap varchar', () => {
    expect(out).not.toMatch(/CHARACTER SET|utf8|ascii|mysql|datetime\(|longtext/);
    expect(out).toContain('state: varchar(\'state\', { length: 8 }).notNull().default("draft")');
    expect(out).not.toMatch(/pgEnum/);
  });

  test('prefix tabel lewat pgTableCreator', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal text of generated code
    expect(out).toContain('pgTableCreator((name) => `${TABLE_PREFIX}${name}`)');
  });
});

describe('codegen — sifat umum', () => {
  test('deterministik: input sama → keluaran identik byte demi byte', () => {
    expect(emitMysql(tables)).toBe(emitMysql(tables));
    expect(emitPg(tables)).toBe(emitPg(tables));
  });

  test('urutan tabel stabil (berdasarkan nama), tidak tergantung urutan pendaftaran', () => {
    const a = emitPg([...tables]);
    const b = emitPg([...tables].reverse());
    expect(a).toBe(b);
  });

  test('nama tabel ganda ditolak', () => {
    expect(() => emitPg([probe, probe])).toThrow(/dua kali/);
  });

  test('skema core nyata: clients global, audit_log ber-tenant tanpa deleted_at', () => {
    const out = emitMysql(tables);
    expect(out).toContain("'clients', // global");
    expect(out).toContain("'audit_log', // tenant-scoped");
    expect(out).toMatch(
      /tenantTables: ReadonlySet<string> = new Set\(\[.*'audit_log'.*'groups'.*\]\.map/,
    );
    expect(out).not.toMatch(/new Set\(\[[^\]]*'users'/); // users is global
    const start = out.indexOf("'audit_log'");
    const auditBlock = out.slice(start, out.indexOf('export const ', start + 1));
    expect(auditBlock).not.toContain('deleted_at');
  });

  test('camel: snake_case → camelCase', () => {
    expect(camel('audit_log')).toBe('auditLog');
    expect(camel('client_user_maps')).toBe('clientUserMaps');
    expect(camel('clients')).toBe('clients');
  });
});

describe('references (foreign keys)', () => {
  const parent = defineTable({ name: 'parents', tenant: false, columns: {} });
  const child = defineTable({
    name: 'children',
    tenant: false,
    columns: {
      parent_id: col.uuid().references('parents', 'cascade'),
      other_id: col.uuid().references('parents').nullable(),
    },
  });

  test('emits a lazy .references(() => table.id, { onDelete }) on both dialects', () => {
    for (const out of [emitMysql([child, parent]), emitPg([child, parent])]) {
      expect(out).toContain(".references(() => parents.id, { onDelete: 'cascade' })");
      expect(out).toContain(".references(() => parents.id, { onDelete: 'restrict' })");
    }
  });

  test('a reference to an unknown table fails codegen with both names', () => {
    expect(() => emitPg([child])).toThrow(
      /children\.parent_id merujuk tabel "parents" yang tidak ada/,
    );
  });

  test('references() is only valid on uuid columns', () => {
    expect(() => col.int().references('parents')).toThrow(/hanya untuk kolom uuid/);
  });

  test('a global table may define client_id with its own meaning; a tenant table may not', () => {
    expect(
      defineTable({ name: 'g', tenant: false, columns: { client_id: col.uuid().nullable() } })
        .columns.client_id?.nullable,
    ).toBe(true);
    expect(() =>
      defineTable({ name: 't', tenant: true, columns: { client_id: col.uuid() } }),
    ).toThrow(/milik kontrak/);
  });
});
