import { resolveLayout } from '@core/ui-theme';
import { layoutVariants } from '$lib/../generated/layout-variants';
import type { LayoutServerLoad } from './$types';

/** Auth pages use the theme's `auth` layout (centered card, split hero, …). */
export const load: LayoutServerLoad = async (event) => {
  const variant = layoutVariants[event.route.id ?? ''] ?? 'default';
  const layout = resolveLayout(event.locals.theme.theme, 'auth', variant);
  return { layoutId: layout.layout.id, layoutVariant: variant };
};
