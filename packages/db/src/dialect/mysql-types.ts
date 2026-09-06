import { customType } from 'drizzle-orm/mysql-core';

/**
 * MySQL/MariaDB column types with EXPLICIT charset & collation (PRD §4.3).
 *
 * Why customType instead of the built-in `char()`/`varchar()`: Drizzle's builder has no
 * per-column charset API, and DDL that inherits the server default differs between
 * MySQL 8 (`utf8mb4_0900_ai_ci`, absent on MariaDB) and MariaDB — silently: ORDER BY
 * order and unique-index collisions can change. `dataType()` here goes verbatim into the
 * migration drizzle-kit emits, so every text column states its own charset and the CI
 * guard can grep for it.
 */

const UTF8 = 'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci';
const ASCII = 'CHARACTER SET ascii COLLATE ascii_bin';

/** UUID as char(36) ascii_bin — readable in SQL clients, immune to collation differences (§4.3.1). */
export const uuidChar = customType<{ data: string; driverData: string }>({
  dataType: () => `char(36) ${ASCII}`,
});

/** Codes, slugs, machine keys. Byte-for-byte comparison. */
export const asciiVarchar = customType<{
  data: string;
  driverData: string;
  config: { length: number };
}>({
  dataType: (c) => `varchar(${c?.length ?? 64}) ${ASCII}`,
});

/** Short human text. */
export const utf8Varchar = customType<{
  data: string;
  driverData: string;
  config: { length: number };
}>({
  dataType: (c) => `varchar(${c?.length ?? 255}) ${UTF8}`,
});

export const utf8Text = customType<{ data: string; driverData: string }>({
  dataType: () => `text ${UTF8}`,
});

export const utf8LongText = customType<{ data: string; driverData: string }>({
  dataType: () => `longtext ${UTF8}`,
});
