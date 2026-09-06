import { tableStateFrom } from '$lib/components/table';
import type { PageServerLoad } from './$types';

/** In-memory data so the pattern is self-contained; a real page calls the API in exactly this shape. */
export const _layoutVariant = 'wide';

const PRODUCTS = Array.from({ length: 57 }, (_, i) => ({
  id: `00000000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
  name: `${
    [
      'Kopi Gayo',
      'Teh Melati',
      'Gula Aren',
      'Madu Hutan',
      'Kakao Bali',
      'Kayu Manis',
      'Vanili',
      'Lada Hitam',
    ][i % 8]
  } #${i + 1}`,
  category: ['Minuman', 'Bumbu', 'Pemanis'][i % 3] ?? 'Minuman',
  price: 12000 + ((i * 3750) % 90000),
  stock: (i * 7) % 40,
  status: i % 5 === 0 ? 'draft' : 'aktif',
}));

export const load: PageServerLoad = async ({ url }) => {
  const st = tableStateFrom(url, { sort: 'name' });
  let rows = PRODUCTS.filter(
    (p) =>
      !st.q ||
      p.name.toLowerCase().includes(st.q.toLowerCase()) ||
      p.category.toLowerCase().includes(st.q.toLowerCase()),
  );
  const key = (['name', 'category', 'price', 'stock'] as const).includes(st.sort as never)
    ? (st.sort as 'name' | 'category' | 'price' | 'stock')
    : 'name';
  rows = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const c =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
    return st.order === 'desc' ? -c : c;
  });
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / st.limit));
  const pageRows = rows.slice((st.page - 1) * st.limit, st.page * st.limit);
  return { rows: pageRows, state: { ...st, sort: key, total, totalPages } };
};

export const actions = {
  archive: async ({ request }) => {
    const form = await request.formData();
    return { archived: form.getAll('ids').length };
  },
};
