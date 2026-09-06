import { and, type Db, eq, newId, schema } from '@core/db';
import { defineSeed } from '@core/module-kit';

/** Idempotent seed (O-3): one sample row for the default tenant, created only when absent. */
export default defineSeed('Hello', async ({ db: raw, tenantId, log }) => {
  const db = raw as Db;
  const [row] = await db
    .select({ id: schema.helloNotes.id })
    .from(schema.helloNotes)
    .where(
      and(eq(schema.helloNotes.client_id, tenantId), eq(schema.helloNotes.title, 'Contoh note')),
    )
    .limit(1);
  if (row) return;
  await db
    .insert(schema.helloNotes)
    .values({ id: newId(), client_id: tenantId, title: 'Contoh note' } as never);
  log('1 baris contoh dibuat');
});
