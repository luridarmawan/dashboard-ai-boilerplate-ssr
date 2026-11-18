import { fail } from '@core/contracts';
import { newId } from '@core/db';
import type { TenantState } from './tenancy.ts';

/**
 * Who may reach the tool registry from OUTSIDE the dashboard: `GET/POST /v1/tools`, the MCP
 * server (`/v1/mcp`) and minting the API token an MCP client needs (`POST /v1/tokens`).
 *
 * Each tool already checks its own permission, but that only answers "may this user read
 * members?" — not "may this user wire an assistant to the dashboard?". The second question is
 * this permission: an administrator grants it to the groups that should have the integration,
 * and nobody else gets it, however much data their role lets them read.
 *
 * It is the permission the AI module declares for its external MCP servers, so one grant covers
 * both directions of the integration. On an install without that module only superadmins and
 * holders of a wildcard grant pass, which is the right default for a door nobody was given.
 *
 * The check reads the USER's permissions, not the token's scopes (`holds`, not `can`): a token
 * narrowed to `example.product.read` still belongs to someone entitled to the integration. The AI chat
 * calls the registry in-process and is governed by its own permissions (`ai.chat.*`).
 */
export const TOOL_ACCESS_PERMISSION = 'ai.mcp.use';

interface Ctx {
  auth: unknown;
  tenantState?: TenantState;
  set: { status?: number | string; headers: Record<string, string | number | undefined> };
  request: Request;
}

/** `beforeHandle` guard: 403 unless the signed-in user holds `TOOL_ACCESS_PERMISSION`. */
export function requireToolAccess({ auth, tenantState, set, request }: Ctx) {
  // No session: left to the route's own 401 guard, which runs first.
  if (!auth || tenantState?.holds(TOOL_ACCESS_PERMISSION)) return undefined;
  const rid = String(set.headers['x-request-id'] ?? request.headers.get('x-request-id') ?? newId());
  set.status = 403;
  return fail('forbidden', 'Akun Anda tidak diberi akses ke integrasi AI/MCP', rid, {
    reason: 'forbidden',
    permission: TOOL_ACCESS_PERMISSION,
  });
}
