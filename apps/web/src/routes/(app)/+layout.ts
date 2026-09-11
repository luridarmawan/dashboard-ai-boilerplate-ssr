import { moduleWidgets } from '$lib/../generated/widgets';
import { asides } from '$lib/asides/registry';
import { dashboardLayouts } from '$lib/layouts/registry';
import type { LayoutLoad } from './$types';

/**
 * Turn the resolved layout id into its (code-split) component before the shell renders, load
 * ONLY the shell widgets the server allowed (H-13), and — when the route named one — the aside
 * the layout's side region will hold. Same code-splitting rule throughout: nothing a request
 * does not use is downloaded.
 */
export const load: LayoutLoad = async ({ data }) => {
  const loader = dashboardLayouts[data.layoutId] ?? dashboardLayouts['sidebar-classic'];
  const asideLoader = data.asideId ? asides[data.asideId] : undefined;
  const [mod, shellWidgets, aside] = await Promise.all([
    (loader as NonNullable<typeof loader>)(),
    Promise.all(
      data.shellWidgets.map(async (w) => {
        const entry = moduleWidgets.find((m) => m.id === w.id);
        const c = entry ? await entry.load() : null;
        return { ...w, Component: c?.default ?? null };
      }),
    ),
    // An unknown id is a page naming an aside that no longer exists: no side column, no crash.
    asideLoader ? asideLoader() : Promise.resolve(null),
  ]);
  return { ...data, Layout: mod.default, shellWidgets, Aside: aside?.default ?? null };
};
