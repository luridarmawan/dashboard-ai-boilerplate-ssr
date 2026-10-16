import { json, type RequestHandler } from '@sveltejs/kit';
import { lookupIp } from './lookup';

/**
 * The "?" popover of the user list fetches here (`accept: application/json`). A plain navigation
 * to the same URL (`text/html`, JavaScript off) is served by the page next to this file instead.
 */
export const GET: RequestHandler = async (event) => {
  const res = await lookupIp(event, event.url.searchParams.get('ip')?.trim() ?? '');
  return res.ok ? json(res.info) : json({ error: res.error }, { status: res.status });
};
