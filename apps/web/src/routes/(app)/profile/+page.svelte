<script lang="ts">
import { type FieldDef, FormBuilder } from '$lib/components/form';
import { Card } from '$lib/components/ui';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const profileFields: FieldDef[] = $derived([
  { name: 'name', type: 'string', label: 'Nama', required: true, maxlength: 191 },
  {
    name: 'locale',
    type: 'select',
    label: 'Bahasa',
    required: true,
    options: [
      { value: 'id', label: 'Bahasa Indonesia' },
      { value: 'en', label: 'English' },
    ],
  },
  {
    name: 'theme',
    type: 'select',
    label: 'Tema',
    options: data.themes.map((t) => ({ value: t.id, label: t.name })),
    hint: 'Pratinjau dan mode terang/gelap ada di Tema & tampilan.',
  },
  { name: 'avatarUrl', type: 'string', label: 'URL avatar', maxlength: 512 },
]);
const passwordFields: FieldDef[] = [
  {
    name: 'currentPassword',
    type: 'password',
    label: 'Kata sandi saat ini',
    required: true,
    autocomplete: 'current-password',
  },
  {
    name: 'newPassword',
    type: 'password',
    label: 'Kata sandi baru',
    required: true,
    minlength: 12,
    autocomplete: 'new-password',
  },
  {
    name: 'confirm',
    type: 'password',
    label: 'Ulangi kata sandi baru',
    required: true,
    minlength: 12,
    autocomplete: 'new-password',
  },
];
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
const apiError = $derived(form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null);
</script>

<svelte:head><title>Profil</title></svelte:head>

<div class="page">
  <h1>Profil saya</h1>
  <Card title="Data diri & preferensi" description={data.user.email}>
    <FormBuilder
      fields={profileFields}
      values={{ name: data.user.name, locale: data.user.locale, theme: data.user.theme ?? '', avatarUrl: data.user.avatarUrl ?? '' }}
      errors={form?.saved === 'password' ? {} : fieldErrors}
      csrf={data.csrf}
      action="?/profile"
      columns={2}
      notice={form?.saved === 'profile' ? 'Profil tersimpan.' : null}
      error={form?.saved === undefined ? apiError : null}
    />
    <p class="mt-3 text-sm text-muted-foreground"><a href="/theme?back=/profile">Tema &amp; tampilan</a> · <a href="/lang?back=/profile">Bahasa</a></p>
  </Card>
  <Card title="Ganti kata sandi" description="Sesi di perangkat lain akan diakhiri.">
    <FormBuilder fields={passwordFields} errors={fieldErrors} csrf={data.csrf} action="?/password" submitLabel="Ganti kata sandi" notice={form?.saved === 'password' ? 'Kata sandi diganti. Sesi di perangkat lain telah diakhiri.' : null} error={null} />
  </Card>
</div>
