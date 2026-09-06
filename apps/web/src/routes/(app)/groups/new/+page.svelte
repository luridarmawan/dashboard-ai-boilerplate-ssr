<script lang="ts">
import { type FieldDef, FormBuilder } from '$lib/components/form';
import type { LayoutData } from '../../$types';
import type { ActionData } from './$types';

let { data, form }: { data: LayoutData; form: ActionData } = $props();
const fields: FieldDef[] = [
  {
    name: 'code',
    type: 'string',
    label: 'Kode',
    required: true,
    minlength: 2,
    maxlength: 64,
    pattern: '[a-z][a-z0-9_\\-]*',
    hint: 'huruf kecil, angka, - dan _; tetap setelah dibuat',
  },
  { name: 'name', type: 'string', label: 'Nama', required: true, maxlength: 191 },
  { name: 'description', type: 'text', label: 'Deskripsi', rows: 2 },
];
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>Tambah grup</title></svelte:head>

<div class="page">
  <h1>Tambah grup</h1>
  <p class="text-sm text-muted-foreground">Izin dan anggota diatur setelah grup dibuat.</p>
  <FormBuilder {fields} values={(form?.values as Record<string, unknown> | undefined) ?? {}} errors={fieldErrors} csrf={data.csrf} submitLabel="Buat" cancelHref="/groups" error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
</div>
