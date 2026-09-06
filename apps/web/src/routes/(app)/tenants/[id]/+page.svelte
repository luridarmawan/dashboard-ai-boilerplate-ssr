<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { type FieldDef, FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card } from '$lib/components/ui';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const c = $derived(data.client);
const fields: FieldDef[] = [
  { name: 'name', type: 'string', label: 'Nama', required: true, maxlength: 191 },
  { name: 'active', type: 'boolean', label: 'Aktif' },
];
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>Tenant {c.name}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3"><h1>{c.name}</h1><code>{c.code}</code><Badge variant={c.statusId === 1 ? 'success' : 'secondary'}>{c.statusId === 1 ? 'aktif' : 'nonaktif'}</Badge></div>
  <Card>
    <FormBuilder {fields} values={{ name: c.name, active: c.statusId === 1 }} errors={fieldErrors} csrf={data.csrf} action="?/save" readonly={!can('client.edit')} cancelHref="/tenants" cancelLabel="Kembali" notice={form?.saved ? 'Tersimpan.' : null} error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
  </Card>
  {#if can('client.manage') && c.code !== 'default'}
    <Card title="Hapus tenant" description="Hapus lunak; sesi yang sedang berada di tenant ini kembali ke &quot;tanpa tenant&quot;.">
      <form method="POST" action="?/delete"><Csrf token={data.csrf} /><Button type="submit" variant="destructive"><Icon name="trash" size={16} />Hapus tenant</Button></form>
    </Card>
  {/if}
</div>
