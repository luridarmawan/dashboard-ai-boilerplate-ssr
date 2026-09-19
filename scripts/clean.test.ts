import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { packageDirs } from './clean.ts';

/**
 * `bun run clean` deletes `node_modules` per workspace folder, so what it deletes is decided
 * entirely by which folders it lists. The two cases that matter: a workspace glob must be read
 * from `package.json` (adding `modules/Contact` must not need a change in the script), and an
 * already-installed dependency that happens to carry a `package.json` must never be listed as a
 * workspace of its own — that path is inside the root `node_modules` the script is about to remove.
 */
describe('packageDirs', () => {
  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'clean-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ workspaces: ['apps/*', 'packages/*', 'modules/*'] }),
    );
    for (const dir of ['apps/web', 'packages/db', 'modules/Example']) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'package.json'), '{}');
    }
    return root;
  };

  test('lists the root and every workspace folder', async () => {
    const root = fixture();

    const found = (await packageDirs(root)).map((d) => relative(root, d).split('\\').join('/'));

    expect(found).toEqual(['', 'apps/web', 'modules/Example', 'packages/db']);
    rmSync(root, { recursive: true, force: true });
  });

  test('an installed dependency is not mistaken for a workspace', async () => {
    const root = fixture();
    const dep = join(root, 'packages', 'db', 'node_modules', 'left-pad');
    mkdirSync(dep, { recursive: true });
    writeFileSync(join(dep, 'package.json'), '{}');

    const found = (await packageDirs(root)).map((d) => relative(root, d).split('\\').join('/'));

    expect(found).not.toContain('packages/db/node_modules/left-pad');
    expect(found).toHaveLength(4);
    rmSync(root, { recursive: true, force: true });
  });
});
