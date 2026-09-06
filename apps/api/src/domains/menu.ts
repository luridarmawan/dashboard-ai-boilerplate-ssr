import { errorResponses, OkSchema, ok } from '@core/contracts';
import { moduleMenu, modules } from '@core/module-kit/registry';
import { Elysia, t } from 'elysia';
import type { AuthState } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { permission, tenantContext } from '../plugins/tenancy.ts';
import { moduleState } from '../services.ts';

/** Menu for API clients (F-1, Appendix A `menu`): module entries filtered by permission and module state. */
const Localized = t.Object({ id: t.String(), en: t.String() });

export const menuDomain = new Elysia({ name: 'menu', prefix: '/menu', tags: ['menu'] })
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/',
    async ({ auth, tenantState }) => {
      const a = auth as AuthState;
      const enabled = await moduleState.enabledFor(tenantState?.clientId ?? null);
      const byNs = new Map<string, string>(modules.map((m) => [m.ns, m.name]));
      return ok(
        moduleMenu
          .filter((m) => enabled.has(byNs.get(m.id.split('.')[0] ?? '') ?? ''))
          .filter(
            (m) =>
              !m.permission || a.user.is_superadmin || (tenantState?.can(m.permission) ?? false),
          )
          .map((m) => ({
            id: m.id,
            label: m.label,
            href: m.href,
            icon: m.icon ?? 'puzzle',
            order: m.order ?? 100,
            parent: m.parent ?? null,
            module: m.module,
          })),
      );
    },
    {
      beforeHandle: permission('user.read'),
      response: {
        200: OkSchema(
          t.Array(
            t.Object({
              id: t.String(),
              label: Localized,
              href: t.String(),
              icon: t.String(),
              order: t.Integer(),
              parent: t.Nullable(t.String()),
              module: t.String(),
            }),
          ),
        ),
        ...errorResponses,
      },
      detail: { summary: 'Module menu entries the caller may see in the active tenant' },
    },
  );
