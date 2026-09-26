import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '../../..');

/** Every UI catalog: the core one plus each module's `i18n/` folder. */
function catalogs(): string[] {
  const files = readdirSync(join(root, 'packages/i18n/messages')).map((f) =>
    join(root, 'packages/i18n/messages', f),
  );
  for (const mod of readdirSync(join(root, 'modules'), { withFileTypes: true })) {
    if (!mod.isDirectory()) continue;
    const dir = join(root, 'modules', mod.name, 'i18n');
    try {
      for (const f of readdirSync(dir)) files.push(join(dir, f));
    } catch {
      // module without translations
    }
  }
  return files.filter((f) => f.endsWith('.json'));
}

describe('UI copy', () => {
  test('carries no internal spec codes like A-1 or L-24', () => {
    const offenders: string[] = [];
    for (const file of catalogs()) {
      const messages = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      for (const [key, text] of Object.entries(messages)) {
        if (/\b(?:FR-)?[A-Z]{1,2}-\d+\b|\bPRD\b/.test(text)) offenders.push(`${file}: ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
