import { settings } from '@app/api/services';
import { env } from '@core/config';
import { and, eq, isNull, schema, unsafeAcrossTenants } from '@core/db';
import { capabilitiesOf, type Endpoint, type ReasoningParam } from './probe.ts';

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
  /** Which upstream endpoint to call (AI-Roadmap F2). */
  endpoint: Endpoint;
  /** Reasoning effort to ask for, or null to send nothing and take the provider's default (F3). */
  reasoningEffort: string | null;
  /** Which spelling this provider understood at probe time; null = the modern nested one. */
  reasoningParam: ReasoningParam | null;
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
 * `ai.preferred_endpoint = auto` (the default for the settings-based provider) is resolved
 * optimistically: try `/responses`, and let the runtime fallback record the answer when a
 * provider turns out not to have it. That costs one wasted 404 per base URL per TTL instead of a
 * probe on every chat — §9 rules out probing per request, and §5.1 rules out writing to the DB
 * from the chat path.
 *
 * Keyed by base URL because endpoint availability is a property of the API, not of the model.
 * In-process on purpose: a stale entry costs one extra round-trip, never a wrong answer, so
 * workers do not need to agree.
 */
const AUTO_TTL_MS = 600_000;
const autoEndpoints = new Map<string, { endpoint: Endpoint; at: number }>();

const autoKey = (baseUrl: string) => baseUrl.replace(/\/$/, '');

function autoEndpoint(baseUrl: string): Endpoint {
  const key = autoKey(baseUrl);
  const hit = autoEndpoints.get(key);
  if (hit && Date.now() - hit.at < AUTO_TTL_MS) return hit.endpoint;
  if (hit) autoEndpoints.delete(key);
  return 'responses';
}

/** Called when a live `/responses` call answered 404/405: remember it for the next requests. */
export function noteResponsesMissing(baseUrl: string): void {
  autoEndpoints.set(autoKey(baseUrl), { endpoint: 'chat_completions', at: Date.now() });
}

/** Test seam: the cache is process-wide and would otherwise leak between cases. */
export function resetEndpointCache(): void {
  autoEndpoints.clear();
}

const asEndpoint = (v: unknown): Endpoint | null =>
  v === 'responses' || v === 'chat_completions' ? v : null;

const EFFORTS = new Set(['minimal', 'low', 'medium', 'high']);
/** `provider` (the default) and anything unknown mean: send no reasoning parameter at all. */
const asEffort = (v: unknown): string | null =>
  typeof v === 'string' && EFFORTS.has(v) ? v : null;

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
  const reasoningEffort = asEffort(
    await settings.get<string | null>(clientId, 'ai.reasoning_effort'),
  );
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
      // A profile that has never been probed keeps the pre-F2 behaviour exactly (§7.6).
      endpoint: asEndpoint(profile.preferred_endpoint) ?? 'chat_completions',
      reasoningEffort,
      // The probe recorded which spelling this provider accepted; without one, use the modern
      // nested `reasoning: { effort }` — the shape verified against a live provider (§12).
      reasoningParam: capabilitiesOf(profile.capabilities)?.reasoning.param ?? null,
      priceInMicro: Number(priced?.price_in_micro ?? 0),
      priceOutMicro: Number(priced?.price_out_micro ?? 0),
    };
  }
  const toMicro = (n: number | null) => Math.round((n ?? 0) * 1_000_000);
  const e = env();
  const baseurl = (
    (await settings.get<string | null>(clientId, 'ai.baseurl')) ??
    e.AI_API_BASE_URL ??
    'https://api.openai.com/v1'
  ).replace(/\/$/, '');
  return {
    id: null,
    code: null,
    baseurl,
    endpoint:
      asEndpoint(await settings.get<string | null>(clientId, 'ai.preferred_endpoint')) ??
      autoEndpoint(baseurl),
    reasoningEffort,
    reasoningParam: null,
    key: (await settings.get<string | null>(clientId, 'ai.key')) || e.AI_API_KEY || null,
    model:
      wanted.model ||
      ((await settings.get<string | null>(clientId, 'ai.model')) ?? e.AI_MODEL ?? 'gpt-4o-mini'),
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
