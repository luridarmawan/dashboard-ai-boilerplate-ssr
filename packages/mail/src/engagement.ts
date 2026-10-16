import { randomBytes } from 'node:crypto';
import {
  affectedRows as affected,
  and,
  type Db,
  desc,
  eq,
  inArray,
  isNull,
  schema,
  sql,
} from '@core/db';

/**
 * Engagement (J-6): what happened to a mail AFTER it left. Three signals of rising strength,
 * all kept on the outbox row next to — never inside — its delivery status:
 *   - opened: the 1×1 image in the HTML was fetched (image proxies and privacy pre-fetchers
 *     fire it too, and clients that block images never do — a hint, not a fact);
 *   - clicked: the call-to-action button went through our redirect (link scanners can trigger
 *     it, people mostly do);
 *   - acted: the one-time token the mail carried was USED — verify, reset, join. Nothing but a
 *     person reading the mail can do that.
 */

/** Hex token behind the pixel and click URLs. Random, unguessable, and useless beyond this row. */
export function newOpenToken(): string {
  return randomBytes(16).toString('hex');
}

const TOKEN = /^[0-9a-f]{32}$/;

/**
 * `coalesce(column, now)`: keep the first time a signal was seen. The time is bound through the
 * column's own encoder — a bare `Date` inside `sql` is not, and on SQLite (epoch milliseconds)
 * the UPDATE then silently changes no row.
 */
type DateColumn = (typeof schema.outboxEmail)['opened_at' | 'clicked_at' | 'acted_at'];
const firstTime = (column: DateColumn, now: Date) =>
  sql`coalesce(${column}, ${sql.param(now, column)})`;

/** Give the row its token if it has none yet; returns the token in effect. */
export async function ensureOpenToken(db: Db, id: string, current: string | null): Promise<string> {
  if (current) return current;
  const token = newOpenToken();
  await db
    .update(schema.outboxEmail)
    .set({ open_token: token })
    .where(and(eq(schema.outboxEmail.id, id), isNull(schema.outboxEmail.open_token)));
  // Another instance may have minted one in between; whatever is stored wins.
  const [row] = await db
    .select({ open_token: schema.outboxEmail.open_token })
    .from(schema.outboxEmail)
    .where(eq(schema.outboxEmail.id, id))
    .limit(1);
  return row?.open_token ?? token;
}

/** Record one fetch of the pixel. Unknown or malformed tokens are silently ignored. */
export async function markOpened(db: Db, token: string): Promise<boolean> {
  if (!TOKEN.test(token)) return false;
  const now = new Date();
  const r = await db
    .update(schema.outboxEmail)
    .set({
      opened_at: firstTime(schema.outboxEmail.opened_at, now),
      open_count: sql`${schema.outboxEmail.open_count} + 1`,
    })
    .where(eq(schema.outboxEmail.open_token, token));
  return affected(r) === 1;
}

/**
 * Record a click and answer where to send the visitor: the link the row was rendered with,
 * read back from its own payload — never from the request — so this can never redirect
 * anywhere the mail itself did not point at. Null = unknown token or a mail without a link.
 */
export async function resolveClick(db: Db, token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db
    .select({ id: schema.outboxEmail.id, payload: schema.outboxEmail.payload })
    .from(schema.outboxEmail)
    .where(eq(schema.outboxEmail.open_token, token))
    .limit(1);
  const link = (row?.payload as { link?: unknown } | null)?.link;
  if (!row || typeof link !== 'string' || !/^https?:\/\//i.test(link)) return null;
  const now = new Date();
  await db
    .update(schema.outboxEmail)
    .set({
      clicked_at: firstTime(schema.outboxEmail.clicked_at, now),
      // A click proves the mail was open even when the image never loaded.
      opened_at: firstTime(schema.outboxEmail.opened_at, now),
    })
    .where(eq(schema.outboxEmail.id, row.id));
  return link;
}

/**
 * The recipient confirmed receipt on the page the mail linked to — `acted` for a mail whose only
 * "action" is that confirmation (the Settings → Email test). Keyed by the row's own token, and
 * only for the templates the caller names, so the token of a reset or an invite can never be
 * spent this way. Repeats keep the first time. False = unknown token or not such a mail.
 */
export async function markConfirmed(
  db: Db,
  token: string,
  templates: readonly string[],
): Promise<boolean> {
  if (!TOKEN.test(token) || !templates.length) return false;
  const now = new Date();
  const r = await db
    .update(schema.outboxEmail)
    .set({
      acted_at: firstTime(schema.outboxEmail.acted_at, now),
      // Reaching the page means the link was followed and the mail was open, image or not.
      clicked_at: firstTime(schema.outboxEmail.clicked_at, now),
      opened_at: firstTime(schema.outboxEmail.opened_at, now),
    })
    .where(
      and(
        eq(schema.outboxEmail.open_token, token),
        inArray(schema.outboxEmail.template, [...templates]),
      ),
    );
  return affected(r) === 1;
}

export interface Engagement {
  readonly status: string;
  readonly sentAt: string | null;
  readonly openedAt: string | null;
  readonly openCount: number;
  readonly clickedAt: string | null;
  readonly actedAt: string | null;
}

/** Delivery state and engagement of one outbox row, as ISO strings; null = no such row. */
export async function engagementOf(
  db: Db,
  id: string,
  where: { readonly template: string; readonly clientId: string | null },
): Promise<Engagement | null> {
  const [row] = await db
    .select()
    .from(schema.outboxEmail)
    .where(
      and(
        eq(schema.outboxEmail.id, id),
        eq(schema.outboxEmail.template, where.template),
        where.clientId === null
          ? isNull(schema.outboxEmail.client_id)
          : eq(schema.outboxEmail.client_id, where.clientId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    status: row.status,
    sentAt: row.sent_at?.toISOString() ?? null,
    openedAt: row.opened_at?.toISOString() ?? null,
    openCount: row.open_count,
    clickedAt: row.clicked_at?.toISOString() ?? null,
    actedAt: row.acted_at?.toISOString() ?? null,
  };
}

export interface ActedInput {
  /** The address the mail went to, or the user it was addressed to (looked up here). */
  readonly to?: string | undefined;
  readonly userId?: string | undefined;
  /** Which mails could have carried the token that was just used. */
  readonly templates: readonly string[];
}

/**
 * The token a mail carried was used: stamp `acted_at` on the LATEST delivered mail of that kind
 * to that address that has no stamp yet. "Latest" because a re-sent reset link supersedes the
 * one before it, and only one of them can be the mail the person actually followed.
 */
export async function markActed(db: Db, input: ActedInput): Promise<boolean> {
  let to = input.to?.trim().toLowerCase() ?? '';
  if (!to && input.userId) {
    const [u] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);
    to = u?.email?.toLowerCase() ?? '';
  }
  if (!to || !input.templates.length) return false;
  const [row] = await db
    .select({ id: schema.outboxEmail.id })
    .from(schema.outboxEmail)
    .where(
      and(
        eq(schema.outboxEmail.to_address, to),
        inArray(schema.outboxEmail.template, [...input.templates]),
        eq(schema.outboxEmail.status, 'sent'),
        isNull(schema.outboxEmail.acted_at),
      ),
    )
    .orderBy(desc(schema.outboxEmail.created_at))
    .limit(1);
  if (!row) return false;
  const now = new Date();
  await db
    .update(schema.outboxEmail)
    .set({
      acted_at: now,
      // Following the link is the strongest proof of an open there is.
      opened_at: firstTime(schema.outboxEmail.opened_at, now),
    })
    .where(eq(schema.outboxEmail.id, row.id));
  return true;
}
