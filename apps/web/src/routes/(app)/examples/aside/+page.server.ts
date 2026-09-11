import type { PageServerLoad } from './$types';

/**
 * L-19 pattern: a page with SIDE CONTENT. The shell renders before this page does, so a page
 * cannot hand it a snippet — it NAMES one instead, and the shell resolves that name through
 * `$lib/asides/registry.ts` (collected by `bun run layout:variants`, same as the variant).
 * The aside then reads whatever this `load` returned, through `page.data`.
 */
export const _aside = 'examples.aside';

export const load: PageServerLoad = async () => ({
  /** Anything the aside needs is just page data — there is no second load for the side column. */
  checklist: [
    { done: true, key: 'declare' },
    { done: true, key: 'register' },
    { done: true, key: 'render' },
    { done: false, key: 'optional' },
  ],
  updatedAt: new Date().toISOString(),
});
