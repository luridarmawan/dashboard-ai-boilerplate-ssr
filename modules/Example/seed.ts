import { and, type Db, eq, newId, schema } from '@core/db';
import { defineSeed } from '@core/module-kit';

/**
 * Idempotent demo data for the storefront (R-3): a clean install shows a convincing landing.
 * Existing rows (matched by slug / author) are left alone — an admin's edits survive re-seeding.
 */
const PRODUCTS = [
  {
    slug: 'gayo-arabika',
    name: 'Gayo Arabika',
    summary: 'Manis, body tebal, sedikit rempah. Ketinggian 1.400 mdpl.',
    price: 85000,
    featured: true,
    sort: 10,
    image_url: null as string | null,
  },
  {
    slug: 'toraja-sapan',
    name: 'Toraja Sapan',
    summary: 'Earthy dengan sentuhan cokelat gelap dan tembakau.',
    price: 92000,
    featured: true,
    sort: 20,
    image_url: null,
  },
  {
    slug: 'kintamani-natural',
    name: 'Kintamani Natural',
    summary: 'Proses natural: buah tropis, jeruk, dan madu.',
    price: 98000,
    featured: true,
    sort: 30,
    image_url: null,
  },
  {
    slug: 'flores-bajawa',
    name: 'Flores Bajawa',
    summary: 'Karamel, kacang, dan keasaman lembut.',
    price: 88000,
    featured: false,
    sort: 40,
    image_url: null,
  },
  {
    slug: 'house-blend',
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
  for (const p of PRODUCTS) {
    const [row] = await db
      .select({ id: schema.exampleProducts.id })
      .from(schema.exampleProducts)
      .where(
        and(
          eq(schema.exampleProducts.client_id, tenantId),
          eq(schema.exampleProducts.slug, p.slug),
        ),
      )
      .limit(1);
    if (row) continue;
    await db.insert(schema.exampleProducts).values({
      id: newId(),
      client_id: tenantId,
      slug: p.slug,
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
