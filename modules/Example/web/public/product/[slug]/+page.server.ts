import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';

/** Product detail (R-3): SSR from the module table; 404 when the slug does not exist. */
export const load: ServerLoad = async (event) => {
  const slug = String(event.params.slug ?? '');
  const res = await apiFor(event).v1.m.example.products({ slug }).get();
  if (!res.data?.success) error(res.status === 404 ? 404 : res.status, 'Produk tidak ditemukan');
  return {
    product: res.data.data,
    brand:
      (event.locals.config.values['example.brand_name'] as string | undefined) ?? 'Kopi Nusantara',
    origin: event.url.origin,
  };
};
