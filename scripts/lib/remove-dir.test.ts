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
import { removeDir, removeLinks } from './remove-dir.ts';

/**
 * Link a directory the way this repo actually meets links: `bun install` writes its workspace
 * links as NTFS junctions on Windows and as directory symlinks elsewhere. A junction also happens
 * to be the only kind Windows lets an unprivileged process create — a plain `symlinkSync` to a
 * file fails there with EPERM, so these tests always link a directory.
 */
const linkDir = (target: string, path: string) =>
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');

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
    linkDir(outside, join(inner, 'linked'));
    chmodSync(inner, 0o555);

    removeDir(root);

    expect(existsSync(root)).toBe(false);
    // The tree is gone, what it pointed at is not: a walk that followed the link would have taken
    // the shared file with it.
    expect(existsSync(target)).toBe(true);
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

/**
 * What `removeLinks` is for: git deletes a submodule's working tree with its own recursive walk
 * (`git submodule deinit -f`, `git rm -r`), and on Windows that walk goes *through* a junction —
 * uninstalling a module emptied `packages/*` because `modules/<Name>/node_modules/@core/db` points
 * there. So the links go first, and git only ever sees plain files.
 */
describe('removeLinks', () => {
  test('unlinks nested links and leaves their targets whole', () => {
    const outside = mkdtempSync(join(tmpdir(), 'remove-links-target-'));
    writeFileSync(join(outside, 'index.ts'), 'export const precious = 1;');
    const root = mkdtempSync(join(tmpdir(), 'remove-links-'));
    const scope = join(root, 'node_modules', '@core');
    mkdirSync(scope, { recursive: true });
    linkDir(outside, join(scope, 'db'));
    writeFileSync(join(root, 'module.json'), '{}');

    removeLinks(root);

    expect(existsSync(join(scope, 'db'))).toBe(false);
    expect(existsSync(join(outside, 'index.ts'))).toBe(true);
    // Only the links go: the module's own files are git's to delete.
    expect(existsSync(join(root, 'module.json'))).toBe(true);
    rmSync(outside, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  test('a directory that is not there is not an error', () => {
    const root = mkdtempSync(join(tmpdir(), 'remove-links-'));
    rmSync(root, { recursive: true, force: true });

    expect(() => removeLinks(root)).not.toThrow();
  });
});
