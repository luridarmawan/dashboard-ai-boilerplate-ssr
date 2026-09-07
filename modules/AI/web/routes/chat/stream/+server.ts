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
  const base = env.API_URL ?? 'http://127.0.0.1:3001';
  const headers = {
    'content-type': 'application/json',
    cookie: `${SESSION_COOKIE}=${session}; ${CSRF_COOKIE}=${csrf}`,
    'x-csrf-token': csrf,
    origin: event.url.origin,
    'x-forwarded-proto': event.url.protocol.replace(':', ''),
    'x-forwarded-host': event.url.host,
    ...(ip ? { 'x-forwarded-for': ip } : {}),
    'x-request-id': event.locals.requestId,
  };
  // First message of a fresh chat: create the conversation first so the exchange is persisted (H-6)
  // exactly like the no-JS path does; the id goes back in a header so the page can land on it.
  let conversationId = String(form.get('c') ?? '');
  if (!conversationId) {
    const created = await fetch(`${base}/v1/m/ai/conversations`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    if (created.ok) {
      const body = (await created.json()) as { data?: { id?: string } };
      conversationId = body.data?.id ?? '';
    }
  }
  const upstream = await fetch(`${base}/v1/m/ai/chat/completions`, {
    method: 'POST',
    headers: { ...headers, accept: 'text/event-stream' },
    body: JSON.stringify({
      messages: [...prior, { role: 'user', content }],
      stream: true,
      conversation_id: conversationId || undefined,
    }),
    signal: event.request.signal,
  });
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
      ...(conversationId ? { 'x-conversation-id': conversationId } : {}),
    },
  });
};
