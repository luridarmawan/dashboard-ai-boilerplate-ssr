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
    maxlength: 32,
    pattern: '[a-z][a-z0-9_\\-]*',
  },
  { name: 'name', type: 'string', label: 'Nama', required: true, maxlength: 191 },
];
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>Tambah tenant</title></svelte:head>

<div class="page">
  <h1>Tambah tenant</h1>
  <p class="text-sm text-muted-foreground">Tenant baru langsung punya grup <code>admin</code> dan <code>user</code>; Anda menjadi anggota dan admin pertamanya.</p>
  <FormBuilder {fields} values={(form?.values as Record<string, unknown> | undefined) ?? {}} errors={fieldErrors} csrf={data.csrf} submitLabel="Buat" cancelHref="/tenants" error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
</div>
