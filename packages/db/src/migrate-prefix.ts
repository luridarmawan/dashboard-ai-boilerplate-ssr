/**
 * TABLE_PREFIX for migrations (PRD O-2): several applications may share one database. The runtime
 * schema already prefixes every table (`mysqlTableCreator` / `pgTableCreator` in the generated
 * schema); the committed migration SQL is written for an empty prefix, so at migrate time each
 * file is rewritten for the configured prefix:
 *   - table names after CREATE/ALTER/DROP TABLE, REFERENCES, INSERT INTO, UPDATE, DELETE FROM,
 *     RENAME TO and the `ON <table>` of index statements;
 *   - constraint and index names, which Drizzle derives from the table name (`users_email_uq`,
 *     `sessions_user_id_users_id_fk`), because MySQL FK names are unique per schema.
 * Only identifiers that are (or start with) a known table name are touched, so columns such as
 * `client_id` or `settings` are never rewritten.
 */
const Q = '[`"]';
const ID = '([A-Za-z0-9_]+)';

/** Table names created anywhere in the migration set — the authority for what gets prefixed. */
export function collectTableNames(sqlFiles: readonly string[]): Set<string> {
  const names = new Set<string>();
  const re = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:"public"\\.)?${Q}${ID}${Q}`, 'gi');
  for (const sql of sqlFiles) for (const m of sql.matchAll(re)) if (m[1]) names.add(m[1]);
  return names;
}

export function prefixSql(sql: string, prefix: string, tables: ReadonlySet<string>): string {
  if (!prefix) return sql;
  const isTable = (n: string) => tables.has(n);
  const derived = (n: string) => {
    if (tables.has(n)) return true;
    for (const t of tables) if (n.startsWith(`${t}_`)) return true;
    return false;
  };
  const tableRefs = new RegExp(
    `\\b(CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE|DROP TABLE(?: IF EXISTS)?|REFERENCES|INSERT INTO|UPDATE|DELETE FROM|RENAME TO|TRUNCATE(?: TABLE)?)(\\s+)((?:"public"\\.)?)(${Q})${ID}\\4`,
    'gi',
  );
  const onRefs = new RegExp(`\\b(ON)(\\s+)((?:"public"\\.)?)(${Q})${ID}\\4`, 'gi');
  const namedObjects = new RegExp(
    `\\b(CONSTRAINT|CREATE\\s+(?:UNIQUE\\s+)?INDEX(?: IF NOT EXISTS)?|DROP INDEX(?: IF EXISTS)?|DROP CONSTRAINT|DROP FOREIGN KEY)(\\s+)(${Q})${ID}\\3`,
    'gi',
  );
  return sql
    .replace(tableRefs, (all, kw, ws, schema, q, name) =>
      isTable(name) ? `${kw}${ws}${schema}${q}${prefix}${name}${q}` : all,
    )
    .replace(onRefs, (all, kw, ws, schema, q, name) =>
      isTable(name) ? `${kw}${ws}${schema}${q}${prefix}${name}${q}` : all,
    )
    .replace(namedObjects, (all, kw, ws, q, name) =>
      derived(name) ? `${kw}${ws}${q}${prefix}${name}${q}` : all,
    );
}

/** Drizzle's journal table must be per prefix too, or two apps sharing a database would share a journal. */
export function migrationsTableFor(prefix: string): string {
  return `${prefix}__drizzle_migrations`;
}
