/**
 * Administrative regions: parsing a data set and loading it into the `regions` table.
 *
 * Two input formats, both read whole (the Indonesian set is ~90k rows, a few MB):
 *   - TSV (`.tsv`, or gzipped `.tsv.gz`), the format the repository ships:
 *       code<TAB>parent_code<TAB>country_code<TAB>level<TAB>name   (header line, empty parent = root)
 *   - a MySQL dump (`.sql`) of a table with at least the columns `code`, `parent_code`,
 *     `country_code`, `level`, `name` — the column list of each INSERT is honoured, other
 *     columns (`id`, timestamps, …) are ignored. Only INSERT … VALUES is read; nothing in the
 *     file is executed, so a dump from any source is safe to point at.
 *
 * Loading is an upsert by `code` written with portable queries only (no ON DUPLICATE KEY /
 * ON CONFLICT): unknown codes are inserted, changed rows updated, identical rows skipped. Rows
 * missing from the input are left alone — tenants and modules may still point at them.
 */
import { eq } from 'drizzle-orm';
import { type Db, schema } from './generated/active.ts';
import { newId } from './id.ts';

/** Level semantics, defined once. Indonesia: province → regency/city → district → village. */
export const REGION_LEVEL = {
  PROVINCE: 1,
  CITY: 2,
  DISTRICT: 3,
  VILLAGE: 4,
} as const;
export type RegionLevel = (typeof REGION_LEVEL)[keyof typeof REGION_LEVEL];

export interface RegionRow {
  readonly code: string;
  readonly parentCode: string | null;
  readonly countryCode: string;
  readonly level: number;
  readonly name: string;
}

/** Is `child` a direct or indirect descendant of `parent`? Codes are dotted paths (`11.01.01`). */
export function isRegionUnder(child: string, parent: string): boolean {
  return child.startsWith(`${parent}.`);
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

const CODE = /^[A-Za-z0-9.]{1,16}$/;

function checkRow(r: RegionRow, where: string): RegionRow {
  if (!CODE.test(r.code)) throw new Error(`${where}: kode wilayah tidak valid "${r.code}"`);
  if (r.parentCode !== null && !CODE.test(r.parentCode))
    throw new Error(`${where}: kode induk tidak valid "${r.parentCode}"`);
  if (!Number.isInteger(r.level) || r.level < 1 || r.level > 9)
    throw new Error(`${where}: level tidak valid "${r.level}"`);
  if (!r.name || r.name.length > 191) throw new Error(`${where}: nama kosong atau terlalu panjang`);
  if (!/^[A-Za-z]{2,3}$/.test(r.countryCode))
    throw new Error(`${where}: kode negara tidak valid "${r.countryCode}"`);
  return r;
}

export function parseRegionsTsv(text: string): RegionRow[] {
  const lines = text.split(/\r?\n/);
  const out: RegionRow[] = [];
  lines.forEach((line, i) => {
    if (i === 0 || line === '') return; // header
    const [code = '', parent = '', country = '', level = '', name = ''] = line.split('\t');
    out.push(
      checkRow(
        {
          code,
          parentCode: parent === '' ? null : parent,
          countryCode: country || 'ID',
          level: Number(level),
          name: name.trim(),
        },
        `baris ${i + 1}`,
      ),
    );
  });
  return out;
}

type SqlValue = string | number | null;

/**
 * Reads every `INSERT INTO <t> (<cols>) VALUES (…), (…);` in a MySQL dump. A tiny tokenizer, not
 * a SQL parser: quoted strings (backslash escapes and doubled quotes), NULL and numbers.
 */
export function parseRegionsSql(text: string): RegionRow[] {
  const out: RegionRow[] = [];
  const insert = /INSERT\s+INTO\s+[`"\w.]+\s*\(([^)]*)\)\s*VALUES\s*/gi;
  for (let m = insert.exec(text); m; m = insert.exec(text)) {
    const cols = (m[1] ?? '').split(',').map((c) => c.trim().replace(/[`"]/g, ''));
    const at = (name: string) => {
      const i = cols.indexOf(name);
      if (i < 0 && name !== 'country_code' && name !== 'parent_code')
        throw new Error(`INSERT tanpa kolom "${name}" — bukan tabel wilayah yang dikenali`);
      return i;
    };
    const idx = {
      code: at('code'),
      parent: at('parent_code'),
      country: at('country_code'),
      level: at('level'),
      name: at('name'),
    };
    let pos = insert.lastIndex;
    // Tuples until the terminating `;`.
    for (;;) {
      while (/\s|,/.test(text[pos] ?? '')) pos++;
      if (text[pos] !== '(') break;
      pos++;
      const values: SqlValue[] = [];
      for (;;) {
        while (/\s/.test(text[pos] ?? '')) pos++;
        const ch = text[pos];
        if (ch === "'") {
          let s = '';
          pos++;
          for (;;) {
            const c = text[pos];
            if (c === undefined) throw new Error('string tidak ditutup di dump SQL');
            if (c === '\\') {
              const n = text[pos + 1] ?? '';
              s += n === 'n' ? '\n' : n === 't' ? '\t' : n === '0' ? '' : n;
              pos += 2;
            } else if (c === "'" && text[pos + 1] === "'") {
              s += "'";
              pos += 2;
            } else if (c === "'") {
              pos++;
              break;
            } else {
              s += c;
              pos++;
            }
          }
          values.push(s);
        } else {
          const tok = /^[^,)\s]+/.exec(text.slice(pos, pos + 64))?.[0] ?? '';
          pos += tok.length;
          values.push(tok.toUpperCase() === 'NULL' ? null : Number(tok));
        }
        while (/\s/.test(text[pos] ?? '')) pos++;
        if (text[pos] === ',') {
          pos++;
          continue;
        }
        if (text[pos] === ')') {
          pos++;
          break;
        }
        throw new Error(`dump SQL tidak terbaca di posisi ${pos}`);
      }
      const v = (i: number) => (i < 0 ? null : (values[i] ?? null));
      const parent = v(idx.parent);
      out.push(
        checkRow(
          {
            code: String(v(idx.code)),
            parentCode: parent === null || parent === '' ? null : String(parent),
            countryCode: String(v(idx.country) ?? 'ID'),
            level: Number(v(idx.level)),
            name: String(v(idx.name) ?? '').trim(),
          },
          `baris data ke-${out.length + 1}`,
        ),
      );
    }
    insert.lastIndex = pos;
  }
  return out;
}

/** Picks the parser from the file name; `.gz` is gunzipped first. */
export function parseRegionsFile(name: string, bytes: Uint8Array<ArrayBuffer>): RegionRow[] {
  const raw = name.endsWith('.gz') ? Bun.gunzipSync(bytes) : bytes;
  const text = new TextDecoder().decode(raw);
  const base = name.replace(/\.gz$/, '');
  if (base.endsWith('.sql')) return parseRegionsSql(text);
  if (base.endsWith('.tsv')) return parseRegionsTsv(text);
  throw new Error(`format tidak dikenal: ${name} (pakai .tsv, .tsv.gz, atau .sql)`);
}

/** The TSV the repository ships: one line per row, parents before children. */
export function toRegionsTsv(rows: readonly RegionRow[]): string {
  const sorted = [...rows].sort((a, b) => a.level - b.level || (a.code < b.code ? -1 : 1));
  const lines = sorted.map((r) =>
    [r.code, r.parentCode ?? '', r.countryCode, r.level, r.name.replace(/[\t\r\n]/g, ' ')].join(
      '\t',
    ),
  );
  return `code\tparent_code\tcountry_code\tlevel\tname\n${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

export interface RegionImportResult {
  readonly total: number;
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
}

const BATCH = 500;

export async function importRegions(
  db: Db,
  rows: readonly RegionRow[],
  opts: { log?: (msg: string) => void } = {},
): Promise<RegionImportResult> {
  const log = opts.log ?? (() => {});
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.code)) throw new Error(`kode wilayah ganda di data: ${r.code}`);
    seen.add(r.code);
  }
  const existing = new Map<string, Omit<RegionRow, 'code'> & { id: string }>();
  for (const e of await db
    .select({
      id: schema.regions.id,
      code: schema.regions.code,
      parentCode: schema.regions.parent_code,
      countryCode: schema.regions.country_code,
      level: schema.regions.level,
      name: schema.regions.name,
    })
    .from(schema.regions)) {
    existing.set(e.code, e);
  }
  const fresh: RegionRow[] = [];
  const changed: (RegionRow & { id: string })[] = [];
  for (const r of rows) {
    const e = existing.get(r.code);
    if (!e) fresh.push(r);
    else if (
      e.name !== r.name ||
      e.parentCode !== r.parentCode ||
      e.level !== r.level ||
      e.countryCode !== r.countryCode
    )
      changed.push({ ...r, id: e.id });
  }
  for (let i = 0; i < fresh.length; i += BATCH) {
    await db.insert(schema.regions).values(
      fresh.slice(i, i + BATCH).map((r) => ({
        id: newId(),
        code: r.code,
        parent_code: r.parentCode,
        country_code: r.countryCode,
        level: r.level,
        name: r.name,
      })),
    );
    if ((i / BATCH) % 20 === 19) log(`regions: ${i + BATCH}/${fresh.length} baris baru`);
  }
  for (const r of changed) {
    await db
      .update(schema.regions)
      .set({
        parent_code: r.parentCode,
        country_code: r.countryCode,
        level: r.level,
        name: r.name,
      })
      .where(eq(schema.regions.id, r.id));
  }
  return {
    total: rows.length,
    inserted: fresh.length,
    updated: changed.length,
    unchanged: rows.length - fresh.length - changed.length,
  };
}
