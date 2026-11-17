# Kesepakatan Form Simpan Data

Dokumen ini mengatur **form yang menyimpan atau mengubah data**: buat, ubah, hapus, ganti status, unggah berkas, di core maupun di modul. Semua form baru wajib mengikutinya. Form lama yang belum sesuai dirapikan bertahap (lihat [Status](#status)).

Contoh hidup yang sudah sesuai: halaman Pengaturan (`apps/web/src/routes/(app)/settings/+page.svelte`).

**Di luar cakupan:** login, daftar, lupa/reset kata sandi, logout, form pencarian/filter (`GET`), pemilih bahasa dan tema, serta chat AI. Form-form itu punya alur sendiri dan tidak memakai popup simpan.

## Ringkasan aturan

| # | Aturan |
|---|---|
| 1 | Form adalah `<form method="POST" action="?/…">` asli dengan `<Csrf>`, dan tetap berfungsi tanpa JavaScript (PRD L-22). |
| 2 | Dengan JavaScript, form dikirim lewat `use:enhance` (fetch), **tanpa muat ulang halaman**. Isian, posisi gulir, dan tab yang terbuka tetap di tempatnya. |
| 3 | Hasil simpan ditampilkan sebagai **popup notifikasi di kanan bawah** lewat `toast()` dari `@core/ui`. Berhasil = `variant: 'success'` (hijau). Gagal = `variant: 'error'` (merah). |
| 4 | Tidak ada pesan "Tersimpan" di dalam halaman (`<p class="notice">`). Popup sudah menggantikannya. |
| 5 | Galat per field tetap tampil di bawah field-nya. Popup gagal hanya ringkasan, lalu halaman menggulir ke field pertama yang salah. |
| 6 | Selama dikirim, tombol simpan `disabled` dan menampilkan ikon berputar. Form diberi `aria-busy="true"`. |
| 7 | Warna popup tidak diatur sendiri. `Toaster` sudah memakai token tema (`--success`, `--destructive`). Jangan membuat komponen popup lain. |

## Popup

| Hasil | `variant` | Judul | Deskripsi | Durasi |
|---|---|---|---|---|
| Berhasil (`success` atau `redirect`) | `success` | `common.saved` ("Tersimpan."), atau kalimat yang lebih spesifik (mis. `example.product.saved`) | — | 3000 ms |
| Gagal validasi (`failure`) | `error` | `<ns>.<entitas>.save_failed` (mis. "Gagal menyimpan") | `data.error` dari server. Bila lebih dari satu field salah: "N isian perlu diperbaiki" (`<ns>.<entitas>.fields_to_fix`) | 8000 ms |
| Galat tak terduga (`error`) | `error` | sama seperti di atas | `common.action_failed` | 8000 ms |

Popup gagal tampil lebih lama karena pengguna perlu membaca alasannya. `Toaster` sudah terpasang sekali di layout root, jadi halaman cukup memanggil `toast()`.

## Pola baku

```svelte
<script lang="ts">
import { Button, Icon, toast } from '@core/ui';
import { enhance } from '$app/forms';
import Csrf from '$lib/components/Csrf.svelte';
import { useT } from '$lib/i18n';

let { data, form } = $props();
const t = useT();
let submitting = $state(false);

// Marks the form as hydrated so an e2e test can tell the fetch path from the plain POST.
let hydrated = $state(false);
$effect(() => {
  hydrated = true;
});

/** Scroll to the first invalid field (or the error banner) after a failed save. */
function revealProblem(formEl: HTMLFormElement) {
  const target =
    formEl.querySelector<HTMLElement>('[aria-invalid="true"]') ??
    formEl.querySelector<HTMLElement>('[role="alert"]');
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (target.matches('input, select, textarea')) target.focus({ preventScroll: true });
}
</script>

<form
  method="POST"
  action="?/save"
  data-enhanced={hydrated ? 'true' : null}
  aria-busy={submitting ? 'true' : undefined}
  use:enhance={({ formElement }) => {
    submitting = true;
    return async ({ update, result }) => {
      // The toast store outlives client-side navigation, so a redirect (create → detail) can be
      // announced here, before `update()` follows it.
      if (result.type === 'success' || result.type === 'redirect') {
        toast({ title: t('common.saved'), variant: 'success' }, 3000);
      }
      await update({ reset: false });
      submitting = false;
      if (result.type !== 'failure' && result.type !== 'error') return;
      const failed = (result.type === 'failure' ? result.data : undefined) as
        | { error?: string; details?: Record<string, string> | null }
        | undefined;
      const fields = failed?.details ? Object.keys(failed.details).length : 0;
      toast(
        {
          title: t('mymodule.item.save_failed'),
          description:
            fields > 1
              ? t('mymodule.item.fields_to_fix', { n: fields })
              : (failed?.error ?? t('common.action_failed')),
          variant: 'error',
        },
        8000,
      );
      if (fields) revealProblem(formElement);
    };
  }}
>
  <Csrf token={data.csrf} />
  <!-- fields; each shows its own error from form?.details -->
  <Button type="submit" disabled={submitting}>
    {#if submitting}<Icon name="refresh" size={16} class="animate-spin" />{/if}
    {t('common.save')}
  </Button>
</form>
```

Catatan:

- `update({ reset: false })` wajib. Tanpanya isian kembali ke nilai saat halaman dirender.
- Bila action server mengarahkan ulang (`redirect(303, …)`), popup berhasil dipanggil di callback **sebelum** `update()`. Halaman tujuan tidak perlu menampilkan pesan "berhasil" sendiri.
- Bila halaman perlu memuat ulang datanya tanpa berpindah (mis. Pengaturan), panggil `invalidateAll()` setelah popup.
- Form yang mengunggah berkas mengosongkan `<input type="file">` setelah berhasil, supaya berkas yang sama tidak ikut terkirim lagi pada simpan berikutnya.

## Tanpa JavaScript

Form tetap harus bisa dipakai tanpa JavaScript (L-22), tetapi popup memang butuh JavaScript. Polanya:

- Action server mengarahkan ke halaman yang sama dengan penanda, mis. `?saved=<bagian>`.
- Halaman menampilkan popup sekali di `onMount` bila penanda itu ada. Jangan di `$effect`: `invalidateAll()` mengembalikan `data.saved` yang sama dan popup akan muncul dua kali.
- Galat per field dan banner galat (`role="alert"`) tetap dirender server, sehingga pengunjung tanpa JavaScript tetap melihat apa yang salah.

```ts
onMount(() => {
  if (data.saved) toast({ title: t('common.saved'), variant: 'success' }, 3000);
});
```

## Hapus dan aksi berbahaya

Hapus tetap lewat `ConfirmDelete` (konfirmasi dulu, L-22). Setelah aksi berhasil, beri popup `success` dengan kalimat yang sesuai (mis. "Dihapus."). Bila gagal, beri popup `error` seperti di atas.

## i18n

| Kunci | Pakai untuk |
|---|---|
| `common.saved` | judul popup berhasil yang umum |
| `common.action_failed` | deskripsi popup saat galat tak terduga |
| `<ns>.<entitas>.save_failed` | judul popup gagal milik modul/halaman (mis. `settings.save_failed`) |
| `<ns>.<entitas>.fields_to_fix` | "N isian perlu diperbaiki", dengan parameter `{n}` |

Semua teks lewat katalog i18n: kunci core di `packages/i18n/messages/{id,en}.json`, kunci modul di `modules/<Modul>/i18n/{id,en}.json`. Jangan menulis teks popup langsung di kode.

## Pengujian

`Toaster` memberi setiap popup `role="status"` dan `data-variant`, jadi tes e2e bisa memeriksa hasilnya:

```ts
await expect(page.locator('[role="status"][data-variant="success"]')).toBeVisible();
await expect(page.locator('[role="status"][data-variant="error"]')).toContainText('Gagal');
```

Tunggu `form[data-enhanced="true"]` sebelum mengisi form, supaya yang diuji adalah jalur fetch, bukan POST biasa.

## Status

Per 2026-11-17, yang sudah mengikuti kesepakatan ini (popup berhasil dan gagal): halaman Pengaturan.

Baru sebagian:

- Webhook (`webhooks/[id]`) dan outbox: popup gagal, popup berhasil hanya pada sebagian aksi.
- Permalink Pages (`modules/Pages/web/routes/pages/[id]`) dan gambar unggulan (`FeaturedImage`): sudah memakai popup, belum seluruh hasilnya.

Belum sesuai (dirapikan bertahap, tidak wajib sekaligus):

- **`FormBuilder`**: opsi `ajax` sudah mengirim lewat fetch, tetapi belum memunculkan popup. Halaman yang memakainya (user, grup, tenant, webhook baru, produk Example, Pages, penyedia dan server MCP AI) masih menampilkan `notice`/`error` di dalam halaman.
- Form core lain tanpa `use:enhance`: profil (sebagian), detail user dan grup, tema, modul, antrean, notifikasi.

Saat menyentuh salah satu form di atas, rapikan sekalian mengikuti dokumen ini. Aplikasi turunan boleh menambah daftar status form modulnya sendiri di dokumen modulnya.
