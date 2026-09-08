import type { Actions, ServerLoad } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import { renderMarkdown } from '../../lib/markdown.ts';
import { activePath, siblingsAlong } from '../../lib/thread.ts';

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
  // H-12: `?m=<id>` picks the leaf whose path (ancestors + newest descendants) is shown.
  const leaf = event.url.searchParams.get('m');
  const list = await api.v1.m.ai.conversations.get({ query: q ? { q } : {} });
  if (!list.data?.success)
    error(
      list.status,
      list.status === 403
        ? 'Anda tidak punya izin memakai asisten AI'
        : 'Percakapan tidak bisa dimuat',
    );
  // H-10: the provider/model picker; empty when the tenant has no profiles (legacy ai.* settings).
  const [opts, quotaRes] = await Promise.all([
    api.v1.m.ai.providers.options.get(),
    api.v1.m.ai.quota.get(),
  ]);
  const providers = opts.data?.success ? opts.data.data : [];
  const quota = quotaRes.data?.success ? quotaRes.data.data : null;
  type Attachment = {
    id: string;
    fileId: string;
    name: string;
    mime: string;
    size: number;
    url: string;
  };
  type Shown = {
    id: string;
    role: string;
    content: string;
    html: string;
    parentId: string | null;
    attachments: Attachment[];
    createdAt: string;
  };
  let conversation: {
    id: string;
    title: string;
    providerId: string | null;
    model: string | null;
    /** The active path only (H-12); `siblings` says where each message stands among its versions. */
    messages: Shown[];
    siblings: ReturnType<typeof siblingsAlong>;
    /** The last message shown — the parent of whatever is sent next. */
    leafId: string | null;
  } | null = null;
  if (selected) {
    const one = await api.v1.m.ai.conversations({ id: selected }).get();
    if (one.data?.success) {
      const c = one.data.data;
      const all = c.messages.map((m) => ({
        ...m,
        createdAt:
          typeof m.createdAt === 'string' ? m.createdAt : new Date(m.createdAt).toISOString(),
      }));
      const path = activePath(all, leaf);
      conversation = {
        id: c.id,
        title: c.title,
        providerId: c.providerId,
        model: c.model,
        messages: await Promise.all(
          path.map(async (m) => ({
            ...m,
            html: m.role === 'assistant' ? await renderMarkdown(m.content) : '',
          })),
        ),
        siblings: siblingsAlong(all, path),
        leafId: path.at(-1)?.id ?? null,
      };
    }
  }
  const cfg = event.locals.config.values;
  return {
    q,
    conversations: list.data.data,
    conversation,
    providers,
    quota,
    aiEnabled: cfg['ai.enable'] !== false,
    error: event.url.searchParams.get('error'),
  };
};

type PathMsg = { id: string; role: string; content: string; parentId: string | null };
/** All messages of a conversation, ancestors-first path ending at `leaf` (no descent). */
async function pathTo(
  event: Parameters<NonNullable<Actions[string]>>[0],
  conversationId: string,
  leaf: string | null,
): Promise<PathMsg[]> {
  const one = await apiFor(event).v1.m.ai.conversations({ id: conversationId }).get();
  if (!one.data?.success) return [];
  const all = one.data.data.messages as PathMsg[];
  const path = activePath(all, leaf);
  if (!leaf) return path;
  const i = path.findIndex((m) => m.id === leaf);
  return i >= 0 ? path.slice(0, i + 1) : path;
}
/** The model's history for a new message under `parent`: the path down to it, as chat roles. */
async function historyUpTo(
  event: Parameters<NonNullable<Actions[string]>>[0],
  conversationId: string,
  parent: string | null,
) {
  return (await pathTo(event, conversationId, parent)).map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));
}
/** `&m=<assistant id>` from a completion response, so the page lands on the new branch (H-12). */
const leafParam = (data: unknown) => {
  const x = (data as { x_messages?: { assistant?: string | null } } | null)?.x_messages;
  return x?.assistant ? `&m=${x.assistant}` : '';
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
    // H-12: history = the active path up to the parent the composer was showing.
    const parentField = str(form, 'parent');
    const prior = await historyUpTo(event, id, parentField || null);
    // H-11: files first, as this user; then their ids go with the message.
    const attachments: string[] = [];
    for (const f of form.getAll('files')) {
      if (!(f instanceof File) || f.size === 0) continue;
      const up = unwrap<{ success: true; data: { id: string } }>(
        await api.v1.m.ai.attachments.post({ file: f }),
      );
      if (!up.ok) return actionFailure(up.failure);
      attachments.push(up.data.data.id);
    }
    const res = await api.v1.m.ai.chat.completions.post({
      messages: [...prior, { role: 'user', content }],
      stream: false,
      conversation_id: id,
      ...(parentField ? { parent_id: parentField } : {}),
      ...(attachments.length ? { attachments } : {}),
    });
    if (res.error) {
      const failure = unwrap(res);
      const code = !failure.ok
        ? ((failure.failure.details as { reason?: string } | null)?.reason ?? failure.failure.code)
        : 'failed';
      redirect(303, `/m/ai/chat?c=${id}&error=${encodeURIComponent(code)}`);
    }
    redirect(303, `/m/ai/chat?c=${id}${leafParam(res.data)}`);
  },
  /** H-12: answer the same user message again — the new reply becomes a sibling version. */
  regenerate: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const id = str(form, 'c');
    const m = str(form, 'm'); // the assistant message to redo
    const api = apiFor(event);
    const path = await pathTo(event, id, m);
    const user = path.at(-2); // …, user, assistant(m)
    if (user?.role !== 'user') redirect(303, `/m/ai/chat?c=${id}`);
    const res = await api.v1.m.ai.chat.completions.post({
      messages: path.slice(0, -1).map((x) => ({ role: x.role as 'user', content: x.content })),
      stream: false,
      conversation_id: id,
      parent_id: user.id,
      regenerate: true,
    });
    if (res.error) {
      const failure = unwrap(res);
      const code = !failure.ok ? failure.failure.code : 'failed';
      redirect(303, `/m/ai/chat?c=${id}&m=${m}&error=${encodeURIComponent(code)}`);
    }
    redirect(303, `/m/ai/chat?c=${id}${leafParam(res.data)}`);
  },
  /** H-12: edit a user message → a sibling user message under the same parent, and a new branch. */
  edit: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const id = str(form, 'c');
    const m = str(form, 'm'); // the user message being edited
    const content = str(form, 'content').trim();
    if (!content) redirect(303, `/m/ai/chat?c=${id}&m=${m}`);
    const api = apiFor(event);
    const path = await pathTo(event, id, m);
    const edited = path.at(-1);
    if (edited?.role !== 'user') redirect(303, `/m/ai/chat?c=${id}`);
    const res = await api.v1.m.ai.chat.completions.post({
      messages: [
        ...path.slice(0, -1).map((x) => ({ role: x.role as 'user', content: x.content })),
        { role: 'user', content },
      ],
      stream: false,
      conversation_id: id,
      parent_id: edited.parentId ?? null,
    });
    if (res.error) {
      const failure = unwrap(res);
      const code = !failure.ok ? failure.failure.code : 'failed';
      redirect(303, `/m/ai/chat?c=${id}&m=${m}&error=${encodeURIComponent(code)}`);
    }
    redirect(303, `/m/ai/chat?c=${id}${leafParam(res.data)}`);
  },
  /** H-10: pin a provider + model on the conversation; `default` = tenant default. */
  model: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const id = str(form, 'c');
    const [provider, model] = str(form, 'pm').split('::');
    const r = unwrap(
      await apiFor(event)
        .v1.m.ai.conversations({ id })
        .patch(
          !provider || provider === 'default'
            ? { provider: null, model: null }
            : { provider, model: model || null },
        ),
    );
    if (!r.ok) redirect(303, `/m/ai/chat?c=${id}&error=${encodeURIComponent(r.failure.code)}`);
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
