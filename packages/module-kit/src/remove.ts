/**
 * Clean module uninstall (PRD G-15) — the pure half. Given a module's namespace and the latest
 * drizzle snapshot of a dialect, plan what leaving the module behind means for the database:
 *
 *   1. its own tables, dropped children-first (FK-safe on MySQL; PostgreSQL gets CASCADE too);
 *   2. the rows the module left in CORE tables — enablement (`modules`), its configuration keys,
 *      permission grants, scheduler leases and history, queued jobs, its notifications, users
 *      parked on one of its themes, and the two route settings that may point into it — plus a
 *      bump of `cache_versions` so every running instance drops its memory copy at once (E-5).
 *
 * The result is written INTO the migration drizzle-kit generated for the schema diff, replacing
 * its alphabetical `DROP TABLE`s: the shared, versioned migration sequence stays the one production
 * path to a schema change (Q-4), and `TABLE_PREFIX` rewriting applies because every table name
 * is quoted (see `@core/db` migrate-prefix). `scripts/modules-remove.ts` does the impure half:
 * modules.json, git, files, install, sync, generate.
 */

export type RemovalDialect = 'mysql' | 'pg';

export interface SnapshotTable {
  name: string;
  /** Module tables this one references (only those inside the module matter for ordering). */
  dependsOn: string[];
}

/** Minimal shape of drizzle-kit's `meta/NNNN_snapshot.json` that the planner reads. */
export interface DrizzleSnapshotLike {
  tables: Record<
    string,
    { name: string; foreignKeys?: Record<string, { tableFrom: string; tableTo: string }> }
  >;
}

/** The module's tables in the snapshot, with their intra-module references. */
export function moduleTablesFromSnapshot(
  snapshot: DrizzleSnapshotLike,
  ns: string,
): SnapshotTable[] {
  const prefix = `${ns}_`;
  const own = new Set<string>();
  for (const t of Object.values(snapshot.tables)) if (t.name.startsWith(prefix)) own.add(t.name);
  const out: SnapshotTable[] = [];
  for (const t of Object.values(snapshot.tables)) {
    if (!own.has(t.name)) continue;
    const deps = new Set<string>();
    for (const fk of Object.values(t.foreignKeys ?? {}))
      if (fk.tableFrom === t.name && own.has(fk.tableTo) && fk.tableTo !== t.name)
        deps.add(fk.tableTo);
    out.push({ name: t.name, dependsOn: [...deps].sort() });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Children before parents: a table is dropped only after every table that references it is gone.
 * Deterministic (alphabetical among peers); a reference cycle falls back to alphabetical order for
 * the tables left, since MySQL cannot drop either first anyway without disabling FK checks.
 */
export function orderForDrop(tables: readonly SnapshotTable[]): string[] {
  const names = new Set(tables.map((t) => t.name));
  // referencedBy[x] = tables that point at x (must be dropped before x)
  const referencedBy = new Map<string, Set<string>>();
  for (const t of tables) {
    referencedBy.set(t.name, referencedBy.get(t.name) ?? new Set());
    for (const d of t.dependsOn) {
      if (!names.has(d)) continue;
      const s = referencedBy.get(d) ?? new Set<string>();
      s.add(t.name);
      referencedBy.set(d, s);
    }
  }
  const dropped = new Set<string>();
  const out: string[] = [];
  let remaining = [...names].sort();
  while (remaining.length) {
    const ready = remaining.filter((n) =>
      [...(referencedBy.get(n) ?? [])].every((child) => dropped.has(child)),
    );
    const batch = ready.length ? ready : [remaining[0] as string];
    for (const n of batch) {
      out.push(n);
      dropped.add(n);
    }
    remaining = remaining.filter((n) => !dropped.has(n));
  }
  return out;
}

const q = (dialect: RemovalDialect, ident: string) =>
  dialect === 'mysql' ? `\`${ident}\`` : `"${ident}"`;

/** `DROP TABLE IF EXISTS …` in FK-safe order; PostgreSQL additionally CASCADEs dependent objects. */
export function dropStatements(
  dialect: RemovalDialect,
  orderedTables: readonly string[],
): string[] {
  return orderedTables.map((t) =>
    dialect === 'pg'
      ? `DROP TABLE IF EXISTS ${q(dialect, t)} CASCADE;`
      : `DROP TABLE IF EXISTS ${q(dialect, t)};`,
  );
}

export interface RemovalPlanInput {
  /** Module name as in modules.json (`AI`). */
  name: string;
  /** Namespace (`ai`). */
  ns: string;
}

/**
 * Rows the module left in core tables. Patterns are `<ns>.%` for dotted ids (config keys,
 * permissions, job names, notification types) and `/m/<ns>/%` for dashboard links. The namespace
 * is `[a-z0-9]+` by contract (MODULE_NAME_RE), so no LIKE escaping is needed.
 */
export function cleanupStatements(dialect: RemovalDialect, p: RemovalPlanInput): string[] {
  const T = (t: string) => q(dialect, t);
  const dotted = `'${p.ns}.%'`;
  const link = `'/m/${p.ns}/%'`;
  // `key` and `value` are reserved words on MySQL — quoted everywhere for symmetry.
  const keyCol = q(dialect, 'key');
  const valueCol = q(dialect, 'value');
  return [
    `DELETE FROM ${T('modules')} WHERE ${q(dialect, 'module')} = '${p.name}';`,
    `DELETE FROM ${T('configurations')} WHERE ${keyCol} LIKE ${dotted};`,
    `DELETE FROM ${T('configurations')} WHERE ${keyCol} IN ('app.default_theme') AND ${valueCol} LIKE ${dotted};`,
    `DELETE FROM ${T('configurations')} WHERE ${keyCol} IN ('app.home_route', 'app.landing_route') AND ${valueCol} LIKE ${link};`,
    `DELETE FROM ${T('group_permissions')} WHERE ${q(dialect, 'permission')} LIKE ${dotted};`,
    `DELETE FROM ${T('scheduler_runs')} WHERE ${q(dialect, 'job')} LIKE ${dotted};`,
    `DELETE FROM ${T('scheduler_jobs')} WHERE ${q(dialect, 'name')} LIKE ${dotted};`,
    `DELETE FROM ${T('queue_jobs')} WHERE ${q(dialect, 'name')} LIKE ${dotted};`,
    `DELETE FROM ${T('notifications')} WHERE ${q(dialect, 'type')} LIKE ${dotted} OR ${q(dialect, 'link')} LIKE ${link};`,
    `UPDATE ${T('users')} SET ${q(dialect, 'theme')} = NULL WHERE ${q(dialect, 'theme')} LIKE ${dotted};`,
    `UPDATE ${T('cache_versions')} SET ${q(dialect, 'version')} = ${q(dialect, 'version')} + 1 WHERE ${q(dialect, 'name')} IN ('modules', 'configurations');`,
  ];
}

export const BREAKPOINT = '--> statement-breakpoint';

export interface RemovalMigration {
  dialect: RemovalDialect;
  name: string;
  ns: string;
  /** Tables in drop order. */
  tables: string[];
}

/** One SQL comment block at the top of the migration: what it is, why, how to read it. */
export function removalHeader(m: RemovalMigration): string {
  const lines = [
    `-- Uninstall modul ${m.name} (G-15): dibuat oleh \`bun modules:remove ${m.name}\`.`,
    `-- Menjatuhkan tabel modul (anak dulu, lalu induk) dan membersihkan baris yang ditinggalkannya`,
    `-- di tabel core. Tidak bisa dibatalkan — pastikan backup sudah ada (deploy/backup.sh).`,
    `-- Tabel: ${m.tables.length ? m.tables.join(', ') : '(tidak ada di snapshot)'}`,
  ];
  return lines.join('\n');
}

/** The complete migration body for one dialect. */
export function renderRemovalMigration(m: RemovalMigration, keep: readonly string[] = []): string {
  const statements = [
    ...keep,
    ...dropStatements(m.dialect, m.tables),
    ...cleanupStatements(m.dialect, { name: m.name, ns: m.ns }),
  ];
  return `${removalHeader(m)}\n${statements.join(`${BREAKPOINT}\n`)}`;
}

/** Split a drizzle migration into statements (breakpoints), trimming empties. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(BREAKPOINT)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Statements of the generated migration that are NOT about the module's tables — an unrelated
 * pending schema change that happened to be generated in the same run must survive the rewrite.
 */
export function unrelatedStatements(generatedSql: string, tables: readonly string[]): string[] {
  const mentions = (stmt: string) => tables.some((t) => new RegExp(`[\`"]${t}[\`"]`).test(stmt));
  return splitStatements(generatedSql).filter((s) => !/^--/.test(s) && !mentions(s));
}
