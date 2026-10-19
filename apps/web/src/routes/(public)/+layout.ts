import { moduleWidgets } from '$lib/../generated/widgets';
import { publicLayouts } from '$lib/layouts/registry';
import type { LayoutLoad } from './$types';

/**
 * Turn the resolved layout id into its (code-split) component, and load ONLY the header widgets
 * the server allowed — a module that is off for the tenant never has its component downloaded.
 */
export const load: LayoutLoad = async ({ data }) => {
  const loader = publicLayouts[data.layoutId] ?? publicLayouts['marketing-wide'];
  const [mod, headerWidgets] = await Promise.all([
    (loader as NonNullable<typeof loader>)(),
    Promise.all(
      data.headerWidgets.map(async (w) => {
        const entry = moduleWidgets.find((m) => m.id === w.id);
        const c = entry ? await entry.load() : null;
        return { ...w, Component: c?.default ?? null };
      }),
    ),
  ]);
  return { ...data, Layout: mod.default, headerWidgets };
};
