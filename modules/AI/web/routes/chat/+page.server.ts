import type { Actions, ServerLoad } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import { renderMarkdown } from '../../lib/markdown.ts';

/**
 * Chat page (H-6, H-7, H-8). Works without JavaScript: the form posts a message, the API answers
 * in one piece and the page re-renders with history. With JavaScript, the same form streams via
 * ./stream (H-3). `?c=<id>` selects a conversation; `?q=` searches titles.
 */
export const _layoutVariant = 'wide';

export const load: ServerLoad = async (event) => {
  const api = apiFor(event);
  const q = event.url.searchParams.get('q') ?? '';
  const selected = event.url.searchParams.get('c');
  const list = await api.v1.m.ai.conversations.get({ query: q ? { q } : {} });
  if (!list.data?.success)
    error(
      list.status,
      list.status === 403
        ? 'Anda tidak punya izin memakai asisten AI'
        : 'Percakapan tidak bisa dimuat',
    );
  let conversation: {
    id: string;
    title: string;
    messages: { id: string; role: string; content: string; html: string; createdAt: string }[];
  } | null = null;
  if (selected) {
    const one = await api.v1.m.ai.conversations({ id: selected }).get();
    if (one.data?.success) {
      const c = one.data.data;
      conversation = {
        id: c.id,
        title: c.title,
        messages: await Promise.all(
          c.messages.map(async (m) => ({
            ...m,
            html: m.role === 'assistant' ? await renderMarkdown(m.content) : '',
          })),
        ),
      };
    }
  }
  const cfg = event.locals.config.values;
  return {
    q,
    conversations: list.data.data,
    conversation,
    aiEnabled: cfg['ai.enable'] !== false,
    error: event.url.searchParams.get('error'),
  };
};

const csrfFail = () =>
  actionFailure({
    status: 403,
    code: 'csrf_failed',
    message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
  });

export const actions: Actions = {
  new: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap<{ success: true; data: { id: string } }>(
      await apiFor(event).v1.m.ai.conversations.post(),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, `/m/ai/chat?c=${r.data.data.id}`);
  },
  /** No-JS path: full (non-streaming) completion, then re-render. */
  send: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const content = str(form, 'content').trim();
    let id = str(form, 'c');
    if (!content) redirect(303, id ? `/m/ai/chat?c=${id}` : '/m/ai/chat');
    const api = apiFor(event);
    if (!id) {
      const created = unwrap<{ success: true; data: { id: string } }>(
        await api.v1.m.ai.conversations.post(),
      );
      if (!created.ok) return actionFailure(created.failure);
      id = created.data.data.id;
    }
    const history = await api.v1.m.ai.conversations({ id }).get();
    const prior = history.data?.success
      ? history.data.data.messages.map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }))
      : [];
    const res = await api.v1.m.ai.chat.completions.post({
      messages: [...prior, { role: 'user', content }],
      stream: false,
      conversation_id: id,
    });
    if (res.error) {
      const failure = unwrap(res);
      const code = !failure.ok
        ? ((failure.failure.details as { reason?: string } | null)?.reason ?? failure.failure.code)
        : 'failed';
      redirect(303, `/m/ai/chat?c=${id}&error=${encodeURIComponent(code)}`);
    }
    redirect(303, `/m/ai/chat?c=${id}`);
  },
  archive: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const id = str(form, 'c');
    await apiFor(event)
      .v1.m.ai.conversations({ id })
      .patch({ archived: str(form, 'archived') === '1' });
    redirect(303, '/m/ai/chat');
  },
  delete: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    await apiFor(event)
      .v1.m.ai.conversations({ id: str(form, 'c') })
      .delete();
    redirect(303, '/m/ai/chat');
  },
};
