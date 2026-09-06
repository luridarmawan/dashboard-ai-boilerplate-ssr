import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** `?code=404|403|500` throws that status so the (app) error page renders inside the shell. */
export const load: PageServerLoad = async ({ url }) => {
  const code = Number(url.searchParams.get('code'));
  if (code === 404) error(404, 'Contoh: sumber tidak ditemukan');
  if (code === 403) error(403, 'Contoh: Anda tidak punya izin');
  if (code === 500) error(500, 'Contoh: kesalahan internal');
  return {};
};
