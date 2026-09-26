import { rawEnv } from '@core/config';
import type { ConfigFieldDef, ConfigSectionDef } from '@core/module-kit';
import { moduleConfig } from '@core/module-kit/registry';

/**
 * `LANDING_ROUTE` in `.env` is the documented bootstrap fallback for `app.landing_route` (§4.7):
 * with no row in `configurations`, THIS is what `/` serves. Read without validating the whole
 * environment — this registry is built while modules are still being imported.
 */
function landingFallback(): string {
  const v = rawEnv('LANDING_ROUTE');
  return v?.startsWith('/') && !v.startsWith('//') ? v : '/';
}

/**
 * The zone the application reads its own clock in (`core.get_current_datetime`, date-range
 * reports). Rows are stored in UTC; this only decides when "hari ini" begins. With no row in
 * `configurations` the zone the process runs in applies — `Intl` resolves that from `TZ`.
 */
function timezoneFallback(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Built-in configuration sections (PRD E-8). Everything an admin may change at runtime lives
 * here, never in .env (E-6). Modules add their own through `config.ts` (extension point 6);
 * the settings form is GENERATED from this registry (E-3).
 */
export const CORE_CONFIG: readonly ConfigSectionDef[] = [
  {
    section: 'app',
    title: { id: 'Aplikasi', en: 'Application' },
    note: {
      id: 'Identitas, halaman baku, tema, dan bahasa.',
      en: 'Identity, default pages, theme and language.',
    },
    order: 0,
    // Presentation only: the three blocks the Application tab is drawn in.
    groups: [
      { key: 'identity', title: { id: 'Aplikasi', en: 'Application' } },
      { key: 'handlers', title: { id: 'Halaman baku', en: 'Default handler' } },
      { key: 'appearance', title: { id: 'Tema & tata letak', en: 'Theme & layout' } },
    ],
    fields: [
      {
        key: 'app.name',
        type: 'string',
        title: { id: 'Nama aplikasi', en: 'Application name' },
        note: {
          id: 'Tampil di kiri atas setiap halaman, judul tab halaman depan, dan email keluar. APP_LANDING_TITLE di .env menimpanya untuk email.',
          en: 'Shown top-left on every page, in the landing page tab title, and in outgoing e-mail. APP_LANDING_TITLE in .env overrides it for e-mail.',
        },
        default: 'Dashboard',
        public: true,
        max: 120,
        order: 0,
        group: 'identity',
        width: 'half',
      },
      {
        key: 'app.landing_lead',
        type: 'string',
        title: { id: 'Kalimat pembuka', en: 'Landing lead' },
        note: {
          id: 'Satu kalimat di bawah nama aplikasi: footer halaman publik dan panel layout masuk split-hero. Kosongkan untuk memakai APP_LANDING_LEAD dari .env, atau teks bawaan.',
          en: 'One line under the application name: the public footer and the split-hero sign-in panel. Leave empty to fall back to APP_LANDING_LEAD from .env, or the built-in copy.',
        },
        default: null,
        public: true,
        max: 500,
        order: 1,
        group: 'identity',
        width: 'half',
      },
      {
        key: 'app.logo_url',
        type: 'string',
        title: { id: 'URL logo', en: 'Logo URL' },
        note: {
          id: 'URL absolut atau path (mis. /files/…/content). Tema kustom yang mengunggah logonya sendiri menimpa ini selama tema itu aktif.',
          en: 'Absolute URL or path (e.g. /files/…/content). A custom theme that uploaded its own logo overrides this while that theme is active.',
        },
        default: null,
        public: true,
        max: 512,
        order: 2,
        group: 'identity',
        width: 'half',
      },
      {
        key: 'app.landing_route',
        type: 'public_route',
        title: { id: 'Halaman depan (anonim)', en: 'Landing page (anonymous)' },
        note: {
          id: 'Halaman yang disajikan di / untuk pengunjung yang belum masuk — hanya halaman publik yang bisa dipilih. Kosongkan untuk memakai LANDING_ROUTE dari .env.',
          en: 'The page / serves to anonymous visitors — only public pages can be chosen. Leave empty to fall back to LANDING_ROUTE from .env.',
        },
        default: landingFallback(),
        public: true,
        order: 4,
        group: 'handlers',
        width: 'third',
      },
      {
        key: 'app.home_route',
        type: 'route',
        title: { id: 'Halaman setelah masuk', en: 'Home after sign-in' },
        default: '/dashboard',
        public: true,
        order: 5,
        group: 'handlers',
        width: 'third',
      },
      {
        key: 'app.not_found_route',
        type: 'not_found_route',
        title: { id: 'Penangkap halaman 404', en: '404 handler' },
        note: {
          id: 'Modul yang ditanya untuk setiap URL yang tidak dikenal (kategori, produk, artikel). Hanya halaman yang dideklarasikan modul sebagai penangkapnya yang ditawarkan; URL yang tidak dikenali modul tetap 404. Kosongkan untuk memakai 404 bawaan.',
          en: 'The module asked about every unknown URL (categories, products, posts). Only pages a module declared as its handler are offered; a URL the module does not recognise stays 404. Leave empty for the built-in 404.',
        },
        default: null,
        public: true,
        order: 6,
        group: 'handlers',
        width: 'third',
      },
      {
        key: 'app.default_theme',
        type: 'theme',
        title: { id: 'Tema baku', en: 'Default theme' },
        note: {
          id: 'Dilihat pengunjung anonim dan pengguna yang belum memilih.',
          en: 'Seen by anonymous visitors and users without a choice.',
        },
        default: 'warm',
        public: true,
        order: 7,
        group: 'appearance',
        width: 'third',
      },
      {
        key: 'app.favicon_url',
        type: 'string',
        title: { id: 'URL favicon', en: 'Favicon URL' },
        note: {
          id: 'URL absolut atau path (mis. /files/…/content) ke berkas PNG/SVG/ICO persegi. Kosongkan untuk favicon bawaan. Tema kustom yang mengunggah favicon-nya sendiri menimpa ini selama tema itu aktif.',
          en: 'Absolute URL or path (e.g. /files/…/content) to a square PNG/SVG/ICO. Leave empty for the built-in favicon. A custom theme that uploaded its own favicon overrides this while that theme is active.',
        },
        default: null,
        public: true,
        max: 512,
        order: 3,
        group: 'identity',
        width: 'half',
      },
      {
        key: 'app.allowed_themes',
        type: 'list',
        title: { id: 'Tema yang boleh dipilih', en: 'Allowed themes' },
        note: {
          id: 'Kosong = semua tema terdaftar. Satu tema = terkunci.',
          en: 'Empty = every registered theme. One theme = locked.',
        },
        default: [],
        public: true,
        options: [],
        order: 10,
        group: 'appearance',
        width: 'full',
      },
      {
        key: 'app.default_locale',
        type: 'locale',
        title: { id: 'Bahasa baku', en: 'Default language' },
        default: 'en',
        public: true,
        order: 8,
        group: 'appearance',
        width: 'third',
      },
      {
        key: 'app.timezone',
        type: 'timezone',
        title: { id: 'Zona waktu', en: 'Timezone' },
        note: {
          id: 'Nama IANA, mis. Asia/Jakarta. Data tetap disimpan dalam UTC; ini yang menentukan kapan "hari ini" dimulai bagi asisten AI dan laporan berentang tanggal. Kosongkan untuk memakai zona waktu server (TZ).',
          en: 'IANA name, e.g. Asia/Jakarta. Data is still stored in UTC; this decides when “today” begins for the AI assistant and for date-range reports. Leave empty to use the server’s own zone (TZ).',
        },
        default: timezoneFallback(),
        public: true,
        max: 64,
        order: 9,
        group: 'appearance',
        width: 'third',
      },
    ],
  },
  {
    section: 'security',
    title: { id: 'Keamanan', en: 'Security' },
    order: 10,
    fields: [
      {
        key: 'security.signup_enabled',
        type: 'boolean',
        title: { id: 'Pendaftaran mandiri', en: 'Self-service sign-up' },
        note: {
          id: 'Menimpa SIGNUP_ENABLED di .env bila diisi.',
          en: 'Overrides SIGNUP_ENABLED from .env when set.',
        },
        default: null,
        public: true,
        order: 0,
      },
      {
        key: 'security.session_hours',
        type: 'number',
        title: { id: 'Umur sesi (jam)', en: 'Session lifetime (hours)' },
        default: null,
        min: 1,
        max: 8760,
        order: 1,
      },
      {
        key: 'security.login_rate_limit',
        type: 'string',
        title: { id: 'Rate limit login', en: 'Login rate limit' },
        note: {
          id: 'Bentuk <jumlah>/<detik>, mis. 10/900.',
          en: '<count>/<seconds>, e.g. 10/900.',
        },
        default: null,
        max: 20,
        order: 2,
      },
      {
        key: 'security.invitation_hours',
        type: 'number',
        title: { id: 'Masa berlaku tautan undangan (jam)', en: 'Invitation link validity (hours)' },
        note: {
          id: 'Undangan ke tenant ini (Pengguna → Undang) berlaku selama ini sejak dibuat; baku 72 jam.',
          en: 'Invitations into this tenant (Users → Invite) stay valid this long after creation; default 72 hours.',
        },
        default: 72,
        min: 1,
        max: 720,
        order: 8,
      },
      // ---- Google sign-in (A-8). Client id + secret come from Google Cloud Console → Credentials →
      // OAuth client (Web application); the authorised redirect URI is <origin>/auth/google/callback.
      // GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env are the bootstrap when these are empty (E-6).
      {
        key: 'security.google_enabled',
        type: 'boolean',
        title: { id: 'Masuk dengan Google', en: 'Sign in with Google' },
        note: {
          id: 'Menampilkan tombol Google di halaman masuk. Butuh client id dan secret di bawah (atau GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET di .env).',
          en: 'Shows the Google button on the sign-in page. Needs the client id and secret below (or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET in .env).',
        },
        default: false,
        public: true,
        order: 3,
      },
      {
        key: 'security.google_client_id',
        type: 'string',
        title: { id: 'Google client id', en: 'Google client id' },
        default: null,
        max: 191,
        order: 4,
      },
      {
        key: 'security.google_client_secret',
        type: 'secret',
        title: { id: 'Google client secret', en: 'Google client secret' },
        order: 5,
      },
      {
        key: 'security.google_auto_create',
        type: 'boolean',
        title: { id: 'Buat akun otomatis dari Google', en: 'Auto-create accounts from Google' },
        note: {
          id: 'Bila mati, hanya email yang sudah terdaftar yang bisa masuk lewat Google.',
          en: 'When off, only already-registered e-mails can sign in through Google.',
        },
        default: false,
        order: 6,
      },
      {
        key: 'security.google_allowed_domains',
        type: 'string',
        title: { id: 'Domain email Google yang diizinkan', en: 'Allowed Google e-mail domains' },
        note: {
          id: 'Dipisah koma, mis. perusahaan.id, anak-usaha.id. Kosong = semua domain.',
          en: 'Comma-separated, e.g. company.com, subsidiary.com. Empty = any domain.',
        },
        default: null,
        max: 500,
        order: 7,
      },
    ],
  },
  {
    section: 'logs',
    title: { id: 'Log & retensi', en: 'Logs & retention' },
    note: {
      id: 'Tabel log tidak boleh tumbuh tanpa batas. Job core.logs.retention memangkasnya setiap hari; kebijakan berlaku global.',
      en: 'Log tables must not grow without bound. The core.logs.retention job prunes them daily; the policy is global.',
    },
    order: 15,
    fields: [
      {
        key: 'logs.audit_retention_days',
        type: 'number',
        title: { id: 'Retensi audit log (hari)', en: 'Audit log retention (days)' },
        note: {
          id: 'Aksi sensitif (login, izin, konfigurasi, CRUD). Minimal 30 hari.',
          en: 'Sensitive actions (login, permissions, configuration, CRUD). At least 30 days.',
        },
        default: 365,
        min: 30,
        max: 3650,
        order: 0,
      },
      {
        key: 'logs.scheduler_runs_retention_days',
        type: 'number',
        title: { id: 'Retensi riwayat job (hari)', en: 'Job run history retention (days)' },
        default: 14,
        min: 1,
        max: 365,
        order: 1,
      },
      {
        key: 'logs.outbox_retention_days',
        type: 'number',
        title: {
          id: 'Retensi email terkirim/gagal (hari)',
          en: 'Sent/failed email retention (days)',
        },
        note: {
          id: 'Hanya baris berstatus sent atau failed; yang masih pending tidak pernah dihapus.',
          en: 'Only rows in status sent or failed; pending rows are never removed.',
        },
        default: 30,
        min: 1,
        max: 3650,
        order: 2,
      },
      {
        key: 'logs.queue_retention_days',
        type: 'number',
        title: {
          id: 'Retensi pekerjaan antrean selesai/dead (hari)',
          en: 'Finished/dead queue job retention (days)',
        },
        note: {
          id: 'Baris pending dan running tidak pernah dihapus.',
          en: 'Pending and running rows are never removed.',
        },
        default: 14,
        min: 1,
        max: 3650,
        order: 3,
      },
      {
        key: 'logs.webhook_retention_days',
        type: 'number',
        title: {
          id: 'Retensi riwayat webhook (hari)',
          en: 'Webhook delivery history retention (days)',
        },
        default: 30,
        min: 1,
        max: 3650,
        order: 4,
      },
      {
        key: 'logs.notification_retention_days',
        type: 'number',
        title: {
          id: 'Retensi notifikasi terbaca (hari)',
          en: 'Read notification retention (days)',
        },
        note: {
          id: 'Notifikasi yang sudah dibaca dihapus setelah usia ini; yang belum dibaca tidak pernah dihapus.',
          en: 'Read notifications are removed past this age; unread ones are never removed.',
        },
        default: 90,
        min: 7,
        max: 3650,
        order: 3,
      },
    ],
  },
  {
    section: 'files',
    title: { id: 'Berkas unggahan', en: 'Uploaded files' },
    note: {
      id: 'Batas unggahan. Penyimpanan (volume lokal atau S3) dipilih lewat STORAGE_DRIVER di .env — bukan di sini.',
      en: 'Upload limits. The store (local volume or S3) is chosen by STORAGE_DRIVER in .env — not here.',
    },
    order: 17,
    fields: [
      {
        key: 'files.max_size_mb',
        type: 'number',
        title: { id: 'Ukuran maksimum per berkas (MB)', en: 'Maximum size per file (MB)' },
        default: 10,
        min: 1,
        max: 500,
        order: 0,
      },
      {
        key: 'files.allowed_types',
        type: 'list',
        title: { id: 'Tipe yang diizinkan', en: 'Allowed types' },
        note: {
          id: 'MIME type, boleh pola seperti image/*; satu per baris atau dipisah koma. Isi berkas diperiksa (magic number), bukan hanya klaimnya.',
          en: 'MIME types, patterns like image/* allowed; one per line or comma-separated. File contents are sniffed, not just the claim.',
        },
        default: [
          'image/png',
          'image/jpeg',
          'image/gif',
          'image/webp',
          'image/svg+xml',
          'image/x-icon',
          'application/pdf',
          'text/plain',
          'text/csv',
        ],
        options: [],
        order: 1,
      },
    ],
  },
  {
    section: 'mail',
    title: { id: 'Email', en: 'Email' },
    note: {
      id: 'Pengiriman lewat outbox: job core.outbox.deliver mengirim tiap menit. Kolom yang kosong memakai SMTP_* / MAIL_* dari .env; tanpa keduanya, di luar production transport log dipakai.',
      en: 'Delivery goes through the outbox: core.outbox.deliver sends every minute. Empty fields fall back to SMTP_* / MAIL_* from .env; without either, outside production the log transport is used.',
    },
    order: 20,
    // Extension point 6: "send a test e-mail" beside Save. It sends ONE message straight through
    // SMTP — no outbox, no scheduler wait — so the verdict on the page is about the credentials
    // in front of the operator, for this scope (tenant or global) exactly as a real send resolves
    // them (settings, else .env). The recipient defaults to the SMTP account in effect.
    actions: [
      {
        key: 'test',
        label: { id: 'Kirim email uji', en: 'Send test e-mail' },
        endpoint: '/v1/configuration/mail/test',
        permission: 'config.edit',
        note: {
          id: 'Menguji konfigurasi yang tersimpan (bukan yang belum disimpan di formulir ini) — simpan dulu, lalu uji. Langsung lewat SMTP, tidak lewat outbox.',
          en: 'Tests the stored configuration (not unsaved edits in this form) — save first, then test. Sent straight over SMTP, not through the outbox.',
        },
        input: {
          key: 'to',
          type: 'email',
          label: { id: 'Email tujuan', en: 'Recipient' },
          placeholder: { id: 'akun SMTP', en: 'the SMTP account' },
          max: 191,
        },
      },
    ],
    fields: [
      {
        key: 'mail.from_name',
        type: 'string',
        title: { id: 'Nama pengirim', en: 'From name' },
        note: {
          id: 'Kosong = MAIL_FROM_NAME, lalu nama aplikasi.',
          en: 'Empty = MAIL_FROM_NAME, then the app name.',
        },
        default: null,
        max: 120,
        order: 0,
      },
      {
        key: 'mail.from_address',
        type: 'string',
        title: { id: 'Alamat pengirim', en: 'From address' },
        default: null,
        max: 191,
        order: 1,
      },
      {
        key: 'mail.smtp_host',
        type: 'string',
        title: { id: 'SMTP host', en: 'SMTP host' },
        default: null,
        max: 191,
        order: 2,
      },
      {
        key: 'mail.smtp_port',
        type: 'number',
        title: { id: 'SMTP port', en: 'SMTP port' },
        note: {
          id: 'Kosong = SMTP_PORT, lalu 587 (STARTTLS); 465 = TLS implisit.',
          en: 'Empty = SMTP_PORT, then 587 (STARTTLS); 465 = implicit TLS.',
        },
        default: null,
        min: 1,
        max: 65535,
        order: 3,
      },
      {
        key: 'mail.smtp_user',
        type: 'string',
        title: { id: 'SMTP user', en: 'SMTP user' },
        default: null,
        max: 191,
        order: 4,
      },
      {
        key: 'mail.smtp_password',
        type: 'secret',
        title: { id: 'SMTP password', en: 'SMTP password' },
        order: 5,
      },
      {
        key: 'mail.track_opens',
        type: 'boolean',
        title: { id: 'Lacak pembukaan & klik email', en: 'Track e-mail opens & clicks' },
        note: {
          id: 'Menyisipkan gambar pelacak 1×1 dan membungkus tombol di email HTML; hasilnya tampil di Outbox. Sinyal ini tidak pasti (proxy gambar, pemindai tautan) dan memproses data pribadi — sebutkan di kebijakan privasi bila dipakai untuk pelanggan.',
          en: 'Adds a 1×1 tracking image and wraps the button link in HTML e-mail; results show in the Outbox. The signal is approximate (image proxies, link scanners) and is personal-data processing — mention it in your privacy policy when used for customers.',
        },
        default: false,
        order: 6,
      },
    ],
  },
];

export interface RegistryField extends ConfigFieldDef {
  readonly section: string;
  readonly module: string;
}

/** Every section, core first, then modules in init order. */
export function configSections(): readonly (ConfigSectionDef & { module: string })[] {
  return [...CORE_CONFIG.map((s) => ({ ...s, module: 'core' })), ...moduleConfig].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100),
  );
}

/** Flat field registry keyed by `key`. Unknown keys cannot be saved (E-3). */
export function configFields(): ReadonlyMap<string, RegistryField> {
  const map = new Map<string, RegistryField>();
  for (const s of configSections()) {
    for (const f of s.fields) map.set(f.key, { ...f, section: s.section, module: s.module });
  }
  return map;
}
