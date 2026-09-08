import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';
import { auth } from './domains/auth.ts';
import { clients } from './domains/clients.ts';
import { configuration } from './domains/configuration.ts';
import { filesDomain } from './domains/files.ts';
import { groups } from './domains/groups.ts';
import { mcpDomain } from './domains/mcp.ts';
import { menuDomain } from './domains/menu.ts';
import { moduleDomain } from './domains/modules.ts';
import { notificationsDomain } from './domains/notifications.ts';
import { outbox } from './domains/outbox.ts';
import { system } from './domains/system.ts';
import { themesDomain } from './domains/themes.ts';
import { tokensDomain } from './domains/tokens.ts';
import { toolsDomain } from './domains/tools.ts';
import { users } from './domains/users.ts';
import { modulesPlugin } from './generated/modules.ts';
import { metricsDomain } from './metrics.ts';
import { csrf } from './plugins/csrf.ts';
import { demoMode } from './plugins/demo.ts';
import { moduleGate } from './plugins/module-gate.ts';
import { requestContext } from './plugins/request-context.ts';

/**
 * The API application, assembled but not listening — `index.ts` listens, tests call
 * `app.handle()`, and SvelteKit imports `type App` for the Eden Treaty client (N-3).
 *
 * Shape (Decision A, E; N-2, N-6):
 *   /openapi.json  OpenAPI 3.1 generated from the route schemas, at runtime
 *   /docs          Scalar UI over it
 *   /v1/...        versioned API surface; every mutation passes the CSRF plugin (A-10)
 *   /v1/m/<ns>/... module APIs, composed statically by modules:sync (G-9, N-3)
 */
export const app = new Elysia()
  .use(requestContext)
  .use(metricsDomain)
  .use(csrf)
  .use(demoMode)
  .use(
    openapi({
      path: '/docs',
      specPath: '/openapi.json',
      documentation: {
        info: {
          title: 'Dashboard AI Boilerplate API',
          version: '0.0.0',
          description:
            'API-first: this document is generated from the route schemas at runtime (PRD N-1, N-2). ' +
            'Every response uses the envelope `{ success, data | error, requestId }` (N-4).',
        },
        tags: [
          { name: 'system', description: 'Liveness, readiness, build identity' },
          { name: 'auth', description: 'Sessions, registration, password flows, tenant switch' },
          { name: 'user', description: 'Users of the active tenant; own profile' },
          { name: 'groups', description: 'Groups, their permissions and members (per tenant)' },
          { name: 'client', description: 'Tenants' },
          {
            name: 'configuration',
            description: 'Runtime configuration per tenant with global fallback',
          },
          { name: 'themes', description: 'Theme registry, default and allowlist' },
          { name: 'module', description: 'Installed modules and per-tenant state' },
          { name: 'menu', description: 'Menu entries for API clients' },
          { name: 'mail', description: 'Email outbox: status, retry, worker' },
          { name: 'notifications', description: 'In-app notifications of the caller (J-4)' },
          {
            name: 'files',
            description: 'Uploads: local volume or S3, validated, under RBAC and tenancy (Q-16)',
          },
          {
            name: 'tools',
            description: 'AI/MCP tools contributed by modules, under RBAC and tenancy',
          },
        ],
      },
    }),
  )
  .group('/v1', (v1) =>
    v1
      .use(system)
      .use(auth)
      .use(users)
      .use(groups)
      .use(clients)
      .use(configuration)
      .use(themesDomain)
      .use(moduleDomain)
      .use(menuDomain)
      .use(outbox)
      .use(notificationsDomain)
      .use(filesDomain)
      .use(tokensDomain)
      .use(toolsDomain)
      .use(mcpDomain)
      .use(moduleGate)
      .use(modulesPlugin),
  );

export type App = typeof app;
