import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from '@app/api/app';
import { runSeed } from '@core/auth';
import { type Db, eq, newId, schema, unsafeAcrossTenants } from '@core/db';

/**
 * Integration (INTEGRATION=1): message threading (H-12) and attachments (H-11). Every stored
 * message knows its parent; regenerate adds a sibling reply, editing adds a sibling user message
 * and a fresh branch; pre-threading rows are linked once on read. Attachments are the sender's own
 * private uploads: text is quoted to the model, images travel as data URLs, and the conversation
 * lists them with a URL only the owner (or a file.read holder) can open.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.97.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `ai-thread-admin-${run}@example.test`;
const adminPassword = 'an ai thread admin password';

const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body && typeof init.body === 'string' && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; message?: string; details?: Record<string, unknown> };
}
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';
type Msg = {
  id: string;
  role: string;
  content: string;
  parentId: string | null;
  attachments: { id: string; fileId: string; name: string; mime: string; url: string }[];
};
type Part = { type: string; text?: string; image_url?: { url: string } };
type WireMsg = { role: string; content: string | Part[] | null };

describe.skipIf(!enabled)('AI threading (H-12) + attachments (H-11)', () => {
  let db: Db;
  let admin = '';
  let tenantId = '';
  let providerId = '';
  let mock: ReturnType<typeof Bun.serve>;
  let replies = 0;
  let lastMessages: WireMsg[] = [];
  const P = `thread-${run % 100000}`;

  const complete = (body: Record<string, unknown>) =>
    call(
      '/v1/m/ai/chat/completions',
      { method: 'POST', body: JSON.stringify({ stream: false, ...body }) },
      [admin],
    );
  const messagesOf = async (id: string) =>
    (
      (await json(await call(`/v1/m/ai/conversations/${id}`, {}, [admin]))).data as {
        messages: Msg[];
      }
    ).messages;
  const upload = (name: string, type: string, bytes: Uint8Array | string) => {
    const fd = new FormData();
    fd.set('file', new File([bytes], name, { type }));
    return call('/v1/m/ai/attachments', { method: 'POST', body: fd }, [admin]);
  };

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    const s = await runSeed(db, { adminEmail, adminPassword });
    tenantId = s.tenantId;
    admin = sessionCookie(
      await call('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      }),
    );
    mock = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { messages: WireMsg[] };
        lastMessages = body.messages;
        replies++;
        return Response.json({
          choices: [{ message: { role: 'assistant', content: `Jawaban ${replies}` } }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        });
      },
    });
    await call(
      '/v1/configuration',
      { method: 'PUT', body: JSON.stringify({ scope: 'global', values: { 'ai.enable': 'true' } }) },
      [admin],
    );
    const prov = await call(
      '/v1/m/ai/providers',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Thread mock',
          code: P,
          baseUrl: `http://127.0.0.1:${mock.port}/v1`,
          apiKey: 'k',
          defaultModel: 'm',
          models: [{ model: 'm' }],
        }),
      },
      [admin],
    );
    expect(prov.status).toBe(201);
    providerId = ((await json(prov)).data as { id: string }).id;
  });
  afterAll(async () => {
    if (enabled && providerId)
      await call(`/v1/m/ai/providers/${providerId}`, { method: 'DELETE' }, [admin]);
    mock?.stop(true);
  });

  let convId = '';
  let u1 = '';
  let a1 = '';
  let a2 = '';

  test('a reply hangs under its user message; the response names both stored ids', async () => {
    convId = String(
      (
        (await json(await call('/v1/m/ai/conversations', { method: 'POST' }, [admin]))).data as {
          id: string;
        }
      ).id,
    );
    const r = await complete({
      messages: [{ role: 'user', content: 'Pertanyaan pertama' }],
      conversation_id: convId,
    });
    expect(r.status).toBe(200);
    const x = ((await r.json()) as { x_messages: { user: string; assistant: string } }).x_messages;
    u1 = x.user;
    a1 = x.assistant;
    const msgs = await messagesOf(convId);
    expect(msgs.map((m) => [m.role, m.parentId])).toEqual([
      ['user', null],
      ['assistant', u1],
    ]);
    expect(msgs[1]?.id).toBe(a1);
  });

  test('regenerate: a sibling reply under the same user message, no new user row', async () => {
    const r = await complete({
      messages: [{ role: 'user', content: 'Pertanyaan pertama' }],
      conversation_id: convId,
      parent_id: u1,
      regenerate: true,
    });
    expect(r.status).toBe(200);
    a2 = ((await r.json()) as { x_messages: { user: string; assistant: string } }).x_messages
      .assistant;
    const msgs = await messagesOf(convId);
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(msgs.filter((m) => m.parentId === u1).map((m) => m.id)).toEqual([a1, a2]);
    // regenerate needs a USER parent
    expect(
      (
        await complete({
          messages: [{ role: 'user', content: 'x' }],
          conversation_id: convId,
          parent_id: a1,
          regenerate: true,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await complete({
          messages: [{ role: 'user', content: 'x' }],
          conversation_id: convId,
          regenerate: true,
        })
      ).status,
    ).toBe(422);
  });

  test('continue on a branch: the next user message names its parent; unknown parents are refused; editing the root makes a second root', async () => {
    const r = await complete({
      messages: [
        { role: 'user', content: 'Pertanyaan pertama' },
        { role: 'assistant', content: 'Jawaban 2' },
        { role: 'user', content: 'Lanjut di cabang kedua' },
      ],
      conversation_id: convId,
      parent_id: a2,
    });
    expect(r.status).toBe(200);
    const x = ((await r.json()) as { x_messages: { user: string; assistant: string } }).x_messages;
    let msgs = await messagesOf(convId);
    expect(msgs.find((m) => m.id === x.user)?.parentId).toBe(a2);
    expect(msgs.find((m) => m.id === x.assistant)?.parentId).toBe(x.user);
    const bad = await complete({
      messages: [{ role: 'user', content: 'x' }],
      conversation_id: convId,
      parent_id: newId(),
    });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error?.details?.reason).toBe('parent_not_found');
    // Edit the first message → a new root, sibling of u1.
    const edit = await complete({
      messages: [{ role: 'user', content: 'Pertanyaan pertama (diubah)' }],
      conversation_id: convId,
      parent_id: null,
    });
    expect(edit.status).toBe(200);
    msgs = await messagesOf(convId);
    const roots = msgs.filter((m) => m.parentId === null);
    expect(roots.map((m) => m.content)).toEqual([
      'Pertanyaan pertama',
      'Pertanyaan pertama (diubah)',
    ]);
  });

  test('pre-threading rows are linked in order the first time the conversation is read', async () => {
    const legacy = newId();
    await db.insert(schema.aiConversations).values({
      id: legacy,
      client_id: tenantId,
      user_id: (
        (await json(await call('/v1/auth/me', {}, [admin]))).data as { user: { id: string } }
      ).user.id,
      title: 'Lama',
    });
    const ids = [newId(), newId(), newId(), newId()];
    const base = Date.now() - 60_000;
    for (const [i, id] of ids.entries())
      await db.insert(schema.aiMessages).values({
        id,
        client_id: tenantId,
        conversation_id: legacy,
        role: i % 2 ? 'assistant' : 'user',
        content: `m${i}`,
        created_at: new Date(base + i * 1000),
      });
    const msgs = await messagesOf(legacy);
    expect(msgs.map((m) => m.parentId)).toEqual([null, ids[0], ids[1], ids[2]]);
    const [row] = await db
      .select()
      .from(schema.aiMessages)
      .where(eq(schema.aiMessages.id, ids[3] as string));
    expect(row?.parent_id).toBe(ids[2] as string);
  });

  test('attachments: own private uploads only; text is quoted to the model; the conversation lists them; owner-only URL', async () => {
    const txt = await upload('catatan.txt', 'text/plain', 'Rapat pukul 10, bawa laporan Q3.');
    expect(txt.status).toBe(201);
    const t = (await json(txt)).data as { id: string; url: string; mime: string };
    expect(t.mime).toBe('text/plain');
    expect((await upload('cv.pdf', 'application/pdf', '%PDF-1.7\n')).status).toBe(422);
    const bogus = await complete({
      messages: [{ role: 'user', content: 'x' }],
      conversation_id: convId,
      attachments: [newId()],
    });
    expect(bogus.status).toBe(422);
    expect((await json(bogus)).error?.details?.reason).toBe('attachment_invalid');

    const r = await complete({
      messages: [{ role: 'user', content: 'Ringkas lampiran ini' }],
      conversation_id: convId,
      attachments: [t.id],
    });
    expect(r.status).toBe(200);
    const sent = lastMessages.filter((m) => m.role === 'user').at(-1)?.content as string;
    expect(sent).toContain('Ringkas lampiran ini');
    expect(sent).toContain('[Lampiran: catatan.txt]');
    expect(sent).toContain('bawa laporan Q3');
    const msgs = await messagesOf(convId);
    const withAtt = msgs.find((m) => m.attachments.length);
    expect(withAtt?.role).toBe('user');
    expect(withAtt?.content).toBe('Ringkas lampiran ini'); // the quote is for the model only
    expect(withAtt?.attachments[0]).toMatchObject({ name: 'catatan.txt', mime: 'text/plain' });
    const url = withAtt?.attachments[0]?.url as string;
    expect((await call(url, {}, [admin])).status).toBe(200);
    expect((await call(url)).status).toBe(404); // private: anonymous sees nothing
  });

  test('an image attachment reaches the model as an image_url content part', async () => {
    const PNG = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
    ]);
    const img = await upload('foto.png', 'image/png', PNG);
    expect(img.status).toBe(201);
    const id = ((await json(img)).data as { id: string }).id;
    const r = await complete({
      messages: [{ role: 'user', content: 'Apa isi gambar ini?' }],
      conversation_id: convId,
      attachments: [id],
    });
    expect(r.status).toBe(200);
    const sent = lastMessages.filter((m) => m.role === 'user').at(-1)?.content as Part[];
    expect(Array.isArray(sent)).toBe(true);
    expect(sent[0]).toEqual({ type: 'text', text: 'Apa isi gambar ini?' });
    expect(sent[1]?.type).toBe('image_url');
    expect(sent[1]?.image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
  });
});
