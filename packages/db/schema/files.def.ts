import { col, defineTable } from '../src/descriptor.ts';

/**
 * Uploaded files (PRD Q-16): metadata only — the bytes live in the storage adapter (local volume
 * or S3) under `key`. Tenant-scoped; `visibility` public means anyone who can name the tenant may
 * fetch the bytes (logos, product images), private means the owner or `file.read` holders.
 * Soft-deleted rows keep their key until the retention job removes the object.
 */
export const files = defineTable({
  name: 'files',
  tenant: true,
  columns: {
    user_id: col.uuid().references('users', 'cascade').nullable(),
    /** Storage key: `<clientId>/<yyyy>/<mm>/<id>.<ext>`. */
    key: col.identifier(255),
    /** Which adapter holds the bytes: local | s3. */
    storage: col.identifier(16),
    /** Original file name as uploaded (display only). */
    name: col.varchar(255),
    mime: col.identifier(128),
    size: col.int(),
    sha256: col.identifier(64),
    /** What the file is for: `generic`, `theme-logo`, `avatar`, `<ns>.<purpose>` for modules. */
    kind: col.identifier(64).default('generic'),
    /** public | private */
    visibility: col.identifier(16).default('private'),
    meta: col.json().nullable(),
  },
  indexes: [
    { columns: ['client_id', 'user_id', 'created_at'] },
    { columns: ['client_id', 'kind'] },
    { columns: ['client_id', 'key'], unique: true },
  ],
});
