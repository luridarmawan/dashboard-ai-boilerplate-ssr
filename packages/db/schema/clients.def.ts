import { col, defineTable } from '../src/descriptor.ts';

/**
 * Tenant (B-1). A global table — it is NOT itself tenant-scoped; hierarchy goes through
 * `parent_id`. One default tenant is seeded for single-tenant installs (B-5).
 *
 * The profile block (description, balance, address, geo) is groundwork for later features:
 * every column is nullable or defaulted, nothing in core reads them yet beyond the tenant CRUD.
 * Region ids (`kelurahan_id` … `country_id`) are opaque codes for a future region registry, so
 * they are ascii identifiers rather than foreign keys.
 */
export const clients = defineTable({
  name: 'clients',
  tenant: false,
  columns: {
    parent_id: col.uuid().nullable(),
    /** Unique slug for URLs and the X-Client-ID header; ascii_bin for strict comparison. */
    code: col.identifier(32),
    name: col.varchar(191),
    description: col.text().nullable(),
    /** Small per-tenant preferences. Never queried into (§4.3). */
    settings: col.json().nullable(),

    // ---- ledger (groundwork) ----
    balance: col.money().default('0'),
    total_receipts: col.money().default('0'),

    // ---- address (groundwork; Indonesian administrative levels, names + opaque ids) ----
    address: col.text().nullable(),
    rt: col.varchar(8).nullable(),
    rw: col.varchar(8).nullable(),
    kelurahan: col.varchar(191).nullable(),
    kelurahan_id: col.identifier(32).nullable(),
    kecamatan: col.varchar(191).nullable(),
    kecamatan_id: col.identifier(32).nullable(),
    city: col.varchar(191).nullable(),
    city_id: col.identifier(32).nullable(),
    regency: col.varchar(191).nullable(),
    province: col.varchar(191).nullable(),
    province_id: col.identifier(32).nullable(),
    region: col.varchar(191).nullable(),
    region_id: col.identifier(32).nullable(),
    country_id: col.identifier(32).nullable(),

    // ---- geo & links (groundwork) ----
    /** WGS84; 7 decimals ≈ 1 cm. Strings in application code (decimal, never a float). */
    latitude: col.decimal(10, 7).nullable(),
    longitude: col.decimal(11, 7).nullable(),
    maps_url: col.varchar(2048).nullable(),
    url: col.varchar(2048).nullable(),
  },
  indexes: [{ columns: ['code'], unique: true }, { columns: ['parent_id'] }],
});
