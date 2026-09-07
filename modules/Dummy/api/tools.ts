import { isNull, schema } from '@core/db';
import { defineTools } from '@core/module-kit';
import { t } from 'elysia';

/** AI / MCP tools (extension point 8). Probe tools for the gate proofs: one free, one behind a permission. */
export default defineTools('Dummy', [
  {
    name: 'dummy.ping',
    description: {
      id: 'Uji koneksi tool; menggemakan pesan',
      en: 'Tool connectivity probe; echoes a message',
    },
    readOnly: true,
    input: t.Object({ message: t.Optional(t.String({ maxLength: 200 })) }),
    run: (input, ctx) => ({
      pong: typeof input.message === 'string' ? input.message : 'pong',
      tenant: ctx.clientId,
      at: new Date().toISOString(),
    }),
  },
  {
    name: 'dummy.count_notes',
    description: { id: 'Jumlah catatan tenant aktif', en: 'Number of notes in the active tenant' },
    permission: 'dummy.note.read',
    readOnly: true,
    input: t.Object({}),
    run: async (_input, { db }) => ({
      count: (await db.select(schema.dummyNotes, isNull(schema.dummyNotes.deleted_at))).length,
    }),
  },
]);
