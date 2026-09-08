import { moduleWidgets } from '$lib/../generated/widgets';
import { dashboardLayouts } from '$lib/layouts/registry';
import type { LayoutLoad } from './$types';

/**
 * Turn the resolved layout id into its (code-split) component before the shell renders, and load
 * ONLY the shell widgets the server allowed (H-13) — same code-splitting rule as the dashboard.
 */
export const load: LayoutLoad = async ({ data }) => {
  const loader = dashboardLayouts[data.layoutId] ?? dashboardLayouts['sidebar-classic'];
  const [mod, shellWidgets] = await Promise.all([
    (loader as NonNullable<typeof loader>)(),
    Promise.all(
      data.shellWidgets.map(async (w) => {
        const entry = moduleWidgets.find((m) => m.id === w.id);
        const c = entry ? await entry.load() : null;
        return { ...w, Component: c?.default ?? null };
      }),
    ),
  ]);
  return { ...data, Layout: mod.default, shellWidgets };
};
