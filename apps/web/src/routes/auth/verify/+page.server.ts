import { apiFor, unwrap } from '$lib/server/session';
import type { PageServerLoad } from './$types';

/** Email verification landing (A-6): the token in the link is consumed on this GET. */
export const load: PageServerLoad = async (event) => {
  const token = event.url.searchParams.get('token') ?? '';
  if (!token) return { verified: false, message: 'Tautan tidak lengkap' };
  const r = unwrap(await apiFor(event).v1.auth['verify-email'].get({ query: { token } }));
  return r.ok
    ? { verified: true, message: 'Email Anda sudah terverifikasi.' }
    : { verified: false, message: r.failure.message };
};
