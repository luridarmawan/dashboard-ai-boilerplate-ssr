<script lang="ts">
import { FormBuilder } from '$lib/components/form';
import { webhookFields } from '../_form.ts';

let { data, form } = $props();
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>Tambah webhook</title></svelte:head>

<div class="page">
  <h1>Tambah webhook</h1>
  <p class="text-sm text-muted-foreground">Secret penanda tangan dibuat otomatis dan ditampilkan sekali setelah disimpan.</p>
  <FormBuilder fields={webhookFields(data.events)} values={(form?.values as Record<string, unknown> | undefined) ?? { enabled: true, events: ['*'] }} errors={fieldErrors} csrf={data.csrf} columns={2} submitLabel="Simpan" cancelHref="/webhooks" error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
</div>
