/**
 * One-off: turn a regions dump (`.sql`/`.tsv`) into the gzipped TSV the repository ships.
 *   bun run packages/db/scripts/regions-convert.ts <input> [output=packages/db/data/regions-id.tsv.gz]
 */
import { parseRegionsFile, toRegionsTsv } from '../src/regions.ts';

const [input, output = 'packages/db/data/regions-id.tsv.gz'] = process.argv.slice(2);
if (!input) {
  console.error('pemakaian: regions-convert <input.sql|.tsv> [output.tsv.gz]');
  process.exit(2);
}
const rows = parseRegionsFile(input, new Uint8Array(await Bun.file(input).arrayBuffer()));
const tsv = toRegionsTsv(rows);
await Bun.write(output, Bun.gzipSync(new TextEncoder().encode(tsv), { level: 9 }));
const byLevel = new Map<number, number>();
for (const r of rows) byLevel.set(r.level, (byLevel.get(r.level) ?? 0) + 1);
console.log(`regions-convert: ${rows.length} baris → ${output}`, Object.fromEntries(byLevel));
