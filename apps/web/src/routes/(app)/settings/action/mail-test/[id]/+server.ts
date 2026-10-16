import { json, type RequestHandler } from '@sveltejs/kit';
import { apiFetchData } from '$lib/server/session';

/**
 * What became of one test e-mail sent from Settings → Email: delivered, opened, clicked,
 * confirmed. The page polls this under the tester's verdict while the operator checks the inbox.
 * The id only ever reaches the API as one encoded path segment; the API decides what the caller
 * may see (its own scope, `smtp-test` rows only).
 */
export const GET: RequestHandler = async (event) => {
  const id = event.params.id ?? '';
  if (!/^[\w-]{1,64}$/.test(id)) return json(null, { status: 404 });
  const scope = event.url.searchParams.get('scope') === 'global' ? 'global' : 'tenant';
  const data = await apiFetchData(
    event,
    `/v1/configuration/mail/test/${encodeURIComponent(id)}?scope=${scope}`,
  );
  return json(data, { status: data ? 200 : 404, headers: { 'cache-control': 'no-store' } });
};
