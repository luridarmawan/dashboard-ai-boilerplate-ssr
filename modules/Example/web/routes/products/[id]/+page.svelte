<script lang="ts">
import { FormBuilder } from '$lib/components/form';
import { Card, ConfirmDelete } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import { productFields } from '../_form.ts';

let { data, form } = $props();
const t = useT();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const p = $derived(data.product);
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{p.name}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3"><h1>{p.name}</h1><a href={`/product/${p.slug}`} class="text-sm">/product/{p.slug} ↗</a></div>
  <Card>
    <FormBuilder
      fields={productFields}
      values={{ name: p.name, slug: p.slug, price: p.price, sort: p.sort, featured: p.featured, imageUrl: p.imageUrl ?? '', summary: p.summary ?? '', description: p.description ?? '' }}
      errors={fieldErrors}
      csrf={data.csrf}
      action="?/save"
      columns={2}
      readonly={!can('example.product.edit')}
      cancelHref="/m/example/products"
      cancelLabel={t('common.back')}
      notice={form?.saved || data.saved ? t('example.admin.saved') : null}
      error={form?.error && form.code !== 'confirm_failed' && Object.keys(fieldErrors).length === 0 ? form.error : null}
    />
  </Card>
  {#if can('example.product.manage')}
    <Card title={t('example.admin.delete_product')} description={t('example.admin.delete_hint')}>
      <ConfirmDelete
        csrf={data.csrf}
        href={`/m/example/products/${p.id}?confirm=delete#confirm-delete`}
        cancelHref={`/m/example/products/${p.id}`}
        confirming={data.confirmDelete || form?.code === 'confirm_failed'}
        error={form?.code === 'confirm_failed' ? form.error : null}
        description={t('example.admin.delete_confirm_lead', { name: p.name, slug: p.slug })}
      />
    </Card>
  {/if}
</div>
