import { and, type Db, eq, newId, schema } from '@core/db';
import { defineSeed } from '@core/module-kit';

/**
 * Idempotent demo data for the storefront (R-3): a clean install shows a convincing landing.
 * Existing rows (matched by slug / author) are left alone — an admin's edits survive re-seeding.
 */
const CATEGORIES = [
  {
    slug: 'single-origin',
    name: 'Single origin',
    description: 'Satu kebun, satu karakter. Dipanggang terang sampai medium.',
    sort: 10,
  },
  {
    slug: 'blend',
    name: 'Blend',
    description: 'Racikan harian yang konsisten untuk espresso dan susu.',
    sort: 20,
  },
];
const PRODUCTS = [
  {
    slug: 'gayo-arabika',
    category: 'single-origin',
    name: 'Gayo Arabika',
    summary: 'Manis, body tebal, sedikit rempah. Ketinggian 1.400 mdpl.',
    price: 85000,
    featured: true,
    sort: 10,
    image_url: 'https://picsum.photos/id/225/400/500',
  },
  {
    slug: 'toraja-sapan',
    category: 'single-origin',
    name: 'Toraja Sapan',
    summary: 'Earthy dengan sentuhan cokelat gelap dan tembakau.',
    price: 92000,
    featured: true,
    sort: 20,
    image_url: 'https://picsum.photos/id/220/400/500',
  },
  {
    slug: 'kintamani-natural',
    category: 'single-origin',
    name: 'Kintamani Natural',
    summary: 'Proses natural: buah tropis, jeruk, dan madu.',
    price: 98000,
    featured: true,
    sort: 30,
    image_url: 'https://picsum.photos/id/292/400/500?blur=2',
  },
  {
    slug: 'flores-bajawa',
    category: 'single-origin',
    name: 'Flores Bajawa',
    summary: 'Karamel, kacang, dan keasaman lembut.',
    price: 88000,
    featured: false,
    sort: 40,
    image_url: 'https://picsum.photos/id/316/400/500',
  },
  {
    slug: 'house-blend',
    category: 'blend',
    name: 'House Blend',
    summary: 'Racikan harian untuk espresso dan susu.',
    price: 72000,
    featured: false,
    sort: 50,
    image_url: null,
  },
];
const TESTIMONIALS = [
  {
    author: 'Rina Wijaya',
    role: 'Pemilik kafe, Bandung',
    quote: 'Konsistensi sangrainya luar biasa. Pelanggan kami langsung notice bedanya.',
    sort: 10,
  },
  {
    author: 'Dimas Prasetyo',
    role: 'Home brewer',
    quote: 'Tanggal sangrai jelas, kirimnya cepat. Kintamani natural-nya juara.',
    sort: 20,
  },
  {
    author: 'Sari Lestari',
    role: 'Procurement, kantor 200 orang',
    quote: 'Paket bisnisnya mempermudah faktur bulanan kami.',
    sort: 30,
  },
];

export default defineSeed('Example', async ({ db: raw, tenantId, log }) => {
  const db = raw as Db;
  let created = 0;
  // Categories first: the products below point at them by slug.
  const categoryIds = new Map<string, string>();
  for (const c of CATEGORIES) {
    const [row] = await db
      .select({ id: schema.exampleCategories.id })
      .from(schema.exampleCategories)
      .where(
        and(
          eq(schema.exampleCategories.client_id, tenantId),
          eq(schema.exampleCategories.slug, c.slug),
        ),
      )
      .limit(1);
    if (row) {
      categoryIds.set(c.slug, row.id);
      continue;
    }
    const id = newId();
    await db.insert(schema.exampleCategories).values({
      id,
      client_id: tenantId,
      slug: c.slug,
      name: c.name,
      description: c.description,
      sort: c.sort,
    });
    categoryIds.set(c.slug, id);
    created++;
  }
  for (const p of PRODUCTS) {
    const [row] = await db
      .select({ id: schema.exampleProducts.id, category_id: schema.exampleProducts.category_id })
      .from(schema.exampleProducts)
      .where(
        and(
          eq(schema.exampleProducts.client_id, tenantId),
          eq(schema.exampleProducts.slug, p.slug),
        ),
      )
      .limit(1);
    if (row) {
      // A product seeded before categories existed gets its category once; an admin's later
      // choice (any non-null value) is left alone.
      if (!row.category_id && categoryIds.get(p.category)) {
        await db
          .update(schema.exampleProducts)
          .set({ category_id: categoryIds.get(p.category) ?? null })
          .where(eq(schema.exampleProducts.id, row.id));
      }
      continue;
    }
    await db.insert(schema.exampleProducts).values({
      id: newId(),
      client_id: tenantId,
      slug: p.slug,
      category_id: categoryIds.get(p.category) ?? null,
      name: p.name,
      summary: p.summary,
      description: `${p.summary}\n\nDikemas 250 g, kantong katup satu arah. Tersedia biji utuh atau giling sesuai alat seduh Anda.`,
      price: p.price,
      currency: 'IDR',
      image_url: p.image_url,
      featured: p.featured,
      sort: p.sort,
    });
    created++;
  }
  for (const t of TESTIMONIALS) {
    const [row] = await db
      .select({ id: schema.exampleTestimonials.id })
      .from(schema.exampleTestimonials)
      .where(
        and(
          eq(schema.exampleTestimonials.client_id, tenantId),
          eq(schema.exampleTestimonials.author, t.author),
        ),
      )
      .limit(1);
    if (row) continue;
    await db.insert(schema.exampleTestimonials).values({
      id: newId(),
      client_id: tenantId,
      author: t.author,
      role: t.role,
      quote: t.quote,
      avatar_url: null,
      sort: t.sort,
    });
    created++;
  }
  log(created ? `${created} baris demo dibuat` : 'tidak ada yang baru');
});
