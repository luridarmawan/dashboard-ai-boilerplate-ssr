#!/usr/bin/env bun
/**
 * `bun run clean` — delete every `node_modules` in the workspace: the root one and the one each
 * workspace package gets from `bun install`.
 *
 * Why a script and not `rm -rf node_modules`: `rm -rf` does not exist on a plain Windows shell,
 * and the tree is full of links. `bun install` links workspace dependencies as NTFS junctions on
 * Windows (`packages/auth/node_modules/@core/db` → `packages/db`), so a delete that walks *through*
 * a junction empties the package it points at. `removeDir` unlinks the link itself instead, on
 * every platform (`scripts/lib/remove-dir.ts`) — the same command is therefore safe from
 * PowerShell, cmd, Git Bash, WSL, Linux and macOS.
 *
 * When it is needed: `bun install` was run from two different shells on Windows. Bun launched from
 * Git Bash writes links Windows cannot resolve, so the next install from PowerShell or cmd fails
 * with one `EEXIST: File exists: failed to symlink dependencies for package: …` per workspace and
 * leaves the install half finished. Clean, then install again from the shell you will keep using
 * (`docs/Build-Module-for-Your-Apps.md` §2).
 *
 * Only `node_modules` is removed. Generated output belongs to `bootstrap`, which rewrites it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Glob } from 'bun';
import { removeDir } from './lib/remove-dir.ts';

/**
 * Every directory that can hold a `node_modules`: the workspace root, plus each folder matched by
 * the root `workspaces` globs. Reading the globs keeps this in step with `package.json` — a new
 * `apps/*` or `modules/*` package needs no change here. Matches under an existing `node_modules`
 * are skipped: those are installed dependencies, and the root delete takes them with it.
 */
export async function packageDirs(root: string): Promise<string[]> {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    workspaces?: string[];
  };
  const dirs = new Set<string>();
  for (const pattern of pkg.workspaces ?? []) {
    for await (const match of new Glob(`${pattern}/package.json`).scan({ cwd: root, dot: false })) {
      if (match.includes('node_modules/')) continue;
      dirs.add(join(root, match, '..'));
    }
  }
  return [root, ...[...dirs].sort()];
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  let removed = 0;
  let failed = 0;
  for (const dir of await packageDirs(root)) {
    const target = join(dir, 'node_modules');
    if (!existsSync(target)) continue;
    const label = relative(root, target).split('\\').join('/') || 'node_modules';
    const started = performance.now();
    try {
      removeDir(target);
      removed++;
      console.log(
        `  ✓ ${label.padEnd(40)} ${String(Math.round(performance.now() - started)).padStart(6)} ms`,
      );
    } catch (err) {
      failed++;
      console.log(`  ✗ ${label.padEnd(40)} ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failed) {
    console.error(
      `clean: ${failed} folder gagal dihapus — tutup editor atau proses yang memakainya, lalu ulangi`,
    );
    process.exit(1);
  }
  console.log(
    removed
      ? `clean: ${removed} folder node_modules dihapus — jalankan \`bun install\` lagi`
      : 'clean: tidak ada node_modules yang perlu dihapus',
  );
}
