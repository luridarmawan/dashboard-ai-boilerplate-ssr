#!/usr/bin/env bun
/**
 * CI guard (ROADMAP §6, on since M0): generated MySQL DDL must state charset & collation on
 * every text-like column, and no dialect may use native enums (PRD §4.3).
 *
 * Checks the committed migration SQL — the artefact that actually reaches a database — not
 * the TypeScript that produced it. Exits 1 with file:line for every violation.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const problems: string[] = [];

function sqlFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

// MySQL / MariaDB: text-like column definitions need explicit CHARACTER SET + COLLATE.
const TEXT_COL = /^\s*`[^`]+`\s+(char|varchar|tinytext|text|mediumtext|longtext)\b/i;
for (const file of sqlFiles(join(root, 'packages/db/migrations/mysql'))) {
  const rel = file.replace(`${root}/`, '');
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (TEXT_COL.test(line) && !(/CHARACTER SET/i.test(line) && /COLLATE/i.test(line))) {
        problems.push(
          `${rel}:${i + 1}: kolom teks tanpa CHARACTER SET/COLLATE eksplisit — ${line.trim()}`,
        );
      }
      if (/\benum\s*\(/i.test(line)) {
        problems.push(`${rel}:${i + 1}: enum native dilarang (§4.3) — ${line.trim()}`);
      }
    });
}

// PostgreSQL: no native enum types either.
for (const file of sqlFiles(join(root, 'packages/db/migrations/pg'))) {
  const rel = file.replace(`${root}/`, '');
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/CREATE TYPE .* AS ENUM/i.test(line)) {
        problems.push(`${rel}:${i + 1}: enum native dilarang (§4.3) — ${line.trim()}`);
      }
    });
}

const checked =
  sqlFiles(join(root, 'packages/db/migrations/mysql')).length +
  sqlFiles(join(root, 'packages/db/migrations/pg')).length;

if (problems.length) {
  console.error(
    `ddl-guard: ${problems.length} pelanggaran di ${checked} berkas migrasi:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(
  `ddl-guard: ${checked} berkas migrasi bersih — semua kolom teks MySQL menyatakan charset, tidak ada enum native`,
);
