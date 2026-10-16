import { errorResponses, fail, OkSchema, ok } from '@core/contracts';
import { and, asc, eq, inArray, isNull, like, schema, sql, unsafeAcrossTenants } from '@core/db';
import { Elysia, t } from 'elysia';
import { likePattern } from '../lib/http.ts';
import type { AuthState } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { tenantContext } from '../plugins/tenancy.ts';

/**
 * Administrative regions — read-only reference data for pickers (tenant address, module forms).
 * `regions` is a GLOBAL table: the same rows for every tenant, so it is read with the raw
 * connection and needs only a session, no permission. Loaded with `api regions`.
 *   - `GET /`        children of `parent` (or the top level), or a name search with `q`
 *   - `GET /:code`   one region with its ancestors, top level first
 */

const Region = t.Object({
  code: t.String(),
  parentCode: t.Nullable(t.String()),
  countryCode: t.String(),
  level: t.Integer(),
  name: t.String(),
});
const Code = t.String({ minLength: 1, maxLength: 16, pattern: '^[A-Za-z0-9.]+$' });

/** Children of one parent are bounded (the largest Indonesian district has a few hundred). */
const MAX_CHILDREN = 2000;
const MAX_SEARCH = 50;

const columns = {
  code: schema.regions.code,
  parentCode: schema.regions.parent_code,
  countryCode: schema.regions.country_code,
  level: schema.regions.level,
  name: schema.regions.name,
};

const requireSession = ({
  auth,
  set,
  requestId,
}: {
  auth: AuthState | null;
  set: { status?: number | string };
  requestId: string;
}) => {
  if (auth) return;
  set.status = 401;
  return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', requestId);
};

export const regions = new Elysia({ name: 'regions', prefix: '/regions', tags: ['region'] })
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/',
    async ({ query }) => {
      const db = unsafeAcrossTenants(); // global reference data, no tenant column
      const country = (query.country ?? 'ID').toUpperCase();
      const where = and(
        eq(schema.regions.country_code, country),
        eq(schema.regions.status_id, 1),
        query.q
          ? like(sql`lower(${schema.regions.name})`, likePattern(query.q))
          : query.parent
            ? eq(schema.regions.parent_code, query.parent)
            : query.level === undefined
              ? isNull(schema.regions.parent_code)
              : undefined,
        query.level !== undefined ? eq(schema.regions.level, query.level) : undefined,
        query.q && query.parent ? like(schema.regions.code, `${query.parent}.%`) : undefined,
      );
      const rows = await db
        .select(columns)
        .from(schema.regions)
        .where(where)
        .orderBy(asc(schema.regions.name))
        .limit(query.q ? MAX_SEARCH : MAX_CHILDREN);
      return ok(rows);
    },
    {
      beforeHandle: requireSession,
      query: t.Object({
        parent: t.Optional(Code),
        level: t.Optional(t.Numeric({ minimum: 1, maximum: 9 })),
        q: t.Optional(t.String({ minLength: 2, maxLength: 100 })),
        country: t.Optional(t.String({ minLength: 2, maxLength: 3 })),
      }),
      response: { 200: OkSchema(t.Array(Region)), ...errorResponses },
      detail: {
        summary: 'List regions',
        description:
          'Children of `parent`, or the top level when neither `parent` nor `level` is given. With `q`, a name search (at most 50 rows), optionally narrowed to `level` and to the descendants of `parent`. Indonesian levels: 1 province, 2 regency or city, 3 district, 4 village.',
      },
    },
  )
  .get(
    '/:code',
    async ({ params, set, requestId }) => {
      const db = unsafeAcrossTenants();
      const [region] = await db
        .select(columns)
        .from(schema.regions)
        .where(eq(schema.regions.code, params.code))
        .limit(1);
      if (!region) {
        set.status = 404;
        return fail('not_found', 'Wilayah tidak ditemukan', requestId);
      }
      // Codes are dotted paths, so the ancestors are the code's own prefixes.
      const parts = params.code.split('.');
      const prefixes = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.'));
      const ancestors = prefixes.length
        ? (
            await db
              .select(columns)
              .from(schema.regions)
              .where(inArray(schema.regions.code, prefixes))
          ).sort((a, b) => a.level - b.level)
        : [];
      return ok({ ...region, ancestors });
    },
    {
      beforeHandle: requireSession,
      params: t.Object({ code: Code }),
      response: {
        200: OkSchema(t.Composite([Region, t.Object({ ancestors: t.Array(Region) })])),
        ...errorResponses,
      },
      detail: {
        summary: 'Get a region',
        description: 'One region and its ancestors, top level first.',
      },
    },
  );
