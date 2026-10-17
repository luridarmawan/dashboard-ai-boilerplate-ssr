import { and, type Db, eq, newId, schema } from '@core/db';
import { defineSeed } from '@core/module-kit';

/**
 * Idempotent seed: one published sample page, so a fresh install has something to open at
 * `/about` once the module answers unknown URLs. Matched by slug, on pages AND redirects: an
 * admin who renamed the sample keeps their rename, and re-seeding never steals an old permalink.
 */
const SAMPLE = {
  title: 'Tentang kami',
  slug: 'about',
  summary: 'Contoh halaman dari modul Pages. Ubah atau hapus dari dasbor.',
  body: [
    'Halaman ini dibuat oleh seed modul **Pages**.',
    '',
    '## Permalink',
    '',
    'Ubah slug halaman ini dari dasbor: alamat lamanya tetap bisa dibuka dan dialihkan permanen (301) ke alamat baru.',
  ].join('\n'),
};

export default defineSeed('Pages', async ({ db: raw, tenantId, log }) => {
  const db = raw as Db;
  const [page] = await db
    .select({ id: schema.pagesPages.id })
    .from(schema.pagesPages)
    .where(and(eq(schema.pagesPages.client_id, tenantId), eq(schema.pagesPages.slug, SAMPLE.slug)))
    .limit(1);
  const [redirect] = await db
    .select({ id: schema.pagesRedirects.id })
    .from(schema.pagesRedirects)
    .where(
      and(
        eq(schema.pagesRedirects.client_id, tenantId),
        eq(schema.pagesRedirects.old_slug, SAMPLE.slug),
      ),
    )
    .limit(1);
  if (page || redirect) return log('tidak ada yang baru');
  await db.insert(schema.pagesPages).values({
    id: newId(),
    client_id: tenantId,
    ...SAMPLE,
    status: 'published',
    published_at: new Date(),
  });
  log('1 halaman contoh dibuat');
});
