import { type Db, eq, newId, schema } from '@core/db';
import { TOOL_ACCESS_PERMISSION } from '../../src/plugins/tool-access.ts';

/**
 * Give `userId` access to the AI/MCP integration in `tenantId` — and nothing else — through a
 * group of its own, as an administrator would. Returns a function that takes it away again.
 */
export async function grantToolAccess(db: Db, tenantId: string, userId: string) {
  const groupId = newId();
  const mapId = newId();
  await db.insert(schema.groups).values({
    id: groupId,
    client_id: tenantId,
    code: `tool_access_${groupId.slice(-12)}`,
    name: 'Tool access (test)',
    description: null,
  });
  await db.insert(schema.groupPermissions).values({
    id: newId(),
    client_id: tenantId,
    group_id: groupId,
    permission: TOOL_ACCESS_PERMISSION,
  });
  await db
    .insert(schema.groupUserMaps)
    .values({ id: mapId, client_id: tenantId, group_id: groupId, user_id: userId });
  return async () => {
    await db.delete(schema.groupUserMaps).where(eq(schema.groupUserMaps.id, mapId));
  };
}
