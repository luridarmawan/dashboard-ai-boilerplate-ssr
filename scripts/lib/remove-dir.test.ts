import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDir } from './remove-dir.ts';

/**
 * `modules:add` and `modules:remove` delete git checkouts, whose pack files git marks read-only.
 * On Windows that makes a plain delete fail with EPERM and leave half a tree behind — the failure
 * a module install actually hit. The read-only directory below is the portable stand-in: on Linux
 * and macOS it blocks the unlink the same way.
 */
describe('removeDir', () => {
  test('deletes a tree whose files and directories are read-only', () => {
    const root = mkdtempSync(join(tmpdir(), 'remove-dir-'));
    const packs = join(root, '.git', 'objects', 'pack');
    mkdirSync(packs, { recursive: true });
    writeFileSync(join(packs, 'pack-abc.pack'), 'x');
    writeFileSync(join(packs, 'pack-abc.idx'), 'x');
    writeFileSync(join(root, 'module.json'), '{}');
    chmodSync(join(packs, 'pack-abc.pack'), 0o444);
    chmodSync(join(packs, 'pack-abc.idx'), 0o444);
    chmodSync(packs, 0o555);

    removeDir(root);

    expect(existsSync(root)).toBe(false);
  });

  test('a symlink is unlinked without touching what it points at', () => {
    const outside = mkdtempSync(join(tmpdir(), 'remove-dir-target-'));
    const target = join(outside, 'shared.txt');
    writeFileSync(target, 'x');
    chmodSync(target, 0o444);
    const root = mkdtempSync(join(tmpdir(), 'remove-dir-'));
    const inner = join(root, 'node_modules');
    mkdirSync(inner, { recursive: true });
    symlinkSync(target, join(inner, 'linked.txt'));
    chmodSync(inner, 0o555);

    removeDir(root);

    expect(existsSync(root)).toBe(false);
    // chmod follows symlinks, so a careless unlock would have made the shared file writable.
    expect(statSync(target).mode & 0o777).toBe(0o444);
    rmSync(outside, { recursive: true, force: true });
  });

  test('a directory that is not there is not an error', () => {
    const root = mkdtempSync(join(tmpdir(), 'remove-dir-'));
    rmSync(root, { recursive: true, force: true });

    expect(() => removeDir(root)).not.toThrow();
  });
});
