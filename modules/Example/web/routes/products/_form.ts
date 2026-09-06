import type { FieldDef } from '$lib/components/form';

/** Field declarations for the product form (FormBuilder, L-17); shared by new + edit. */
export const productFields: FieldDef[] = [
  { name: 'name', type: 'string', label: 'Nama', required: true, minlength: 2, maxlength: 191 },
  {
    name: 'slug',
    type: 'string',
    label: 'Slug',
    required: true,
    pattern: '[a-z0-9]+(-[a-z0-9]+)*',
    hint: 'URL: /product/<slug>',
  },
  {
    name: 'price',
    type: 'number',
    label: 'Harga (IDR, satuan terkecil)',
    required: true,
    min: 0,
    step: 500,
  },
  { name: 'sort', type: 'number', label: 'Urutan', min: 0, step: 1 },
  { name: 'featured', type: 'boolean', label: 'Tampilkan di beranda (unggulan)' },
  { name: 'imageUrl', type: 'string', label: 'URL gambar', maxlength: 512 },
  { name: 'summary', type: 'text', label: 'Ringkasan', rows: 2, maxlength: 512 },
  { name: 'description', type: 'markdown', label: 'Deskripsi' },
];
