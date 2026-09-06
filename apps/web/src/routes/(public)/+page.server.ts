import { redirect } from '@sveltejs/kit';
import { api } from '$lib/api/client';
import type { PageServerLoad } from './$types';

/** Server-side load → typed API call → HTML with the data already in it (Decision B). */
export const load: PageServerLoad = async ({ locals }) => {
  if (locals.session) redirect(303, '/dashboard');
  const { data, error } = await api(locals.requestId).v1.version.get();
  return {
    requestId: locals.requestId,
    api: data?.success ? data.data : null,
    apiError: error ? `${error.status}` : null,
  };
};
