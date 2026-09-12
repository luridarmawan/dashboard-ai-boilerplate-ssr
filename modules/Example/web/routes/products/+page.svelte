<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { iconActionClass } from '$lib/components/table';
import { Badge, Button, Table } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';

let { data } = $props();
const t = useT();
const locale = useLocale();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
/** Row actions are icons, like /users. */
const editable = $derived(can('example.product.edit'));
const rowAction = $derived(editable ? t('common.edit') : t('common.view'));
const money = (n: number, cur: string) =>
  new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'id-ID', {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: 0,
  }).format(n);
</script>

<svelte:head><title>{t('example.admin.products')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('example.admin.products')}</h1>
    <div class="flex gap-2">
      <Button href="/example" variant="outline" size="sm"><Icon name="external-link" size={16} />{t('example.widget.title')}</Button>
      {#if can('example.product.create')}<Button href="/m/example/products/new" size="sm"><Icon name="plus" size={16} />{t('example.admin.new_product')}</Button>{/if}
    </div>
  </div>
  {#if data.saved === 'deleted'}<p class="notice">{t('example.admin.deleted')}</p>{/if}
  <Table caption={t('example.admin.products')}>
    <thead><tr><th>{t('example.admin.slug')}</th><th>Nama</th><th class="text-end">{t('example.admin.price')}</th><th>{t('example.admin.featured')}</th><th></th></tr></thead>
    <tbody>
      {#each data.products as p (p.id)}
        <tr>
          <td><code>{p.slug}</code></td>
          <td class="font-medium">{p.name}</td>
          <td class="text-end">{money(p.price, p.currency)}</td>
          <td>{#if p.featured}<Badge variant="success">{t('example.admin.featured')}</Badge>{/if}</td>
          <td class="text-end whitespace-nowrap">
            <a href={`/m/example/products/${p.id}`} title={rowAction} aria-label={rowAction} class={iconActionClass}><Icon name={editable ? 'edit' : 'eye'} size={16} /></a>
            <a href={`/product/${p.slug}`} title={t('example.admin.open_public')} aria-label={t('example.admin.open_public')} class={iconActionClass}><Icon name="external-link" size={16} /></a>
          </td>
        </tr>
      {:else}
        <tr><td colspan="5" class="py-8 text-center text-muted-foreground">{t('example.products.empty')}</td></tr>
      {/each}
    </tbody>
  </Table>
</div>
