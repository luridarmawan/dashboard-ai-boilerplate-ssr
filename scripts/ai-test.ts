#!/usr/bin/env bun
/**
 * `bun run ai:test` — prove the whole AI bootstrap chain without a browser (AI-Roadmap §10).
 *
 * It probes every AI provider configuration that actually exists, in the same precedence the
 * chat runtime uses (env → global settings → tenant settings → tenant profiles), and prints the
 * same capability matrix the admin's "Uji koneksi" button shows. Meant for a VPS operator
 * (`docker compose run --rm api bun run ai:test`) as much as for a developer.
 *
 *   bun run ai:test                                  every source that exists
 *   bun run ai:test -- --tenant acme                 one tenant (id, code or slug)
 *   bun run ai:test -- --json                         machine-readable, for CI
 *   bun run ai:test -- --verbose                      per-step latency and full errors
 *   bun run ai:test -- --base-url URL --model M      ad-hoc, without touching .env
 *   bun run ai:test -- --strict                       exit 1 when ANY source failed
 *   bun run ai:test -- --require-responses            exit 1 when a source lacks /responses
 *
 * It NEVER writes: no `capabilities` is persisted (that is the UI button's job, §10.5), no
 * settings are changed. Reading is done straight through `@core/db`, not over HTTP.
 */
import { env } from '@core/config';
import { and, eq, isNull, schema, unsafeAcrossTenants } from '@core/db';
import { SettingsStore } from '@core/settings';
import { isRecommended, type ProbeResult, probeCapabilities } from '../modules/AI/api/probe.ts';

interface Args {
  tenant: string | null;
  json: boolean;
  verbose: boolean;
  strict: boolean;
  requireResponses: boolean;
  baseUrl: string | null;
  model: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    tenant: null,
    json: false,
    verbose: false,
    strict: false,
    requireResponses: false,
    baseUrl: null,
    model: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    switch (v) {
      case '--json':
        a.json = true;
        break;
      case '--verbose':
        a.verbose = true;
        break;
      case '--strict':
        a.strict = true;
        break;
      case '--require-responses':
        a.requireResponses = true;
        break;
      case '--tenant':
        a.tenant = argv[++i] ?? null;
        break;
      case '--base-url':
        a.baseUrl = argv[++i] ?? null;
        break;
      case '--model':
        a.model = argv[++i] ?? null;
        break;
      case '--help':
      case '-h':
        console.log(
          [
            'Pemakaian: bun run ai:test [-- opsi]',
            '  --tenant <id|kode|all>   hanya tenant itu (baku: semua yang punya konfigurasi)',
            '  --json                   keluaran JSON',
            '  --verbose                latensi per langkah + galat lengkap',
            '  --base-url <url>         paksa base URL (tanpa menulis .env)',
            '  --model <model>          paksa model',
            '  --strict                 keluar 1 bila ADA sumber yang gagal',
            '  --require-responses      keluar 1 bila ada sumber tanpa /responses',
          ].join('\n'),
        );
        process.exit(0);
        break;
      default:
        if (v?.startsWith('-')) {
          console.error(`Opsi tidak dikenal: ${v} (lihat --help)`);
          process.exit(2);
        }
    }
  }
  return a;
}

interface Source {
  /** `env` | `settings:global` | `tenant:<code>` | `tenant:<code> (profil <kode>)` */
  source: string;
  baseUrl: string;
  key: string | null;
  model: string;
  /** Set when this source exists but the chat runtime would not use it. */
  shadowedBy: string | null;
}

interface Row extends Source {
  result: ProbeResult;
}

const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * §10.1 promises this works "even before the database exists". `env()` validates the WHOLE
 * schema, so a missing DATABASE_URL would throw before we ever look at AI_API_*. Fall back to the
 * raw process env: the only three values this command needs are strings.
 */
function safeEnv(): { AI_API_BASE_URL?: string; AI_API_KEY?: string; AI_MODEL?: string } {
  try {
    return env();
  } catch {
    const raw = process.env;
    return {
      AI_API_BASE_URL: raw.AI_API_BASE_URL || undefined,
      AI_API_KEY: raw.AI_API_KEY || undefined,
      AI_MODEL: raw.AI_MODEL || undefined,
    };
  }
}

/** Every configuration that exists, in the order the runtime resolves them. */
async function collect(args: Args): Promise<Source[]> {
  const out: Source[] = [];
  const e = safeEnv();

  if (args.baseUrl) {
    // Ad-hoc: the operator is testing one endpoint, not the installation.
    out.push({
      source: 'argumen',
      baseUrl: args.baseUrl,
      key: e.AI_API_KEY ?? null,
      model: args.model ?? e.AI_MODEL ?? DEFAULT_MODEL,
      shadowedBy: null,
    });
    return out;
  }

  // 1. env (bootstrap E-6) — present even before the database has a tenant.
  if (e.AI_API_BASE_URL) {
    out.push({
      source: 'env (bootstrap)',
      baseUrl: e.AI_API_BASE_URL,
      key: e.AI_API_KEY ?? null,
      model: e.AI_MODEL ?? DEFAULT_MODEL,
      shadowedBy: null,
    });
  }

  // Everything below needs the database. A machine that has env but no database yet (a fresh
  // VPS mid-deploy) still gets a useful answer for source #1 instead of a stack trace.
  const settings = new SettingsStore(unsafeAcrossTenants());
  try {
    out.push(...(await fromDatabase(args, e, settings)));
  } catch (err) {
    console.error(
      `Basis data tidak terbaca (${err instanceof Error ? err.message : String(err)}) — hanya sumber env yang diuji.`,
    );
  }
  return out;
}

async function fromDatabase(
  args: Args,
  e: { AI_API_KEY?: string; AI_MODEL?: string },
  settings: SettingsStore,
): Promise<Source[]> {
  const out: Source[] = [];
  // 2. global settings — only when a superadmin actually saved one.
  const globalUrl = await settings.get<string | null>(null, 'ai.baseurl');
  const globalRows = await unsafeAcrossTenants()
    .select({ key: schema.configurations.key })
    .from(schema.configurations)
    .where(eq(schema.configurations.scope, 'global'));
  const savedGlobally = new Set(globalRows.map((r) => r.key));
  if (savedGlobally.has('ai.baseurl') && globalUrl) {
    out.push({
      source: 'settings:global',
      baseUrl: globalUrl,
      key: (await settings.get<string | null>(null, 'ai.key')) || e.AI_API_KEY || null,
      model: (await settings.get<string | null>(null, 'ai.model')) ?? e.AI_MODEL ?? DEFAULT_MODEL,
      shadowedBy: null,
    });
  }

  // 3. per tenant: settings override and/or provider profiles (H-10).
  const tenants = await unsafeAcrossTenants()
    .select({ id: schema.clients.id, code: schema.clients.code, name: schema.clients.name })
    .from(schema.clients)
    .where(isNull(schema.clients.deleted_at));
  const wanted = args.tenant && args.tenant !== 'all' ? args.tenant.toLowerCase() : null;
  for (const t of tenants) {
    if (wanted && ![t.id, t.code, t.name].some((v) => v?.toLowerCase() === wanted)) continue;
    const profiles = await unsafeAcrossTenants()
      .select()
      .from(schema.aiProviders)
      .where(
        and(
          eq(schema.aiProviders.client_id, t.id),
          eq(schema.aiProviders.enabled, true),
          isNull(schema.aiProviders.deleted_at),
        ),
      );
    // Profiles win over the tenant's own ai.* settings — the same precedence as
    // `resolveProvider`, so the CLI reports what chat would REALLY use.
    for (const p of profiles) {
      out.push({
        source: `tenant:${t.code} (profil ${p.code})`,
        baseUrl: p.base_url,
        key: p.api_key,
        model: p.default_model,
        shadowedBy: null,
      });
    }
    const tenantUrl = await settings.get<string | null>(t.id, 'ai.baseurl');
    const tenantRows = await unsafeAcrossTenants()
      .select({ key: schema.configurations.key })
      .from(schema.configurations)
      .where(eq(schema.configurations.scope, t.id));
    if (tenantRows.some((r) => r.key === 'ai.baseurl') && tenantUrl) {
      out.push({
        source: `tenant:${t.code} (settings)`,
        baseUrl: tenantUrl,
        key: (await settings.get<string | null>(t.id, 'ai.key')) || e.AI_API_KEY || null,
        model: (await settings.get<string | null>(t.id, 'ai.model')) ?? e.AI_MODEL ?? DEFAULT_MODEL,
        shadowedBy: profiles.length ? `profil ${profiles[0]?.code}` : null,
      });
    }
  }
  return out;
}

const flag = (b: boolean) => (b ? '✓' : '—');
const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

function printHuman(rows: Row[], args: Args) {
  const tenants = new Set(rows.map((r) => r.source).filter((s) => s.startsWith('tenant:'))).size;
  console.log(`AI test — ${rows.length} sumber${tenants ? `, ${tenants} dari tenant` : ''}\n`);
  const head = [
    pad('#', 3),
    pad('Sumber', 30),
    pad('Base URL', 34),
    pad('Model', 20),
    'Key',
    pad('Endpoint', 9),
    'Str',
    'Rea',
    'Too',
    'Rek',
    pad('ms', 6),
    'Status',
  ].join(' ');
  console.log(head);
  console.log('-'.repeat(head.length));
  rows.forEach((r, i) => {
    const c = r.result;
    console.log(
      [
        pad(String(i + 1), 3),
        pad(r.source, 30),
        pad(r.baseUrl, 34),
        pad(r.model, 20),
        r.key ? ' ● ' : ' ○ ',
        pad(
          c.preferredEndpoint === 'responses' ? 'responses' : c.preferredEndpoint ? 'chat' : '—',
          9,
        ),
        ` ${flag(c.stream.supported)} `,
        ` ${flag(c.reasoning.supported)} `,
        ` ${flag(c.tools.supported)} `,
        ` ${isRecommended(c) ? '★' : '—'} `,
        pad(String(c.ms), 6),
        c.ok ? 'ok' : 'error',
      ].join(' '),
    );
    if (r.shadowedBy) {
      console.log(`    ↳ ditimpa ${r.shadowedBy} — tidak dipakai chat`);
    }
    if (!c.ok && c.error) console.log(`    ↳ ${c.error}`);
    if (args.verbose) {
      for (const s of c.steps) {
        console.log(
          `    · ${pad(s.step, 17)} ${pad(s.status, 12)} ${String(s.ms).padStart(5)}ms${s.note ? `  ${s.note}` : ''}`,
        );
      }
      if (c.modelsTested.length) {
        console.log(`    · model: ${c.modelsTested.slice(0, 10).join(', ')}`);
      }
    }
  });
  console.log('');
  console.log(
    'Key: ● tersimpan, ○ kosong · Str=stream Rea=reasoning Too=tools Rek=direkomendasikan',
  );
}

const args = parseArgs(process.argv.slice(2));
const sources = await collect(args);

if (!sources.length) {
  const msg =
    'Tidak ada konfigurasi AI yang ditemukan — isi AI_API_BASE_URL di .env, atau simpan Pengaturan → AI.';
  if (args.json) console.log(JSON.stringify({ sources: [], ok: false, message: msg }, null, 2));
  else console.error(msg);
  process.exit(1);
}

const rows: Row[] = [];
for (const s of sources) {
  rows.push({
    ...s,
    // Deliberately looser than the admin button's 3s: this runs on a VPS over a WAN link, where a
    // step that merely timed out would otherwise be read as "the endpoint does not exist".
    result: await probeCapabilities(s.baseUrl, s.key, s.model, {
      stepTimeoutMs: 10_000,
      budgetMs: 60_000,
    }),
  });
}

if (args.json) {
  console.log(
    JSON.stringify(
      {
        sources: rows.map((r) => ({
          source: r.source,
          baseUrl: r.baseUrl,
          model: r.model,
          keySet: !!r.key,
          shadowedBy: r.shadowedBy,
          ok: r.result.ok,
          error: r.result.error,
          ms: r.result.ms,
          preferred: r.result.preferredEndpoint,
          recommended: isRecommended(r.result),
          capabilities: {
            endpoints: r.result.endpoints,
            stream: r.result.stream,
            reasoning: r.result.reasoning,
            tools: r.result.tools,
            modelsTested: r.result.modelsTested,
            preferredEndpoint: r.result.preferredEndpoint,
          },
          ...(args.verbose ? { steps: r.result.steps } : {}),
        })),
      },
      null,
      2,
    ),
  );
} else {
  printHuman(rows, args);
}

// §10.4 — a failure that leaves at least one working source is reported, not fatal: an operator
// running this before a rollout wants the whole picture, not the first problem.
const failed = rows.filter((r) => !r.result.ok);
const noResponses = rows.filter((r) => r.result.ok && !r.result.endpoints.responses);
if (!args.json) {
  if (failed.length) {
    console.log(`\n${failed.length} sumber gagal: ${failed.map((r) => r.source).join(', ')}`);
  }
  if (args.requireResponses && noResponses.length) {
    console.log(`tanpa /responses: ${noResponses.map((r) => r.source).join(', ')}`);
  }
}
if (rows.every((r) => !r.result.ok)) process.exit(1);
if (args.strict && failed.length) process.exit(1);
if (args.requireResponses && noResponses.length) process.exit(1);
process.exit(0);
