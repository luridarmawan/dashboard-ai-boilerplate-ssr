<script lang="ts">
import { FormBuilder } from '$lib/components/form';
import Img from '$lib/components/Img.svelte';
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

{#snippet photo()}
  <!-- Third column of the form grid on `lg`: the photo stands beside slug/order/image URL, and
       summary + description run full width under it. Narrower than that the grid is two columns
       and this simply sits on top. `self-start` keeps the 4:5 box from stretching over the three
       rows it spans. -->
  <div class="relative aspect-[4/5] w-40 self-start overflow-hidden rounded-lg border bg-gradient-to-br from-primary/30 via-primary/10 to-accent sm:col-span-2 lg:col-span-1 lg:col-start-3 lg:row-span-3 lg:row-start-1">
    {#if p.imageUrl}
      <!-- The image the storefront serves, at admin size: the editor sees the picture, not just
           the URL in the field beside it. -->
      <Img src={p.imageUrl} alt={p.name} priority width={320} height={400} class="h-full w-full object-cover" />
    {:else}
      <span class="absolute -bottom-6 -end-2 select-none text-8xl font-semibold leading-none text-primary/20" aria-hidden="true">{p.name.trim().charAt(0).toUpperCase()}</span>
    {/if}
  </div>
{/snippet}

<svelte:head><title>{p.name}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3"><h1>{p.name}</h1><a href={`/product/${p.slug}`} class="text-sm">/product/{p.slug} ↗</a></div>
  <Card>
    <FormBuilder
      fields={productFields(t)}
      values={{ name: p.name, slug: p.slug, price: p.price, sort: p.sort, featured: p.featured, imageUrl: p.imageUrl ?? '', summary: p.summary ?? '', description: p.description ?? '' }}
      errors={fieldErrors}
      csrf={data.csrf}
      action="?/save"
      ajax
      columns={3}
      class="lg:grid-cols-[1fr_1fr_auto]"
      aside={photo}
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
