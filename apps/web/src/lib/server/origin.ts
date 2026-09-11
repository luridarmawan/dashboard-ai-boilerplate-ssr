/**
 * Origin mana yang boleh mengirim permintaan pengubah-keadaan ke web (PRD A-10, Keputusan E).
 *
 * SvelteKit punya pemeriksaan sendiri (`kit.csrf`, dimatikan dengan `trustedOrigins: ['*']`): header `Origin` browser
 * dibandingkan dengan origin yang DIREKONSTRUKSI adapter-node per request — `ORIGIN` bila
 * disetel, kalau tidak `PROTOCOL_HEADER`/`HOST_HEADER`, dan terakhir `https://` + Host. Reverse
 * proxy yang lupa `X-Forwarded-Proto` (atau meneruskan Host miliknya sendiri) membuat
 * rekonstruksi itu salah, dan sejak itu SETIAP form POST biasa — tema, bahasa, login, reset
 * kata sandi — mati dengan "Cross-site POST form submissions are forbidden": 403 yang tidak
 * menyebut sebab maupun jalan keluarnya. Mutasi lewat AJAX tetap jalan (pemeriksaan itu hanya
 * berlaku untuk content-type form), dan justru itu yang membuat gejalanya terasa acak.
 *
 * Karena itu web memutuskannya seperti plugin csrf di API: dari `APP_ORIGIN`, dibaca saat
 * RUNTIME. `kit.csrf` ikut terbakar ke dalam build, sedangkan origin publik adalah nilai deploy —
 * image yang sudah dikirim harus bisa diberi tahu domainnya tanpa dibangun ulang. Satu daftar
 * mengatur kedua proses; bila daftarnya kosong kita jatuh ke origin hasil rekonstruksi, persis
 * yang dilakukan SvelteKit.
 *
 * `APP_ORIGIN` dibaca dari `process.env` (bukan `$env/dynamic/private`) supaya modul ini bisa
 * diuji unit dengan `bun test` tanpa graph Vite; di adapter-node keduanya nilai yang sama.
 *
 * `parseOrigins` di bawah adalah cermin dari yang ada di `@core/config`: apps/web sengaja tidak
 * bergantung pada env loader API. Kalau yang satu berubah, ubah keduanya.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * `APP_ORIGIN` → daftar origin ternormalisasi (huruf kecil, tanpa path). Entri bawa skema dipakai
 * apa adanya; host tanpa skema (`localhost`, `app.example.com:8080`) berarti http DAN https.
 */
export function parseOrigins(raw: string | undefined): string[] {
  const out = new Set<string>();
  for (const entry of (raw ?? '').split(',')) {
    const e = entry.trim();
    if (!e) continue;
    const candidates = /^[a-z][a-z0-9+.-]*:\/\//i.test(e) ? [e] : [`http://${e}`, `https://${e}`];
    for (const c of candidates) {
      try {
        const u = new URL(c);
        if (u.origin !== 'null' && (u.protocol === 'http:' || u.protocol === 'https:'))
          out.add(u.origin.toLowerCase());
      } catch {
        /* entri tidak valid diabaikan — API-nya yang menolak nilai yang seluruhnya salah */
      }
    }
  }
  return [...out];
}

let declared: { raw: string | undefined; list: readonly string[] } | undefined;

/** Isi `APP_ORIGIN` saat ini, diurai sekali per nilai (env bisa berubah di antara test). */
export function declaredOrigins(): readonly string[] {
  const raw = process.env.APP_ORIGIN?.trim() || undefined;
  if (!declared || declared.raw !== raw) declared = { raw, list: parseOrigins(raw) };
  return declared.list;
}

/**
 * Origin yang diterima: `APP_ORIGIN` bila dideklarasikan, kalau tidak origin request ini.
 *
 * Di `NODE_ENV=development` origin request SELALU ikut diterima: `vite dev` dilayani di port yang
 * berpindah-pindah (dan `127.0.0.1` ≠ `localhost` bagi pemeriksaan ini), sementara SvelteKit
 * sendiri melewatkan pemeriksaan Origin di dev. Jadi form same-origin tidak pernah mati saat
 * ngoprek, tapi penolakan lintas-situs tetap hidup dan ikut teruji. Produksi tetap ketat: hanya
 * nilai `development` yang eksplisit yang melonggarkan ini, NODE_ENV kosong tidak.
 */
export function allowedOrigins(url: URL): readonly string[] {
  const list = declaredOrigins();
  if (!list.length) return [url.origin.toLowerCase()];
  return process.env.NODE_ENV === 'development' ? [...list, url.origin.toLowerCase()] : list;
}

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

export type OriginVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: 'origin_missing' | 'origin_mismatch';
      seen: string | null;
      allowed: readonly string[];
    };

/** Keputusan murni — diuji unit; pemanggil hanya menyuapkan data request. */
export function checkOrigin(i: {
  readonly method: string;
  readonly origin: string | null;
  readonly referer: string | null;
  readonly allowed: readonly string[];
}): OriginVerdict {
  if (SAFE_METHODS.has(i.method.toUpperCase())) return { ok: true };
  const seen = originOf(i.origin) ?? originOf(i.referer);
  if (!seen) return { ok: false, reason: 'origin_missing', seen: null, allowed: i.allowed };
  if (!i.allowed.includes(seen))
    return { ok: false, reason: 'origin_mismatch', seen, allowed: i.allowed };
  return { ok: true };
}

/**
 * Origin publik yang diteruskan ke API (header `origin` + `x-forwarded-*`, lihat lib/api/client.ts)
 * dan karenanya juga dipakai API untuk tautan absolut di e-mail (`publicOrigin` di apps/api).
 *
 * Origin browser dipakai SETELAH lolos allow-list: itulah satu-satunya nilai yang benar ketika
 * rekonstruksi di depan web salah — kalau web meneruskan origin hasil rekonstruksinya, pemeriksaan
 * Origin di API menolaknya (login/reset kata sandi 403) dan tautan e-mail menunjuk host internal.
 * Bila tidak ada (navigasi GET) atau tidak dikenal, origin request seperti sebelumnya.
 */
export function forwardedOrigin(event: { readonly request: Request; readonly url: URL }): string {
  const seen =
    originOf(event.request.headers.get('origin')) ?? originOf(event.request.headers.get('referer'));
  if (seen && allowedOrigins(event.url).includes(seen)) return seen;
  return event.url.origin;
}

/** Keputusan yang sama untuk satu request SvelteKit. */
export function checkRequestOrigin(event: {
  readonly request: Request;
  readonly url: URL;
}): OriginVerdict {
  return checkOrigin({
    method: event.request.method,
    origin: event.request.headers.get('origin'),
    referer: event.request.headers.get('referer'),
    allowed: allowedOrigins(event.url),
  });
}
