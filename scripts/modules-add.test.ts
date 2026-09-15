import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modulesFileSchema } from '@core/module-kit';

/**
 * `bun modules:add <git-url> --ref <tag|commit>` — the host side of installing a module that lives
 * in another repository (docs/Build-Module-for-Your-Apps.md §6). The happy path is proved end to
 * end by `bun run ci:cross-repo` (it needs git and a network-ish clone); what is checked here are
 * the refusals, which must all happen BEFORE the script touches the working tree — a half-added
 * submodule is the one failure mode the tutorial cannot talk a reader out of.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const modulesFile = join(root, 'modules.json');

function add(args: string[]) {
  const before = readFileSync(modulesFile, 'utf8');
  const p = Bun.spawnSync(['bun', 'run', 'scripts/modules-add.ts', ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  // Every refusal below must leave modules.json exactly as it was.
  expect(readFileSync(modulesFile, 'utf8')).toBe(before);
  return {
    code: p.exitCode ?? 1,
    out: `${p.stdout.toString()}${p.stderr.toString()}`,
  };
}

const USAGE = 'bun modules:add <git-url> --ref <tag|commit>';

describe('bun modules:add — refusals before anything is installed (§6)', () => {
  test('a git URL is required', () => {
    const r = add([]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('git-url wajib');
    expect(r.out).toContain(USAGE);
  });

  test('--ref is mandatory, and the message says tag or commit — never a branch (Decision L)', () => {
    const r = add(['https://example.test/mod-billing.git']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('--ref wajib');
    expect(r.out).toContain('bukan branch');
  });

  test('a name that is already in modules.json is refused without cloning', () => {
    const installed = modulesFileSchema.parse(JSON.parse(readFileSync(modulesFile, 'utf8')));
    const name = installed.modules[0]?.name;
    expect(name).toBeDefined();

    const r = add(['https://example.test/mod.git', '--ref', 'v1.0.0', '--name', String(name)]);

    expect(r.code).toBe(1);
    expect(r.out).toContain(`modul "${name}" sudah terdaftar`);
  });

  test('a name that is not folder-cased is refused (G-9)', () => {
    const r = add(['https://example.test/mod.git', '--ref', 'v1.0.0', '--name', 'billing']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('nama modul "billing" tidak valid');
  });
});

describe('what a successful install records (§6)', () => {
  test('modules.json accepts the submodule entry shape the script writes', () => {
    const entry = {
      name: 'Billing',
      source: 'submodule',
      repo: 'https://github.com/tim/mod-billing.git',
      ref: 'v1.4.2',
      path: 'modules/Billing',
    };

    const parsed = modulesFileSchema.parse({ modules: [entry] });

    expect(parsed.modules[0]).toEqual(entry);
    // A submodule source without a ref is not a source at all: the build must be reproducible
    // from modules.json alone (Q-5).
    expect(() => modulesFileSchema.parse({ modules: [{ ...entry, ref: undefined }] })).toThrow();
  });

  test('the host keeps its own linter off foreign code — biome.json excludes every submodule', () => {
    const biome = JSON.parse(readFileSync(join(root, 'biome.json'), 'utf8')) as {
      files?: { includes?: string[] };
    };
    const installed = modulesFileSchema.parse(JSON.parse(readFileSync(modulesFile, 'utf8')));
    const includes = biome.files?.includes ?? [];

    for (const m of installed.modules) {
      if (m.source !== 'submodule') continue;
      const path = m.path ?? `modules/${m.name}`;
      expect(includes).toContain(`!${path}/**`);
    }
    // Vendored (`local`) modules are linted by the host like its own code (§7c) — no exclusion.
    for (const m of installed.modules) {
      if (m.source !== 'local') continue;
      expect(includes).not.toContain(`!${m.path}/**`);
    }
  });
});
