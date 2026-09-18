import { type RegisteredTool, type ToolDef, validateTool } from '@core/module-kit';
import { t } from 'elysia';
import {
  civilOf,
  formatOffset,
  isoIn,
  isValidTimeZone,
  offsetMinutes,
  rangesIn,
  systemTimeZone,
} from './lib/datetime.ts';
import { settings } from './services.ts';

/**
 * **Internal tools** — tools the core itself contributes to the registry (extension point 8),
 * alongside the ones modules declare in `api/tools.ts`.
 *
 * They exist for capabilities that belong to no module and must never disappear: a module can be
 * disabled per tenant (G-8), and an install may carry no modules at all, but "what time is it"
 * has to answer either way. So they are marked `core: true` and skip the module-enabled gate in
 * the registry — and *only* that gate. Everything else is identical to a module tool: the caller
 * needs a session and an active tenant, `permission` (when declared) is enforced, the arguments
 * are validated against the declared schema, and every call is audited as `tool.call` (I-3, I-6).
 *
 * They reach the assistant, `GET/POST /v1/tools` and `/v1/mcp` through the same one path, so
 * there is still exactly one place a tool can be called from.
 */
export const CORE_TOOL_MODULE = 'Core';
const CORE_TOOL_NS = 'core';

/** Same contract check `defineTools` runs for modules — an internal tool gets no exemption. */
function defineCoreTools(tools: readonly ToolDef[]): readonly RegisteredTool[] {
  const seen = new Set<string>();
  for (const tool of tools) {
    validateTool(CORE_TOOL_NS, tool);
    if (seen.has(tool.name)) throw new Error(`tool "${tool.name}" duplikat`);
    seen.add(tool.name);
  }
  return tools.map((tool) => ({ ...tool, module: CORE_TOOL_MODULE, ns: CORE_TOOL_NS }));
}

/** `Intl` wants a full tag; the app's locales are the short forms. */
const intlLocale = (locale: string) => (locale === 'id' ? 'id-ID' : 'en-US');

export const coreTools: readonly RegisteredTool[] = defineCoreTools([
  {
    name: 'core.get_current_datetime',
    description: {
      id: 'Tanggal dan jam saat ini di zona waktu aplikasi, plus rentang waktu siap pakai (hari ini, kemarin, minggu ini, minggu lalu, bulan ini, bulan lalu, tahun ini, 7/30 hari terakhir) dalam ISO-8601. WAJIB dipanggil sebelum menjawab apa pun yang menyebut waktu relatif — "sekarang", "hari ini", "kemarin", "bulan lalu", "terakhir" — atau sebelum menyusun laporan yang memakai rentang tanggal; jangan pernah menebak tanggal hari ini dari ingatan. Opsional: isi timezone (nama IANA) untuk membaca jam di zona lain.',
      en: 'The current date and time in the application’s timezone, plus ready-made ISO-8601 windows (today, yesterday, this/last week, this/last month, this year, last 7/30 days). ALWAYS call this before answering anything that refers to relative time — "now", "today", "yesterday", "last month", "recent" — or before building a report that filters on a date range; never guess today’s date from memory. Optionally pass timezone (an IANA name) to read the clock in another zone.',
    },
    // No `permission`: the wall clock is not tenant data, and a tool the assistant cannot read
    // the time from is a tool that quietly invents dates instead. Tenancy and audit still apply.
    readOnly: true,
    input: t.Object({
      timezone: t.Optional(
        t.String({
          maxLength: 64,
          description:
            'Nama zona waktu IANA, mis. "Asia/Jakarta" atau "UTC". Kosongkan untuk memakai zona waktu aplikasi.',
        }),
      ),
    }),
    run: async (input, { clientId, locale }) => {
      const asked = typeof input.timezone === 'string' ? input.timezone.trim() : '';
      if (asked && !isValidTimeZone(asked))
        throw new Error(
          `Zona waktu "${asked}" tidak dikenal — pakai nama IANA seperti "Asia/Jakarta"`,
        );
      // Configured per tenant like everything else in `app` (E-5). An emptied or unusable value
      // must not take the tool down with it: it degrades to the zone the process runs in.
      const configured = (await settings.get<string | null>(clientId, 'app.timezone')) ?? '';
      const timezone = asked || (isValidTimeZone(configured) ? configured : systemTimeZone());

      const now = new Date();
      const c = civilOf(now, timezone);
      const pad = (n: number) => String(n).padStart(2, '0');
      const tag = intlLocale(locale);
      return {
        iso: isoIn(now, timezone),
        utc: now.toISOString(),
        epoch_ms: now.getTime(),
        timezone,
        utc_offset: formatOffset(offsetMinutes(now, timezone)),
        date: `${String(c.year).padStart(4, '0')}-${pad(c.month)}-${pad(c.day)}`,
        time: `${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}`,
        weekday: new Intl.DateTimeFormat(tag, { timeZone: timezone, weekday: 'long' }).format(now),
        text: new Intl.DateTimeFormat(tag, {
          timeZone: timezone,
          dateStyle: 'full',
          timeStyle: 'long',
        }).format(now),
        // Half-open [from, to): use them directly as report filters, no end-of-day fudge.
        ranges: rangesIn(now, timezone),
      };
    },
  },
]);
