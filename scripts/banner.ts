#!/usr/bin/env bun
/**
 * Banner start-up bersama untuk `bun dev` dan `bun start`.
 *
 * Satu tampilan untuk dua perintah, supaya sekali lihat terminal sudah jelas: aplikasi apa,
 * jalan sebagai development atau production, versi berapa, dan alamat mana yang harus dibuka.
 *
 * Nama produknya diambil dari `APP_NAME`, atau dari `APP_LANDING_TITLE` yang sudah menamai
 * deployment ini di halaman depan (§4.7) — turunan boilerplate ini memakai namanya sendiri tanpa
 * menyentuh kode. Versinya dari package.json root, sumber yang sama dengan `coreVersion` di
 * katalog modul (G-16).
 */
import { render } from 'cfonts';
import pc from 'picocolors';
import pkg from '../package.json' with { type: 'json' };

export type BannerMode = 'development' | 'production';

/**
 * Judul dalam huruf besar cfonts. cfonts sendiri yang melipat barisnya bila tidak muat, jadi
 * lebarnya diberitahukan di sini: tepi kanan hanya ada di terminal sungguhan — output yang
 * dialirkan ke berkas log atau journal tidak perlu dilipat.
 */
function title(text: string): string {
  const width = process.stdout.isTTY ? (process.stdout.columns ?? 80) : 1000;
  const out = render(
    text,
    {
      font: 'chrome',
      align: 'left',
      spaceless: true, // baris kosong atas/bawah diatur pemanggil, bukan cfonts
      // picocolors mematikan warna sendiri di luar terminal (pipa, CI); cfonts tidak, jadi
      // keputusan yang sama diteruskan ke sini supaya log tidak penuh kode ANSI.
      colors: pc.isColorSupported ? ['yellow', 'yellow', 'yellow'] : [],
    },
    false,
    0,
    { width, height: 24 },
  );
  return out ? out.string : text;
}

/**
 * @param url   alamat yang harus dibuka pengguna (gateway/dev server, bukan port internal)
 * @param mode  `bun dev` → development, `bun start` → production
 * @param notes baris keterangan tambahan (port lain, catatan proxy)
 */
export function printBanner(url: string, mode: BannerMode, ...notes: string[]): void {
  const appName =
    process.env.APP_NAME?.trim() || process.env.APP_LANDING_TITLE?.trim() || 'Dashboard AI';
  console.log(title(appName));
  console.log(pc.yellow(`mode: ${mode}`));
  console.log(pc.cyan(`version v${pkg.version}`));
  console.log(pc.green(`listening on ${url}`));
  for (const note of notes) console.log(pc.gray(note));
}
