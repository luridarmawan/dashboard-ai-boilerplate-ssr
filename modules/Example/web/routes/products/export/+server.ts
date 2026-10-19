import { type Column, exportFormat, exportResponse, fileSlug } from '@core/export';
import { createTranslator } from '@core/i18n';
import type { RequestHandler } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';

/**
 * Products of the active tenant as a file: `?format=xlsx` (default) or `?format=csv`. The
 * reference for list exports — the rows come from the module's own API, so the API keeps
 * deciding who may read them; this route only shapes the file. Column titles follow the
 * reader's language. The page links here through `<ExportMenu href="/m/example/products/export" />`.
 */
type Product = {
  slug: string;
  name: string;
  summary: string | null;
  price: number;
  currency: string;
  featured: boolean;
  sort: number;
  updatedAt: string;
};

export const GET: RequestHandler = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const res = await apiFor(event).v1.m.example.admin.products.get();
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403 ? 'Anda tidak punya izin melihat produk' : 'Produk tidak bisa dimuat',
    );
  const columns: Column<Product>[] = [
    { header: t('example.admin.slug'), value: (p) => p.slug },
    { header: t('example.admin.form.name'), value: (p) => p.name },
    { header: t('example.admin.form.summary'), value: (p) => p.summary, width: 40 },
    { header: t('example.admin.price'), value: (p) => p.price, type: 'number' },
    { header: 'Currency', value: (p) => p.currency },
    { header: t('example.admin.featured'), value: (p) => p.featured, type: 'boolean' },
    { header: t('example.admin.form.sort'), value: (p) => p.sort, type: 'number' },
    { header: 'Updated', value: (p) => p.updatedAt, type: 'date' },
  ];
  const title = t('example.admin.products');
  return exportResponse(
    {
      name: title,
      heading: [title, new Date().toISOString().slice(0, 10)],
      columns,
      rows: res.data.data as Product[],
      booleanText: ['✓', ''],
    },
    exportFormat(event.url.searchParams.get('format'), 'xlsx'),
    fileSlug(title, 'products'),
  );
};
