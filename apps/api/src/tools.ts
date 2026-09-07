import { writeAudit } from '@core/auth';
import { forTenant, unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';
import {
  type LocalizedText,
  type RegisteredTool,
  type ToolDef,
  type ToolInputSchema,
  toolInputJsonSchema,
  toolNameFromWire,
  toolWireName,
} from '@core/module-kit';
import { Value } from '@sinclair/typebox/value';
import { moduleTools } from './generated/tools.ts';
import { moduleState } from './services.ts';

/**
 * Core tool registry (PRD extension point 8, I-3, I-6) — the ONE place AI tools are listed and
 * called. Consumers: the AI module's chat loop today, `/v1/tools` for API clients, the MCP server
 * later (FR-I). None of them may reach a module's `run` any other way, because this is where
 * the three guarantees live:
 *
 *   visible   ⇔ module enabled for the active tenant ∧ caller holds `permission`
 *   callable  ⇔ visible ∧ input validates against the declared JSON Schema
 *   scoped    ⇔ `run` gets `forTenant(clientId)` — never a raw connection
 *
 * Every call is audited (`tool.call`), success or failure, with the tool name as resource.
 */

export interface ToolCaller {
  readonly clientId: string | null;
  readonly userId: string;
  readonly can: (permission: string) => boolean;
  readonly locale?: string;
  readonly requestId?: string | null;
  readonly signal?: AbortSignal;
  readonly ip?: string | null;
}

/** Wire-level description of a tool: what `tools/list` (MCP) and OpenAI `tools` need. */
export interface ToolDescriptor {
  readonly name: string;
  /** `<ns>_<name>` — the identifier the model / MCP client uses. */
  readonly wire: string;
  readonly module: string;
  readonly description: LocalizedText;
  readonly permission: string | null;
  readonly readOnly: boolean;
  readonly inputSchema: Record<string, unknown>;
}

export type ToolCallResult =
  | { readonly ok: true; readonly name: string; readonly result: unknown; readonly ms: number }
  | {
      readonly ok: false;
      readonly name: string;
      readonly code:
        | 'not_found'
        | 'no_tenant'
        | 'module_disabled'
        | 'forbidden'
        | 'invalid_input'
        | 'failed';
      readonly message: string;
      readonly ms: number;
    };

const all: readonly RegisteredTool[] = moduleTools.flatMap((m) =>
  m.tools.map((tool: ToolDef) => ({ ...tool, module: m.module, ns: m.ns })),
);
const byName = new Map(all.map((tool) => [tool.name, tool]));

/** Every declared tool, regardless of caller — for admin views and tests. */
export function allTools(): readonly RegisteredTool[] {
  return all;
}

function resolve(nameOrWire: string): RegisteredTool | undefined {
  return byName.get(nameOrWire) ?? byName.get(toolNameFromWire(nameOrWire) ?? '');
}

export function describeTool(tool: RegisteredTool): ToolDescriptor {
  return {
    name: tool.name,
    wire: toolWireName(tool.name),
    module: tool.module,
    description: tool.description,
    permission: tool.permission ?? null,
    readOnly: tool.readOnly ?? false,
    inputSchema: toolInputJsonSchema(tool.input),
  };
}

/** Tools the caller may see in the active tenant: module enabled and permission held (I-3). */
export async function listTools(caller: ToolCaller): Promise<readonly RegisteredTool[]> {
  if (!all.length) return [];
  const enabled = await moduleState.enabledFor(caller.clientId);
  return all.filter(
    (tool) => enabled.has(tool.module) && (!tool.permission || caller.can(tool.permission)),
  );
}

/** OpenAI `tools` array for a chat completion request, descriptions in the caller's locale. */
export function toOpenAiTools(tools: readonly RegisteredTool[], locale = 'id') {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: toolWireName(tool.name),
      description: locale === 'en' ? tool.description.en : tool.description.id,
      parameters: toolInputJsonSchema(tool.input),
    },
  }));
}

function validationMessage(schema: ToolInputSchema, input: unknown): string | null {
  if (Value.Check(schema as never, input)) return null;
  const first = Value.Errors(schema as never, input).First();
  return first ? `${first.path || '/'}: ${first.message}` : 'input tidak sesuai skema';
}

/** Render a tool result for the model: strings pass through, everything else becomes JSON. */
export function toolResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === undefined) return 'ok';
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * Call a tool by `<ns>.<name>` or wire name. Never throws: refusals and tool failures come back
 * as `{ ok: false }` so the caller (a chat loop, an MCP handler) can hand the message to the model.
 */
export async function callTool(
  nameOrWire: string,
  rawInput: unknown,
  caller: ToolCaller,
): Promise<ToolCallResult> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const tool = resolve(nameOrWire);
  const name = tool?.name ?? nameOrWire;
  const refuse = (code: Exclude<ToolCallResult, { ok: true }>['code'], message: string) => {
    void audit(caller, name, { ok: false, code });
    return { ok: false as const, name, code, message, ms: ms() };
  };
  if (!tool) return refuse('not_found', `Tool "${nameOrWire}" tidak ada`);
  if (!caller.clientId) return refuse('no_tenant', 'Tidak ada tenant aktif');
  if (!(await moduleState.isEnabled(caller.clientId, tool.module)))
    return refuse('module_disabled', `Modul ${tool.module} nonaktif untuk tenant ini`);
  if (tool.permission && !caller.can(tool.permission))
    return refuse('forbidden', `Anda tidak punya izin ${tool.permission}`);
  const input = rawInput === undefined || rawInput === null ? {} : rawInput;
  const invalid = validationMessage(tool.input, input);
  if (invalid) return refuse('invalid_input', `Argumen tool tidak valid — ${invalid}`);

  try {
    const result = await tool.run(input as Record<string, unknown>, {
      tool: tool.name,
      clientId: caller.clientId,
      userId: caller.userId,
      db: forTenant(caller.clientId),
      can: caller.can,
      locale: caller.locale ?? 'id',
      requestId: caller.requestId ?? null,
      signal: caller.signal ?? new AbortController().signal,
    });
    void audit(caller, name, { ok: true });
    return { ok: true, name, result, ms: ms() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('tool: run failed', {
      tool: name,
      error: message,
      requestId: caller.requestId ?? null,
    });
    void audit(caller, name, { ok: false, code: 'failed' });
    return { ok: false, name, code: 'failed', message: `Tool gagal: ${message}`, ms: ms() };
  }
}

/** Off the hot path (H-9 style): a failed audit row is logged, never thrown at the caller. */
async function audit(
  caller: ToolCaller,
  name: string,
  outcome: { ok: boolean; code?: string },
): Promise<void> {
  try {
    await writeAudit(unsafeAcrossTenants(), {
      clientId: caller.clientId,
      actorId: caller.userId,
      action: 'tool.call',
      resource: name,
      ip: caller.ip ?? null,
      requestId: caller.requestId ?? null,
      after: outcome,
    });
  } catch (err) {
    logger.warn('tool: audit failed', {
      tool: name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
