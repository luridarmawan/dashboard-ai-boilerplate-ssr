import { settings } from '@app/api/services';
import { and, eq, isNull, schema, unsafeAcrossTenants } from '@core/db';

/**
 * Provider resolution (H-10). A tenant may hold several provider PROFILES (`ai_providers`), each
 * with a priced model list (`ai_models`). A conversation pins one; a request may name one; the
 * tenant marks one as default. Tenants without profiles keep working exactly as before: the
 * legacy `ai.*` settings act as the implicit provider (code null) with the flat `ai.price_*`.
 */

export type ProviderRow = typeof schema.aiProviders.$inferSelect;
export type ModelRow = typeof schema.aiModels.$inferSelect;

export interface ResolvedProvider {
  /** Profile id, or null for the settings-based provider. */
  id: string | null;
  /** Profile code — what `ai_calls.provider` records. */
  code: string | null;
  baseurl: string;
  key: string | null;
  model: string;
  systemPrompt: string | null;
  maxTokens: number;
  /** Price per 1M tokens, micro-units of the currency. */
  priceInMicro: number;
  priceOutMicro: number;
}

/** Enabled profiles of a tenant, default first. */
export async function enabledProviders(clientId: string): Promise<ProviderRow[]> {
  const rows = await unsafeAcrossTenants()
    .select()
    .from(schema.aiProviders)
    .where(
      and(
        eq(schema.aiProviders.client_id, clientId),
        eq(schema.aiProviders.enabled, true),
        isNull(schema.aiProviders.deleted_at),
      ),
    );
  return rows.sort(
    (x, y) => Number(y.is_default) - Number(x.is_default) || x.code.localeCompare(y.code),
  );
}

export async function modelsOf(providerId: string): Promise<ModelRow[]> {
  const rows = await unsafeAcrossTenants()
    .select()
    .from(schema.aiModels)
    .where(eq(schema.aiModels.provider_id, providerId));
  return rows.sort((x, y) => x.model.localeCompare(y.model));
}

export class ProviderNotFound extends Error {
  constructor(readonly code: string) {
    super(`Penyedia AI "${code}" tidak ada atau nonaktif`);
  }
}

/**
 * Pick the provider for a call. Precedence: `wanted.code` (request) → `wanted.providerId`
 * (conversation) → the tenant's default profile → the legacy settings. The model: `wanted.model`
 * → the profile's default model (→ `ai.model` for the legacy path). Prices come from the
 * profile's model row when it exists, else 0 (legacy: `ai.price_*_per_mtok`).
 */
export async function resolveProvider(
  clientId: string,
  wanted: { code?: string | null; providerId?: string | null; model?: string | null } = {},
): Promise<ResolvedProvider> {
  const systemPrompt = (await settings.get<string | null>(clientId, 'ai.system_prompt')) || null;
  const maxTokens = (await settings.get<number | null>(clientId, 'ai.max_tokens')) ?? 1024;
  const profiles = await enabledProviders(clientId);
  let profile: ProviderRow | undefined;
  if (wanted.code) {
    profile = profiles.find((p) => p.code === wanted.code);
    if (!profile) throw new ProviderNotFound(wanted.code);
  } else if (wanted.providerId) {
    profile = profiles.find((p) => p.id === wanted.providerId) ?? profiles[0];
  } else profile = profiles[0];

  if (profile) {
    const model = wanted.model || profile.default_model;
    const priced = (await modelsOf(profile.id)).find((m) => m.model === model);
    return {
      id: profile.id,
      code: profile.code,
      baseurl: profile.base_url.replace(/\/$/, ''),
      key: profile.api_key || null,
      model,
      systemPrompt,
      maxTokens,
      priceInMicro: Number(priced?.price_in_micro ?? 0),
      priceOutMicro: Number(priced?.price_out_micro ?? 0),
    };
  }
  const toMicro = (n: number | null) => Math.round((n ?? 0) * 1_000_000);
  return {
    id: null,
    code: null,
    baseurl: (
      (await settings.get<string | null>(clientId, 'ai.baseurl')) ?? 'https://api.openai.com/v1'
    ).replace(/\/$/, ''),
    key: (await settings.get<string | null>(clientId, 'ai.key')) || null,
    model:
      wanted.model || ((await settings.get<string | null>(clientId, 'ai.model')) ?? 'gpt-4o-mini'),
    systemPrompt,
    maxTokens,
    priceInMicro: toMicro(await settings.get<number | null>(clientId, 'ai.price_in_per_mtok')),
    priceOutMicro: toMicro(await settings.get<number | null>(clientId, 'ai.price_out_per_mtok')),
  };
}

/** Estimated cost in micro-units: tokens × price-per-Mtok-in-micro ÷ 1M. Null when nothing is priced. */
export function costMicro(
  tokensIn: number | null,
  tokensOut: number | null,
  priceInMicro: number,
  priceOutMicro: number,
): number | null {
  if (tokensIn === null || tokensOut === null || !(priceInMicro || priceOutMicro)) return null;
  return Math.round((tokensIn * priceInMicro + tokensOut * priceOutMicro) / 1_000_000);
}

/** Currency units → micro-units per Mtok, as stored. */
export const toPriceMicro = (n: number | undefined) => Math.round((n ?? 0) * 1_000_000);

/**
 * Ask an OpenAI-compatible endpoint for its model list (`GET /models`). Used by the admin's
 * "test" button: it proves URL + key and offers ids to add to the price list.
 */
export async function probeProvider(
  baseUrl: string,
  key: string | null,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error: string | null; models: string[]; ms: number }> {
  const started = performance.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    const ms = Math.round(performance.now() - started);
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      return {
        ok: false,
        error:
          `${res.status}${res.status === 401 || res.status === 403 ? ' — API key ditolak' : ''} ${text}`.trim(),
        models: [],
        ms,
      };
    }
    const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
    const models = (json.data ?? [])
      .map((m) => m.id ?? '')
      .filter((id) => /^[A-Za-z0-9._:/-]{1,120}$/.test(id))
      .sort();
    return { ok: true, error: null, models, ms };
  } catch (err) {
    return {
      ok: false,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      models: [],
      ms: Math.round(performance.now() - started),
    };
  }
}
