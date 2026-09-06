import { dashboardLayouts } from '$lib/layouts/registry';
import type { LayoutLoad } from './$types';

/** Turn the resolved layout id into its (code-split) component before the shell renders. */
export const load: LayoutLoad = async ({ data }) => {
  const loader = dashboardLayouts[data.layoutId] ?? dashboardLayouts['sidebar-classic'];
  const mod = await (loader as NonNullable<typeof loader>)();
  return { ...data, Layout: mod.default };
};
