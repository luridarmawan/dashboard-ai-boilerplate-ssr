import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const res = await apiFor(event).v1.clients.get({ query: { limit: 100, sort: 'name' } });
  if (!res.data?.success) error(res.status, 'Tenant tidak bisa dimuat');
  return { clients: res.data.data };
};
