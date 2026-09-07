import { isNull, schema } from '@core/db';
import { defineTools } from '@core/module-kit';
import { t } from 'elysia';

/**
 * AI / MCP tools (extension point 8, I-3). The core registry runs them ONLY for callers holding
 * `permission`, only while the module is enabled for the tenant, and with the tenant facade as
 * `ctx.db` — the module never checks any of that itself. `input` (TypeBox → JSON Schema) validates
 * the arguments and describes them to the model / MCP client from one declaration.
 */
export default defineTools('Hello', [
  {
    name: 'hello.list_notes',
    description: {
      id: 'Daftar notes tenant aktif, opsional difilter title (q). Pakai saat pengguna bertanya notes apa yang ada.',
      en: 'List the active tenant’s notes, optionally filtered by title (q). Use when the user asks which notes exist.',
    },
    permission: 'hello.note.read',
    readOnly: true,
    input: t.Object({
      q: t.Optional(t.String({ maxLength: 120 })),
      limit: t.Optional(t.Integer({ minimum: 1, maximum: 50, default: 20 })),
    }),
    run: async (input, { db }) => {
      const q = typeof input.q === 'string' ? input.q.trim() : '';
      const limit = typeof input.limit === 'number' ? input.limit : 20;
      const rows = await db.select(schema.helloNotes, isNull(schema.helloNotes.deleted_at));
      const hit = q
        ? rows.filter((r) =>
            String(r.title ?? '')
              .toLowerCase()
              .includes(q.toLowerCase()),
          )
        : rows;
      return {
        total: hit.length,
        notes: hit.slice(0, limit).map((r) => ({ id: r.id, title: r.title })),
      };
    },
  },
]);
