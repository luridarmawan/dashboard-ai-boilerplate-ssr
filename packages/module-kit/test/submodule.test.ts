import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncError, syncModules } from '../src/sync.ts';

/**
 * A module installed from another repository is a git submodule pinned to a tag (Decision L,
 * G-10; docs/Build-Module-for-Your-Apps.md §6 and §7b). These tests build a real host repo with a
 * real submodule and prove what sync promises about it: the checkout must be exactly the pinned
 * ref, a drifted checkout names both commits, an un-initialised submodule is brought in by sync
 * itself, and local edits inside the submodule are only warned about.
 */

const GIT_ENV: Record<string, string> = {
  ...(process.env as Record<string, string>),
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.test',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

function git(cwd: string, args: string[]): string {
  const p = Bun.spawnSync(['git', '-c', 'protocol.file.allow=always', ...args], {
    cwd,
    env: GIT_ENV,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (p.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} (in ${cwd}): ${p.stderr.toString().trim()}`);
  }
  return p.stdout.toString().trim();
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const MANIFEST = {
  name: 'Billing',
  version: '0.1.0',
  engines: { core: '>=1.0.0' },
};

let tmp = '';
/** The module's own repository: tag v0.1.0, then one more commit on top of it (the drift). */
let upstream = '';
let tagged = '';
let drifted = '';

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'module-kit-submodule-'));
  upstream = join(tmp, 'mod-billing');
  mkdirSync(upstream, { recursive: true });
  git(upstream, ['init', '--quiet', '-b', 'main']);
  writeJson(join(upstream, 'module.json'), MANIFEST);
  git(upstream, ['add', '-A']);
  git(upstream, ['commit', '--quiet', '-m', 'module Billing']);
  git(upstream, ['tag', 'v0.1.0']);
  tagged = git(upstream, ['rev-parse', 'HEAD']);
  writeFileSync(join(upstream, 'README.md'), '# Billing\n');
  git(upstream, ['add', '-A']);
  git(upstream, ['commit', '--quiet', '-m', 'unreleased work']);
  drifted = git(upstream, ['rev-parse', 'HEAD']);
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** A host repo with the module installed the way `bun modules:add` installs it. */
function makeHost(ref: string): string {
  const host = mkdtempSync(join(tmp, 'host-'));
  git(host, ['init', '--quiet', '-b', 'main']);
  // `git submodule update --init` inside sync runs plain git; allow the file transport repo-wide.
  git(host, ['config', 'protocol.file.allow', 'always']);
  writeJson(join(host, 'package.json'), { name: 'host', version: '1.2.3' });
  writeJson(join(host, 'modules.json'), { modules: [] });
  git(host, ['add', '-A']);
  git(host, ['commit', '--quiet', '-m', 'host']);
  git(host, ['submodule', 'add', '--quiet', '--', upstream, 'modules/Billing']);
  git(join(host, 'modules/Billing'), ['checkout', '--quiet', '--detach', ref]);
  git(host, ['add', '-A']);
  git(host, ['commit', '--quiet', '-m', 'install Billing']);
  return host;
}

/** What `bun modules:add <url> --ref <tag>` records in modules.json (§6). */
function pin(host: string, ref: string): void {
  writeJson(join(host, 'modules.json'), {
    modules: [
      { name: 'Billing', source: 'submodule', repo: upstream, ref, path: 'modules/Billing' },
    ],
  });
}

const sync = (root: string) => syncModules({ root, write: false, coreIcons: [] });

describe('syncModules — submodule pinned to a ref (Decision L, G-10)', () => {
  test('a checkout that is exactly the pinned tag loads as a submodule module', async () => {
    const host = makeHost('v0.1.0');
    pin(host, 'v0.1.0');

    const r = await sync(host);

    expect(r.modules.map((m) => m.name)).toEqual(['Billing']);
    expect(r.modules[0]?.source).toBe('submodule');
    expect(r.modules[0]?.path).toBe('modules/Billing');
    expect(r.warnings).toEqual([]);
  });

  test('a drifted checkout fails and names both commits plus the checkout to run', async () => {
    const host = makeHost('v0.1.0');
    pin(host, 'v0.1.0');
    git(join(host, 'modules/Billing'), ['checkout', '--quiet', '--detach', drifted]);

    const err = (await sync(host).catch((e: unknown) => e)) as SyncError;

    expect(err).toBeInstanceOf(SyncError);
    expect(err.message).toContain(tagged.slice(0, 12));
    expect(err.message).toContain(drifted.slice(0, 12));
    expect(err.message).toContain('git -C modules/Billing checkout v0.1.0');
  });

  test('a ref that does not exist in the submodule is reported as unverifiable', async () => {
    const host = makeHost('v0.1.0');
    pin(host, 'v9.9.9');

    const err = (await sync(host).catch((e: unknown) => e)) as SyncError;

    expect(err).toBeInstanceOf(SyncError);
    expect(err.message).toContain('tidak bisa memverifikasi ref "v9.9.9"');
  });

  test('an un-initialised submodule is initialised by sync itself (a fresh clone of the host)', async () => {
    const host = makeHost('v0.1.0');
    pin(host, 'v0.1.0');
    git(host, ['submodule', 'deinit', '--force', '--', 'modules/Billing']);

    const r = await sync(host);

    expect(r.modules.map((m) => m.name)).toEqual(['Billing']);
    expect(git(join(host, 'modules/Billing'), ['rev-parse', 'HEAD'])).toBe(tagged);
  });

  test('editing the submodule folder on the host is warned about, not refused (§4.9 point 5)', async () => {
    const host = makeHost('v0.1.0');
    pin(host, 'v0.1.0');
    writeFileSync(join(host, 'modules/Billing/module.json'), `${JSON.stringify(MANIFEST)}\n`);

    const r = await sync(host);

    expect(r.modules.map((m) => m.name)).toEqual(['Billing']);
    expect(r.warnings.join('\n')).toContain('dimodifikasi lokal');
  });

  test('engines.core is checked for submodule modules too (G-11)', async () => {
    const host = makeHost('v0.1.0');
    pin(host, 'v0.1.0');
    writeJson(join(host, 'modules/Billing/module.json'), {
      ...MANIFEST,
      engines: { core: '>=9.0.0' },
    });

    const err = (await sync(host).catch((e: unknown) => e)) as SyncError;

    expect(err).toBeInstanceOf(SyncError);
    expect(err.message).toContain('butuh core >=9.0.0, terpasang 1.2.3');
  });
});
