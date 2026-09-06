import { moduleWidgets } from '$lib/../generated/widgets';
import type { PageLoad } from './$types';

/** Load ONLY the components of the widgets the server allowed (code-split per widget). */
export const load: PageLoad = async ({ data }) => {
  const components = await Promise.all(
    data.widgets.map(async (w) => {
      const entry = moduleWidgets.find((m) => m.id === w.id);
      const mod = entry ? await entry.load() : null;
      return { ...w, Component: mod?.default ?? null };
    }),
  );
  return { ...data, widgets: components };
};
