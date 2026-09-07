import { and, eq, isNull, like, schema } from '@core/db';
import { defineTools } from '@core/module-kit';
import { t } from 'elysia';

/**
 * AI / MCP tools (extension point 8, I-3). Each one runs with the caller's tenant facade and only
 * for callers holding the named permission — the core registry enforces both (I-6); the module
 * just declares. `input` is TypeBox → JSON Schema: one declaration validates the arguments,
 * describes them to the model (OpenAI `parameters`) and to MCP clients (`inputSchema`).
 */
export default defineTools('Example', [
  {
    name: 'example.list_products',
    description: {
      id: 'Daftar produk katalog tenant aktif; opsional filter nama (q) dan hanya unggulan (featured). Pakai saat pengguna bertanya produk apa yang tersedia, harga, atau detail produk.',
      en: 'List the active tenant’s catalogue products, optionally filtered by name (q) and featured only. Use when the user asks which products exist, their prices, or product details.',
    },
    permission: 'example.product.read',
    readOnly: true,
    input: t.Object({
      q: t.Optional(t.String({ maxLength: 120, description: 'Potongan nama produk' })),
      featured: t.Optional(t.Boolean({ description: 'Hanya produk unggulan' })),
      limit: t.Optional(t.Integer({ minimum: 1, maximum: 50, default: 20 })),
    }),
    run: async (input, { db }) => {
      const q = typeof input.q === 'string' ? input.q.trim() : '';
      const limit = typeof input.limit === 'number' ? input.limit : 20;
      const rows = await db.select(
        schema.exampleProducts,
        and(
          isNull(schema.exampleProducts.deleted_at),
          input.featured === true ? eq(schema.exampleProducts.featured, true) : undefined,
          q ? like(schema.exampleProducts.name, `%${q}%`) : undefined,
        ),
      );
      return {
        total: rows.length,
        products: rows
          .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
          .slice(0, limit)
          .map((p) => ({
            slug: p.slug,
            name: p.name,
            summary: p.summary,
            price: p.price,
            currency: p.currency,
            featured: p.featured,
          })),
      };
    },
  },
  {
    name: 'example.count_inquiries',
    description: {
      id: 'Jumlah pesan masuk (inquiry) dari form kontak per status. Pakai saat pengguna menanyakan berapa pesan baru/belum dibaca.',
      en: 'Count contact-form inquiries by state. Use when the user asks how many new or unread messages there are.',
    },
    permission: 'example.inquiry.read',
    readOnly: true,
    input: t.Object({}),
    run: async (_input, { db }) => {
      const rows = await db.select(schema.exampleInquiries);
      const byState: Record<string, number> = {};
      for (const r of rows) byState[r.state] = (byState[r.state] ?? 0) + 1;
      return { total: rows.length, byState };
    },
  },
]);
