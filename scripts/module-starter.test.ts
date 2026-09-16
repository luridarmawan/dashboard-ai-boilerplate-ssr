import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The starter a module author gets from `bun create module` (G-12), and the two scripts that come
 * with it: `bun run rename <Name>` and `harness.ts`. Contracts promised in
 * docs/Build-Module-for-Your-Apps.md §0–§4 — the template is the only thing an outsider sees, so a
 * drift here breaks the tutorial rather than a build.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const template = join(root, '.bun-create', 'module');

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  const p = Bun.spawnSync(['bun', 'run', ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: p.exitCode ?? 1,
    out: `${p.stdout.toString()}${p.stderr.toString()}`,
  };
}

describe('bun create module — the starter template (§0, §1, §4)', () => {
  const pkg = readJson(join(template, 'package.json'));
  const scripts = pkg.scripts as Record<string, string>;

  test('exactly four scripts — rename, harness, typecheck, test; no `dev` to mislead', () => {
    expect(Object.keys(scripts).sort()).toEqual(['harness', 'rename', 'test', 'typecheck']);
    expect(scripts.rename).toBe('bun run rename.ts');
    // The three others all go through the harness: a module is only whole inside a core (§2).
    expect(scripts.harness).toBe('bun run harness.ts');
    expect(scripts.typecheck).toBe('bun run harness.ts');
    expect(scripts.test).toBe('bun run harness.ts');
  });

  test('the core to build against is recorded in package.json and overridable (§2)', () => {
    const core = pkg.core as { repo?: string; ref?: string };
    expect(core.repo).toMatch(/^https:\/\/.*\.git$/);
    expect(core.ref).toBe('main');
    const harness = readFileSync(join(template, 'harness.ts'), 'utf8');
    for (const v of ['CORE_DIR', 'CORE_REPO', 'CORE_REF']) {
      expect(harness).toContain(`process.env.${v}`);
    }
  });

  test('no license field — the module author picks their own (§0)', () => {
    expect(pkg.license).toBeUndefined();
    expect(readJson(join(template, 'module.json')).license).toBeUndefined();
  });

  test('the promised worked examples ship with it: hook, job, widget, tool, integration test (§1)', () => {
    for (const file of [
      'hooks.ts',
      'jobs.ts',
      'widgets.ts',
      'api/tools.ts',
      'api/routes.ts',
      'db/tables.ts',
      'permissions.ts',
      'menu.ts',
      'test/integration/hello.test.ts',
      'rename.ts',
      'harness.ts',
    ]) {
      expect(existsSync(join(template, file))).toBe(true);
    }
  });

  test('the CI it ships runs the same harness against a MySQL service (§4)', () => {
    const ci = readFileSync(join(template, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('bun run harness --web');
    expect(ci).toContain('mysql:8');
    expect(ci).toContain('DATABASE_URL: mysql://');
  });
});

describe('bun run rename <Name> — namespace rewrite in place (§1)', () => {
  let dir = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'module-starter-'));
    cpSync(template, join(dir, 'mod-billing'), { recursive: true });
    dir = join(dir, 'mod-billing');
    const r = run(dir, ['rename.ts', 'Billing']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Hello → Billing');
  });

  afterAll(() => {
    if (dir) rmSync(join(dir, '..'), { recursive: true, force: true });
  });

  test('identity: module.json, package name', () => {
    expect(readJson(join(dir, 'module.json')).name).toBe('Billing');
    expect(readJson(join(dir, 'package.json')).name).toBe('@modules/billing');
  });

  test('namespace: tables, permissions, menu id and href, i18n keys (G-9)', () => {
    expect(readFileSync(join(dir, 'db/tables.ts'), 'utf8')).toContain("name: 'billing_notes'");
    expect(readFileSync(join(dir, 'permissions.ts'), 'utf8')).toContain("resource: 'billing.note'");
    const menu = readFileSync(join(dir, 'menu.ts'), 'utf8');
    expect(menu).toContain("id: 'billing.notes'");
    expect(menu).toContain("href: '/m/billing/notes'");
    const keys = Object.keys(readJson(join(dir, 'i18n/id.json')));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !k.startsWith('billing.'))).toEqual([]);
  });

  test('files named after the old namespace are renamed too', () => {
    expect(existsSync(join(dir, 'test/integration/billing.test.ts'))).toBe(true);
    expect(existsSync(join(dir, 'test/integration/hello.test.ts'))).toBe(false);
  });

  test('nothing of the old name survives anywhere but rename.ts itself', () => {
    const grep = Bun.spawnSync(['grep', '-ril', '--exclude=rename.ts', 'hello', '.'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(grep.stdout.toString().trim()).toBe('');
  });

  test('running it again is a no-op, and a non-PascalCase name is refused', () => {
    const again = run(dir, ['rename.ts', 'Billing']);
    expect(again.code).toBe(0);
    expect(again.out).toContain('sudah bernama Billing');

    const bad = run(dir, ['rename.ts', 'billing']);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('PascalCase');
    expect(readJson(join(dir, 'module.json')).name).toBe('Billing');
  });
});

describe('bun run rename — repairing what `bun create` overwrites (§1)', () => {
  test('the folder name bun create writes into package.json is put back to @modules/<ns>', () => {
    // `bun create module ../mod-billing` sets package.json's name to the destination folder,
    // destroying the `@modules/hello` the rename would otherwise have rewritten.
    const dir = mkdtempSync(join(tmpdir(), 'module-created-'));
    cpSync(template, join(dir, 'mod-billing'), { recursive: true });
    const mod = join(dir, 'mod-billing');
    const pkgFile = join(mod, 'package.json');
    writeFileSync(pkgFile, JSON.stringify({ ...readJson(pkgFile), name: 'mod-billing' }, null, 2));

    expect(run(mod, ['rename.ts', 'Billing']).code).toBe(0);

    expect(readJson(pkgFile).name).toBe('@modules/billing');
    expect(readJson(join(mod, 'module.json')).name).toBe('Billing');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('harness.ts — it needs a core, and says which one is missing (§2)', () => {
  let dir = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'module-harness-'));
    cpSync(template, join(dir, 'mod'), { recursive: true });
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('CORE_DIR that is not a core checkout fails before touching anything', () => {
    const notCore = join(dir, 'not-a-core');
    mkdirSync(notCore, { recursive: true });

    const r = run(join(dir, 'mod'), ['harness.ts'], { CORE_DIR: notCore });

    expect(r.code).toBe(1);
    expect(r.out).toContain('bukan checkout core');
    expect(existsSync(join(notCore, 'modules'))).toBe(false);
  });

  test('no CORE_DIR and no core repo to clone: it asks for one instead of guessing', () => {
    const r = run(join(dir, 'mod'), ['harness.ts'], { CORE_REPO: '' });

    expect(r.code).toBe(1);
    expect(r.out).toContain('"core": { "repo", "ref" }');
    expect(existsSync(join(dir, 'mod', '.core'))).toBe(false);
  });
});
