<script lang="ts">
import { type FieldDef, FormBuilder } from '$lib/components/form';
import { Card } from '$lib/components/ui';
import type { LayoutData } from '../../$types';
import type { ActionData } from './$types';

let { data, form }: { data: LayoutData; form: ActionData } = $props();
const fields: FieldDef[] = [
  {
    name: 'name',
    type: 'string',
    label: 'Nama produk',
    required: true,
    minlength: 3,
    maxlength: 120,
  },
  {
    name: 'sku',
    type: 'string',
    label: 'SKU',
    required: true,
    pattern: '[A-Z0-9\\-]{3,20}',
    hint: 'Huruf besar, angka, tanda minus.',
  },
  {
    name: 'category',
    type: 'select',
    label: 'Kategori',
    required: true,
    options: [
      { value: 'minuman', label: 'Minuman' },
      { value: 'bumbu', label: 'Bumbu' },
      { value: 'pemanis', label: 'Pemanis' },
    ],
  },
  { name: 'price', type: 'number', label: 'Harga (Rp)', required: true, min: 0, step: 500 },
  { name: 'stock', type: 'number', label: 'Stok', required: true, min: 0, step: 1 },
  { name: 'releasedAt', type: 'date', label: 'Tanggal rilis' },
  { name: 'published', type: 'boolean', label: 'Tayang' },
  {
    name: 'tags',
    type: 'multiselect',
    label: 'Tag',
    options: ['organik', 'lokal', 'promo', 'baru', 'terbatas'].map((v) => ({ value: v, label: v })),
  },
  { name: 'image', type: 'file', label: 'Gambar', accept: 'image/*' },
  { name: 'description', type: 'text', label: 'Deskripsi', rows: 3 },
  { name: 'notes', type: 'markdown', label: 'Catatan (Markdown)' },
];
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>Contoh · Form</title></svelte:head>

<div class="page">
  <h1>Form</h1>
  <p class="text-muted-foreground">Setiap tipe field FormBuilder (L-17). Validasi memakai skema TypeBox yang sama dengan API; galat muncul di bawah field tanpa JavaScript.</p>
  <Card>
    <FormBuilder {fields} values={(form?.values as Record<string, unknown> | undefined) ?? { category: 'minuman', stock: 0, price: 0 }} errors={fieldErrors} csrf={data.csrf} columns={2} submitLabel="Simpan produk" cancelHref="/examples" notice={form?.saved ? 'Valid — di modul nyata, ini saatnya memanggil API.' : null} error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
  </Card>
</div>
