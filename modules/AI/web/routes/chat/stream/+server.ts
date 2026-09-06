import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { CSRF_COOKIE, checkCsrf, SESSION_COOKIE } from '$lib/server/session';

/**
 * Streaming bridge (H-3): browser → SvelteKit → API → provider, token by token. The API's SSE
 * body is piped through untouched; when the browser aborts (stop button, tab closed), this
 * request's signal aborts the upstream fetch, which aborts the API's call to the provider.
 */
export const POST: RequestHandler = async (event) => {
  const form = await event.request.formData();
  if (!checkCsrf(event, form)) return new Response('csrf', { status: 403 });
  const content = String(form.get('content') ?? '').trim();
  const conversationId = String(form.get('c') ?? '');
  const prior = JSON.parse(String(form.get('history') ?? '[]')) as {
    role: string;
    content: string;
  }[];
  const session = event.cookies.get(SESSION_COOKIE) ?? '';
  const csrf = event.cookies.get(CSRF_COOKIE) ?? '';
  let ip = '';
  try {
    ip = event.getClientAddress();
  } catch {
    ip = '';
  }
  const upstream = await fetch(
    `${env.API_URL ?? 'http://127.0.0.1:3001'}/v1/m/ai/chat/completions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        cookie: `${SESSION_COOKIE}=${session}; ${CSRF_COOKIE}=${csrf}`,
        'x-csrf-token': csrf,
        origin: event.url.origin,
        'x-forwarded-proto': event.url.protocol.replace(':', ''),
        'x-forwarded-host': event.url.host,
        ...(ip ? { 'x-forwarded-for': ip } : {}),
        'x-request-id': event.locals.requestId,
      },
      body: JSON.stringify({
        messages: [...prior, { role: 'user', content }],
        stream: true,
        conversation_id: conversationId || undefined,
      }),
      signal: event.request.signal,
    },
  );
  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  }
  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
};
