import { describe, expect, test } from 'bun:test';
import { catalogSchema, compareCatalog, compareSemver, searchCatalog } from '../src/catalog.ts';

const catalog = catalogSchema.parse({
  modules: [
    {
      name: 'AI',
      version: '0.1.0',
      repo: 'https://x/core.git',
      ref: 'v1',
      bundled: true,
      engines: { core: '*' },
    },
    {
      name: 'Billing',
      version: '1.2.0',
      repo: 'git@x:billing.git',
      ref: 'v1.2.0',
      engines: { core: '>=0.1.0' },
      tags: ['finance'],
      description: { id: 'Tagihan', en: 'Invoices' },
    },
    {
      name: 'Legacy',
      version: '9.0.0',
      repo: 'git@x:legacy.git',
      ref: 'v9',
      engines: { core: '>=99.0.0' },
    },
    {
      name: 'Example',
      version: '0.2.0',
      repo: 'https://x/core.git',
      ref: 'v2',
      bundled: true,
      engines: { core: '*' },
    },
  ],
});

describe('module catalog (G-16)', () => {
  test('semver order, prerelease below release', () => {
    expect(compareSemver('1.2.0', '1.10.0')).toBe(-1);
    expect(compareSemver('2.0.0', '1.99.99')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBe(-1);
  });
  test('status per entry: installed / update / available / incompatible; install command only when useful', () => {
    const v = compareCatalog(
      catalog,
      [
        { name: 'AI', version: '0.1.0' },
        { name: 'Example', version: '0.1.0' },
      ],
      '0.5.0',
    );
    const by = Object.fromEntries(v.map((e) => [e.name, e]));
    expect(by.AI?.status).toBe('installed');
    expect(by.AI?.installCommand).toBeNull();
    expect(by.Example?.status).toBe('update'); // bundled: an update means "upgrade core"
    expect(by.Example?.installCommand).toBeNull();
    expect(by.Billing?.status).toBe('available');
    expect(by.Billing?.installCommand).toBe('bun modules:add git@x:billing.git --ref v1.2.0');
    expect(by.Legacy?.status).toBe('incompatible');
    expect(by.Legacy?.installCommand).toBeNull();
  });
  test('unknown core version never marks anything incompatible', () => {
    expect(compareCatalog(catalog, [], null).find((e) => e.name === 'Legacy')?.status).toBe(
      'available',
    );
  });
  test('search covers name, description and tags, case-insensitively', () => {
    expect(searchCatalog(catalog.modules, 'FINANCE').map((e) => e.name)).toEqual(['Billing']);
    expect(searchCatalog(catalog.modules, 'tagihan').map((e) => e.name)).toEqual(['Billing']);
    expect(searchCatalog(catalog.modules, '').length).toBe(4);
  });
  test('the schema refuses a branch-less, name-less or non-semver entry', () => {
    expect(
      catalogSchema.safeParse({
        modules: [{ name: 'bad', version: '1', repo: 'x', ref: 'v1', engines: { core: '*' } }],
      }).success,
    ).toBe(false);
  });
});
