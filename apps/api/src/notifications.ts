import { hasPermission } from '@core/auth';
import { and, eq, isNull, newId, STATUS, schema, unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';
import { emit } from './services.ts';

/**
 * In-app notifications (PRD J-4) — the backend behind the bell. Core and modules call `notify()`
 * after an action succeeded; it never throws into the caller's request (a notification is a
 * courtesy, the action already happened).
 *
 * Targets:
 *   - `userIds`   explicit recipients (e.g. the owner of a new API token)
 *   - `permission` every user of the tenant whose groups grant it — "tell whoever may handle this"
 *     (e.g. `example.inquiry.read` for a new contact-form message). Superadmins who are not tenant
 *     members are not included: they see everything already and would drown in noise.
 * Modules import this as `@app/api/notifications`; the rows are tenant data like everything else.
 */

export interface NotifyInput {
  readonly clientId: string;
  readonly type: string;
  readonly title: string;
  readonly body?: string | null;
  readonly link?: string | null;
  readonly data?: Record<string, unknown> | null;
  readonly userIds?: readonly string[];
  readonly permission?: string;
  /** Never notify these users (typically the actor who caused the event). */
  readonly excludeUserIds?: readonly string[];
}

export interface NotifyResult {
  readonly recipients: number;
  readonly ids: readonly string[];
}

/** Users of `clientId` whose group grants satisfy `permission` (C-3 semantics, computed once). */
export async function usersWithPermission(clientId: string, permission: string): Promise<string[]> {
  const db = unsafeAcrossTenants();
  const grants = await db
    .select({
      groupId: schema.groupPermissions.group_id,
      permission: schema.groupPermissions.permission,
    })
    .from(schema.groupPermissions)
    .where(eq(schema.groupPermissions.client_id, clientId));
  const byGroup = new Map<string, string[]>();
  for (const g of grants) byGroup.set(g.groupId, [...(byGroup.get(g.groupId) ?? []), g.permission]);
  const groupIds = [...byGroup.entries()]
    .filter(([, p]) => hasPermission(p, permission))
    .map(([id]) => id);
  if (!groupIds.length) return [];
  // Live groups, live and active users only: a deactivated account keeps no inbox growing.
  const members = await db
    .select({ userId: schema.groupUserMaps.user_id, groupId: schema.groupUserMaps.group_id })
    .from(schema.groupUserMaps)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupUserMaps.group_id))
    .innerJoin(schema.users, eq(schema.users.id, schema.groupUserMaps.user_id))
    .where(
      and(
        eq(schema.groupUserMaps.client_id, clientId),
        isNull(schema.groups.deleted_at),
        isNull(schema.users.deleted_at),
        eq(schema.users.status_id, STATUS.ACTIVE),
      ),
    );
  const set = new Set(members.filter((m) => groupIds.includes(m.groupId)).map((m) => m.userId));
  return [...set];
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  try {
    const exclude = new Set(input.excludeUserIds ?? []);
    const targets = new Set<string>(input.userIds ?? []);
    if (input.permission)
      for (const id of await usersWithPermission(input.clientId, input.permission)) targets.add(id);
    const recipients = [...targets].filter((id) => !exclude.has(id));
    if (!recipients.length) return { recipients: 0, ids: [] };
    const rows = recipients.map((userId) => ({
      id: newId(),
      client_id: input.clientId,
      user_id: userId,
      type: input.type.slice(0, 64),
      title: input.title.slice(0, 191),
      body: input.body ?? null,
      link: input.link?.slice(0, 512) ?? null,
      data: input.data ?? null,
      read_at: null,
    }));
    await unsafeAcrossTenants().insert(schema.notifications).values(rows);
    emit('notification.created', {
      clientId: input.clientId,
      type: input.type,
      userIds: recipients,
    });
    return { recipients: recipients.length, ids: rows.map((r) => r.id) };
  } catch (err) {
    logger.warn('notify: failed', {
      type: input.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return { recipients: 0, ids: [] };
  }
}
