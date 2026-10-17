import { claimPermalink, PermalinkConflictError } from '@app/api/permalinks';
import { and, type Db, eq, isNull, newId, schema, tenantScope } from '@core/db';
import { defineSeed } from '@core/module-kit';
import { MODULE, pathOf } from './api/permalinks.ts';

/**
 * Idempotent seed:
 *   1. every live page gets its URL in the core permalink registry (PRD F-12) if it has none —
 *      pages written before the registry existed, or by hand, become reachable again
 *   2. one published sample page at `/about`, unless something already holds that URL (an
 *      admin's own page, an old permalink, another module): re-seeding never steals a URL
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
  const tenant = tenantScope(db, tenantId);
  let claimed = 0;
  const pages = await tenant.select(schema.pagesPages, isNull(schema.pagesPages.deleted_at));
  for (const page of pages) {
    const has = await tenant.selectOne(
      schema.permalinks,
      and(eq(schema.permalinks.module, MODULE), eq(schema.permalinks.target, page.id)),
    );
    if (has) continue;
    try {
      await claimPermalink(tenant, {
        module: MODULE,
        target: page.id,
        path: pathOf(page.slug),
        live: page.status === 'published',
        keepHistory: false,
      });
      claimed++;
    } catch (err) {
      if (!(err instanceof PermalinkConflictError)) throw err;
      log(
        `halaman "${page.title}": alamat /${page.slug} sudah dipakai — ubah slug-nya dari dasbor`,
      );
    }
  }

  const taken = await tenant.selectOne(
    schema.permalinks,
    eq(schema.permalinks.path, pathOf(SAMPLE.slug)),
  );
  const sampleExists = pages.some((p) => p.slug === SAMPLE.slug);
  let created = 0;
  if (!taken && !sampleExists) {
    const id = newId();
    await tenant.insert(schema.pagesPages, {
      id,
      ...SAMPLE,
      status: 'published',
      published_at: new Date(),
    });
    await claimPermalink(tenant, {
      module: MODULE,
      target: id,
      path: pathOf(SAMPLE.slug),
      live: true,
      keepHistory: false,
    });
    created = 1;
  }
  log(
    claimed || created
      ? `${claimed} alamat didaftarkan, ${created} halaman contoh dibuat`
      : 'tidak ada yang baru',
  );
});
