import { describe, expect, test } from 'bun:test';
import { col, DescriptorError, defineTable, RESERVED_COLUMNS, STATUS } from '../src/descriptor.ts';

describe('defineTable — kontrak kolom (O-4, O-5, O-6)', () => {
  test('kolom kontrak selalu ada, dalam urutan tetap', () => {
    const t = defineTable({ name: 'things', tenant: false, columns: { title: col.varchar(50) } });
    expect(Object.keys(t.columns)).toEqual([
      'id',
      'title',
      'status_id',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
    expect(t.columns.id).toMatchObject({ primaryKey: true, type: { kind: 'uuid' } });
    expect(t.columns.status_id?.default).toEqual({ kind: 'literal', value: STATUS.ACTIVE });
    expect(t.columns.updated_at).toMatchObject({ onUpdateNow: true, default: { kind: 'now' } });
    expect(t.columns.deleted_at?.nullable).toBe(true);
  });

  test('tabel ber-tenant menambah client_id NOT NULL tepat setelah id', () => {
    const t = defineTable({ name: 'notes', tenant: true, columns: { body: col.text() } });
    expect(Object.keys(t.columns).slice(0, 2)).toEqual(['id', 'client_id']);
    expect(t.columns.client_id?.nullable).toBe(false);
  });

  test('pola global-fallback (E-2): client_id boleh NULL', () => {
    const t = defineTable({ name: 'settings', tenant: { nullable: true }, columns: {} });
    expect(t.columns.client_id?.nullable).toBe(true);
  });

  test('softDelete: false menghilangkan deleted_at (audit log append-only)', () => {
    const t = defineTable({ name: 'events', tenant: true, softDelete: false, columns: {} });
    expect('deleted_at' in t.columns).toBe(false);
  });

  test('kolom kontrak tidak boleh didefinisikan ulang', () => {
    for (const reserved of RESERVED_COLUMNS) {
      expect(() =>
        defineTable({ name: 'x', tenant: true, columns: { [reserved]: col.int() } }),
      ).toThrow(DescriptorError);
    }
  });
});

describe('defineTable — indeks (B-0)', () => {
  test('indeks tabel ber-tenant WAJIB diawali client_id', () => {
    expect(() =>
      defineTable({
        name: 'orders',
        tenant: true,
        columns: { number: col.identifier() },
        indexes: [{ columns: ['number'], unique: true }],
      }),
    ).toThrow(/diawali client_id/);
  });

  test('tabel ber-tenant tanpa indeks eksplisit tetap dapat indeks client_id', () => {
    const t = defineTable({ name: 'notes', tenant: true, columns: {} });
    expect(t.indexes).toEqual([
      { name: 'notes_client_id_idx', columns: ['client_id'], unique: false },
    ]);
  });

  test('tabel global bebas memilih kolom indeks pertama', () => {
    const t = defineTable({
      name: 'clients',
      tenant: false,
      columns: { code: col.identifier(32) },
      indexes: [{ columns: ['code'], unique: true }],
    });
    expect(t.indexes[0]).toEqual({ name: 'clients_code_uq', columns: ['code'], unique: true });
  });

  test('indeks ke kolom yang tidak ada ditolak dengan nama kolomnya', () => {
    expect(() =>
      defineTable({ name: 'a', tenant: false, columns: {}, indexes: [{ columns: ['ghost'] }] }),
    ).toThrow(/"ghost"/);
  });
});

describe('col — aturan portabilitas (§4.3)', () => {
  test('enum = varchar + constraint aplikasi; nilai harus muat', () => {
    const c = col.enum(['draft', 'published'], 16);
    expect(c.def.type).toEqual({ kind: 'enum', values: ['draft', 'published'], length: 16 });
    expect(() => col.enum([])).toThrow(DescriptorError);
    expect(() => col.enum(['a', 'a'])).toThrow(/duplikat/);
    expect(() => col.enum(['terlalu_panjang_sekali'], 8)).toThrow(/melebihi/);
  });

  test('identifier vs varchar dibedakan (ascii_bin vs utf8mb4)', () => {
    expect(col.identifier(32).def.type).toMatchObject({ kind: 'varchar', identifier: true });
    expect(col.varchar(32).def.type).toMatchObject({ kind: 'varchar', identifier: false });
  });

  test('defaultNow/onUpdateNow hanya untuk datetime', () => {
    expect(() => col.int().defaultNow()).toThrow(DescriptorError);
    expect(() => col.text().onUpdateNow()).toThrow(DescriptorError);
  });

  test('builder immutable — memodifikasi tidak mengubah asal', () => {
    const base = col.varchar(10);
    const nullable = base.nullable();
    expect(base.def.nullable).toBe(false);
    expect(nullable.def.nullable).toBe(true);
  });

  test('nama tabel/kolom divalidasi', () => {
    expect(() => defineTable({ name: 'Bad-Name', tenant: false, columns: {} })).toThrow(
      DescriptorError,
    );
    expect(() =>
      defineTable({ name: 'ok', tenant: false, columns: { 'Bad Col': col.int() } }),
    ).toThrow(DescriptorError);
  });
});
