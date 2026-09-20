import { describe, expect, test } from 'bun:test';
import config from '../../../apps/web/svelte.config.js';

/**
 * A module's pages must be type-checked by somebody (G-6, K-5).
 *
 * They cannot be checked by the module's own `tsc`: its tsconfig excludes `web/**` because
 * `$lib/*` and `@core/ui` are aliases of `apps/web`. And they are not reached by `apps/web`'s
 * `svelte-check` by default either, because what lives in `src/routes` is only a generated shim
 * that re-exports the real file from `modules/<Name>/web/**`, and SvelteKit's generated tsconfig
 * includes `src/**` alone. For a while that left module pages checked by NOBODY — a mistyped i18n
 * key in one shipped silently. `apps/web/svelte.config.js` closes it through `kit.typescript.config`.
 *
 * This test guards the hook, not the wiring around it: `svelte-check` reporting an error for a
 * module page is proven by using it. Paths are relative to `kit.outDir` (`apps/web/.svelte-kit`).
 */
describe('module pages are inside the app type-check (K-5)', () => {
  const hook = config.kit?.typescript?.config;

  test('svelte.config.js installs the tsconfig hook', () => {
    expect(typeof hook).toBe('function');
  });

  test('it adds the module page sources and skips their node_modules', () => {
    const tsconfig = { include: ['../src/**/*.svelte'], exclude: ['../node_modules/**'] };
    const out = hook?.(tsconfig) ?? tsconfig;

    expect(out.include).toContain('../../../modules/**/web/**/*.svelte');
    expect(out.include).toContain('../../../modules/**/web/**/*.ts');
    expect(out.exclude).toContain('../../../modules/**/node_modules/**');
    // Whatever SvelteKit generated stays: the hook extends the list, it does not replace it.
    expect(out.include).toContain('../src/**/*.svelte');
  });
});
