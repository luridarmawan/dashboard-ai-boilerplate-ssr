import { authLayouts } from '$lib/layouts/registry';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data }) => {
  const loader = authLayouts[data.layoutId] ?? authLayouts['centered-card'];
  const mod = await (loader as NonNullable<typeof loader>)();
  return { ...data, Layout: mod.default };
};
