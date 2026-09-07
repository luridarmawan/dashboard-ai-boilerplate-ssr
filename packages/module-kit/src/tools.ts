import type { TenantDb } from '@core/db';
import { CORE_PERMISSION_OWNERS, ModuleContractError } from './contract.ts';
import { type LocalizedText, namespaceOf } from './manifest.ts';

/**
 * AI / MCP tool contract (PRD extension point 8, I-3; file `api/tools.ts`).
 *
 * A tool is a named, schema-described function the AI assistant (and, later, an MCP client) may
 * call on the user's behalf. The core owns the registry and the call path; a module only
 * declares what exists. Three guarantees the core enforces on EVERY call, so a tool can never
 * become a back door around RBAC or tenancy (I-6):
 *
 *   1. the caller holds `permission` (checked with the same registry the API routes use);
 *   2. the module is enabled for the active tenant;
 *   3. `run` receives the tenant facade (`ctx.db`) — the same `TenantDb` route handlers get —
 *      and never a raw connection. Reading across tenants from a tool is a contract violation.
 *
 * `input` is JSON Schema (`type: 'object'`); pass Elysia's `t.Object(...)` and you get validation,
 * the OpenAI `parameters` object and the MCP `inputSchema` from one declaration.
 */

/** JSON Schema for the tool's arguments — must be an object schema. `t.Object(...)` fits structurally. */
export interface ToolInputSchema {
  readonly type: 'object';
  readonly properties?: Readonly<Record<string, unknown>> | undefined;
  readonly required?: readonly string[] | undefined;
  readonly additionalProperties?: boolean | Readonly<Record<string, unknown>> | undefined;
  readonly [key: string]: unknown;
}

export interface ToolContext {
  /** `<ns>.<name>` of the tool being run. */
  readonly tool: string;
  /** Active tenant — never null: a call without a tenant is refused before `run`. */
  readonly clientId: string;
  readonly userId: string;
  /** Tenant-scoped data facade (B-3). The ONLY database handle a tool should touch. */
  readonly db: TenantDb;
  /** The caller's effective permissions — for tools that branch on finer-grained rights. */
  readonly can: (permission: string) => boolean;
  readonly locale: string;
  readonly requestId: string | null;
  /** Aborted when the caller goes away (the chat was stopped, the request was cancelled). */
  readonly signal: AbortSignal;
}

export interface ToolDef<I extends Record<string, unknown> = Record<string, unknown>> {
  /** `<ns>.<name>` — stable identity. The wire name (OpenAI / MCP) is `<ns>_<name>`. */
  readonly name: string;
  /** Shown to the model in the caller's locale; say precisely WHEN to call the tool. */
  readonly description: LocalizedText;
  /**
   * `<resource>.<action>` the caller must hold. Hidden from `tools/list` and refused on call
   * otherwise (I-3). Strongly recommended; a tool without it is callable by any member.
   */
  readonly permission?: string;
  readonly input: ToolInputSchema;
  /** MCP `readOnlyHint`: the tool does not modify state. Default false. */
  readonly readOnly?: boolean;
  /**
   * Execute. Return anything JSON-serialisable (a string is passed through as-is); throw to
   * report a failure — the message reaches the model, never the stack.
   */
  run(input: I, ctx: ToolContext): unknown | Promise<unknown>;
}

/** What the registry sees: a tool plus the module that declared it. */
export interface RegisteredTool extends ToolDef {
  readonly module: string;
  readonly ns: string;
}

const NAME_RE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_-]*$/;
const PERMISSION_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;
/** OpenAI: `^[a-zA-Z0-9_-]{1,64}$`; MCP recommends the same. */
export const TOOL_WIRE_MAX = 64;

/** `example.list_products` → `example_list_products` (the namespace never contains `_`, so it splits back). */
export function toolWireName(name: string): string {
  const dot = name.indexOf('.');
  return dot < 0 ? name : `${name.slice(0, dot)}_${name.slice(dot + 1)}`;
}

/** Inverse of `toolWireName`; returns null for a name no module could have declared. */
export function toolNameFromWire(wire: string): string | null {
  const us = wire.indexOf('_');
  if (us <= 0 || us === wire.length - 1) return null;
  const name = `${wire.slice(0, us)}.${wire.slice(us + 1)}`;
  return NAME_RE.test(name) ? name : null;
}

/**
 * Validate one tool definition against its module namespace. Shared by `defineTools` (author
 * time) and `modules:sync` (enforcement). Throws `ModuleContractError` naming the tool.
 */
export function validateTool(ns: string, tool: Partial<ToolDef> | null | undefined): void {
  if (!tool || typeof tool !== 'object') throw new ModuleContractError('entri tool bukan objek');
  const name = tool.name;
  if (typeof name !== 'string' || !NAME_RE.test(name))
    throw new ModuleContractError(
      `nama tool "${String(name)}" tidak valid — bentuknya "<ns>.<nama>" huruf kecil`,
    );
  if (!name.startsWith(`${ns}.`))
    throw new ModuleContractError(`nama tool "${name}" harus diawali "${ns}." (G-9)`);
  if (toolWireName(name).length > TOOL_WIRE_MAX)
    throw new ModuleContractError(`tool "${name}": nama lebih dari ${TOOL_WIRE_MAX} karakter`);
  const d = tool.description;
  if (!d || typeof d.id !== 'string' || typeof d.en !== 'string' || !d.id.trim() || !d.en.trim())
    throw new ModuleContractError(`tool "${name}": description { id, en } wajib diisi`);
  if (tool.permission !== undefined) {
    if (typeof tool.permission !== 'string' || !PERMISSION_RE.test(tool.permission))
      throw new ModuleContractError(
        `tool "${name}": permission "${String(tool.permission)}" tidak valid`,
      );
    const owner = tool.permission.split('.')[0] ?? '';
    if (owner !== ns && !CORE_PERMISSION_OWNERS.has(owner))
      throw new ModuleContractError(
        `tool "${name}": permission "${tool.permission}" bukan milik modul ini maupun core`,
      );
  }
  const input = tool.input;
  if (!input || typeof input !== 'object' || input.type !== 'object')
    throw new ModuleContractError(
      `tool "${name}": input harus JSON Schema bertipe object (mis. t.Object({...}))`,
    );
  if (typeof tool.run !== 'function')
    throw new ModuleContractError(`tool "${name}": run bukan fungsi`);
}

/**
 * Declare the tools a module contributes (`api/tools.ts`). Names must carry the module
 * namespace; each tool's `permission` must belong to the module or to core.
 */
export function defineTools(moduleName: string, tools: readonly ToolDef[]): readonly ToolDef[] {
  const ns = namespaceOf(moduleName);
  const seen = new Set<string>();
  for (const tool of tools) {
    validateTool(ns, tool);
    if (seen.has(tool.name)) throw new ModuleContractError(`tool "${tool.name}" duplikat`);
    seen.add(tool.name);
  }
  return tools;
}

/** Strip a JSON Schema of TypeBox's symbol keys so it can be serialised for OpenAI / MCP. */
export function toolInputJsonSchema(schema: ToolInputSchema): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}
