import { describe, expect, test } from 'bun:test';
import {
  isRegionUnder,
  parseRegionsFile,
  parseRegionsSql,
  parseRegionsTsv,
  toRegionsTsv,
} from '../src/regions.ts';

const DUMP = `/*!40101 SET NAMES utf8 */;
DROP TABLE IF EXISTS \`x_regions\`;
INSERT INTO \`x_regions\` (\`id\`, \`code\`, \`parent_code\`, \`country_code\`, \`level\`, \`name\`, \`status_id\`) VALUES
	('a', '11', NULL, 'ID', 1, 'ACEH', 1),
	('b', '11.01', '11', 'ID', 2, 'KAB. ACEH SELATAN', 1),
	('c', '11.01.02.2018', '11.01.02', 'ID', 4, 'Pasi Kuala Ba\\'u', 1);
INSERT INTO \`x_regions\` (\`code\`, \`level\`, \`name\`, \`parent_code\`) VALUES ('12', 1, 'O''o, (Sumut); x', NULL);
`;

describe('regions data', () => {
  test('a MySQL dump: column list honoured, both quote escapes, punctuation inside strings', () => {
    const rows = parseRegionsSql(DUMP);
    expect(rows.map((r) => r.code)).toEqual(['11', '11.01', '11.01.02.2018', '12']);
    expect(rows[0]).toEqual({
      code: '11',
      parentCode: null,
      countryCode: 'ID',
      level: 1,
      name: 'ACEH',
    });
    expect(rows[2]?.name).toBe("Pasi Kuala Ba'u");
    expect(rows[3]?.name).toBe("O'o, (Sumut); x");
    expect(rows[3]?.countryCode).toBe('ID'); // column absent → default
  });
  test('TSV round trip keeps every field; parents come first', () => {
    const rows = parseRegionsSql(DUMP);
    const back = parseRegionsTsv(toRegionsTsv(rows));
    expect(back.map((r) => r.code)).toEqual(['11', '12', '11.01', '11.01.02.2018']);
    expect(back.find((r) => r.code === '11.01.02.2018')).toEqual(
      rows.find((r) => r.code === '11.01.02.2018') as never,
    );
  });
  test('the file name picks the format, gzip included', () => {
    const tsv = toRegionsTsv(parseRegionsSql(DUMP));
    const gz = Bun.gzipSync(new TextEncoder().encode(tsv));
    expect(parseRegionsFile('r.tsv.gz', gz)).toHaveLength(4);
    expect(parseRegionsFile('r.sql', new TextEncoder().encode(DUMP))).toHaveLength(4);
    expect(() => parseRegionsFile('r.csv', new Uint8Array())).toThrow('format tidak dikenal');
  });
  test('bad data is refused, not stored', () => {
    expect(() => parseRegionsTsv('h\n11;drop\t\tID\t1\tX\n')).toThrow('kode wilayah');
    expect(() => parseRegionsTsv('h\n11\t\tID\t0\tX\n')).toThrow('level');
  });
  test('codes are dotted paths', () => {
    expect(isRegionUnder('11.01.01', '11.01')).toBe(true);
    expect(isRegionUnder('11.01.01', '11')).toBe(true);
    expect(isRegionUnder('110.01', '11')).toBe(false);
    expect(isRegionUnder('11', '11')).toBe(false);
  });
  test('the shipped data set parses and is a consistent tree', async () => {
    const bytes = new Uint8Array(
      await Bun.file(new URL('../data/regions-id.tsv.gz', import.meta.url)).arrayBuffer(),
    );
    const rows = parseRegionsFile('regions-id.tsv.gz', bytes);
    expect(rows.length).toBeGreaterThan(90_000);
    const codes = new Set(rows.map((r) => r.code));
    expect(codes.size).toBe(rows.length);
    for (const r of rows) {
      if (r.parentCode === null) expect(r.level).toBe(1);
      else {
        expect(codes.has(r.parentCode)).toBe(true);
        expect(isRegionUnder(r.code, r.parentCode)).toBe(true);
      }
    }
  });
});
