import type { ConfigFieldDef, ConfigSectionDef } from '@core/module-kit';
import { moduleConfig } from '@core/module-kit/registry';

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
    fields: [
      {
        key: 'app.name',
        type: 'string',
        title: { id: 'Nama aplikasi', en: 'Application name' },
        default: 'Dashboard',
        public: true,
        max: 120,
        order: 0,
      },
      {
        key: 'app.logo_url',
        type: 'string',
        title: { id: 'URL logo', en: 'Logo URL' },
        default: null,
        public: true,
        max: 512,
        order: 1,
      },
      {
        key: 'app.landing_route',
        type: 'route',
        title: { id: 'Halaman depan (anonim)', en: 'Landing page (anonymous)' },
        note: {
          id: 'Isi / untuk pengunjung yang belum masuk. Divalidasi terhadap registry route.',
          en: 'What / serves to anonymous visitors. Validated against the route registry.',
        },
        default: '/example',
        public: true,
        order: 2,
      },
      {
        key: 'app.home_route',
        type: 'route',
        title: { id: 'Halaman setelah masuk', en: 'Home after sign-in' },
        default: '/dashboard',
        public: true,
        order: 3,
      },
      {
        key: 'app.default_theme',
        type: 'theme',
        title: { id: 'Tema baku', en: 'Default theme' },
        note: {
          id: 'Dilihat pengunjung anonim dan pengguna yang belum memilih (L-10).',
          en: 'Seen by anonymous visitors and users without a choice (L-10).',
        },
        default: 'base',
        public: true,
        order: 4,
      },
      {
        key: 'app.allowed_themes',
        type: 'list',
        title: { id: 'Tema yang boleh dipilih', en: 'Allowed themes' },
        note: {
          id: 'Kosong = semua tema terdaftar. Satu tema = terkunci (L-11).',
          en: 'Empty = every registered theme. One theme = locked (L-11).',
        },
        default: [],
        public: true,
        options: [],
        order: 5,
      },
      {
        key: 'app.default_locale',
        type: 'locale',
        title: { id: 'Bahasa baku', en: 'Default language' },
        default: 'id',
        public: true,
        order: 6,
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
      id: 'Tabel log tidak boleh tumbuh tanpa batas (M-3). Job core.logs.retention memangkasnya setiap hari; kebijakan berlaku global.',
      en: 'Log tables must not grow without bound (M-3). The core.logs.retention job prunes them daily; the policy is global.',
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
          id: 'Notifikasi yang sudah dibaca dihapus setelah usia ini; yang belum dibaca tidak pernah dihapus (J-4).',
          en: 'Read notifications are removed past this age; unread ones are never removed (J-4).',
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
      id: 'Batas unggahan (Q-16). Penyimpanan (volume lokal atau S3) dipilih lewat STORAGE_DRIVER di .env — bukan di sini.',
      en: 'Upload limits (Q-16). The store (local volume or S3) is chosen by STORAGE_DRIVER in .env — not here.',
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
