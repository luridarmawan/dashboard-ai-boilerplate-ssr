import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';

/** Dashboard: products of the active tenant (R-6). Wide table → ask the theme for its `wide` layout. */
export const _layoutVariant = 'wide';

export const load: ServerLoad = async (event) => {
  const res = await apiFor(event).v1.m.example.admin.products.get();
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403 ? 'Anda tidak punya izin melihat produk' : 'Produk tidak bisa dimuat',
    );
  return { products: res.data.data, saved: event.url.searchParams.get('saved') };
};
