import type { PageServerLoad } from './$types';
import { lookupIp } from './lookup';

/** Without JavaScript the "?" is an ordinary link to this page: the same lookup, rendered. */
export const load: PageServerLoad = async (event) => {
  const ip = event.url.searchParams.get('ip')?.trim() ?? '';
  const res = await lookupIp(event, ip);
  return res.ok ? { ip, info: res.info, error: null } : { ip, info: null, error: res.error };
};
