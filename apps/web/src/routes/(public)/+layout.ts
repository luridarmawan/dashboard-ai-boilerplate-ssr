import { publicLayouts } from '$lib/layouts/registry';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data }) => {
  const loader = publicLayouts[data.layoutId] ?? publicLayouts['marketing-wide'];
  const mod = await (loader as NonNullable<typeof loader>)();
  return { ...data, Layout: mod.default };
};
