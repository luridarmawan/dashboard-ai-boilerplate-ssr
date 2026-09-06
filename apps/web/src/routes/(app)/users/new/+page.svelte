<script lang="ts">
import { type FieldDef, FormBuilder } from '$lib/components/form';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const fields: FieldDef[] = $derived([
  { name: 'name', type: 'string', label: 'Nama', required: true, maxlength: 191 },
  {
    name: 'email',
    type: 'email',
    label: 'Email',
    required: true,
    hint: 'Akun yang sudah ada dengan email ini akan ditambahkan ke tenant ini.',
  },
  {
    name: 'password',
    type: 'password',
    label: 'Kata sandi',
    minlength: 12,
    autocomplete: 'new-password',
    hint: 'Kosongkan agar pengguna mengatur sendiri lewat tautan set kata sandi.',
  },
  {
    name: 'locale',
    type: 'select',
    label: 'Bahasa',
    options: [
      { value: 'id', label: 'Bahasa Indonesia' },
      { value: 'en', label: 'English' },
    ],
  },
  {
    name: 'groupIds',
    type: 'multiselect',
    label: 'Grup',
    span: 2,
    options: data.groups.map((g) => ({ value: g.id, label: g.name })),
  },
]);
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>Tambah pengguna</title></svelte:head>

<div class="page">
  <h1>Tambah pengguna</h1>
  <FormBuilder
    {fields}
    values={(form?.values as Record<string, unknown> | undefined) ?? { locale: 'id' }}
    errors={fieldErrors}
    csrf={data.csrf}
    columns={2}
    submitLabel="Simpan"
    cancelHref="/users"
    error={form?.error && form.code !== 'validation_failed' ? form.error : form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null}
  />
</div>
