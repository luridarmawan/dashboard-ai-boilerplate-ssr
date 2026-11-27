import { errorResponses, fail } from '@core/contracts';
import { Elysia, t } from 'elysia';
import { requestContext } from '../plugins/request-context.ts';
import { buildRemoteConfig, type RemotePlatform } from '../remote-config.ts';
import { settings } from '../services.ts';

/**
 * `GET /v1/remote-config` — the mobile app's Remote Config, from Settings → Remote Config.
 *
 * Anonymous and global (the section has no tenant scope). The body is the Firebase Remote Config
 * template itself, NOT the `{ success, data }` envelope: the mobile client is pointed at this URL
 * in place of a Firebase export and reads `parameters` from the root. Off in Settings → 404, so
 * the app keeps its built-in defaults. The maintenance gate lets it through: the app has to learn
 * about maintenance while the dashboard is closed.
 */
export const remoteConfigDomain = new Elysia({
  name: 'remote-config',
  prefix: '/remote-config',
  tags: ['configuration'],
})
  .use(requestContext)
  .get(
    '/',
    async ({ query, set, requestId }) => {
      // One resolution of the global scope, then plain lookups.
      const all = await settings.resolveAll(null);
      const get = <T>(key: string) => (all.get(`remote_config.${key}`)?.value ?? null) as T;
      if (get<boolean>('enabled') !== true) {
        set.status = 404;
        return fail('not_found', 'Remote Config tidak aktif', requestId);
      }
      const platform: RemotePlatform = query.platform?.toLowerCase() === 'ios' ? 'ios' : 'android';
      const body = buildRemoteConfig(
        {
          maintenanceMode: get<boolean>('maintenance_mode') === true,
          forceUpdate: get<boolean>('force_update') === true,
          latestVersion: get<string | null>('latest_version'),
          minVersion: get<string | null>('min_version'),
          versionNumber: Number(get<number>('version_number')),
          minimumVersionNumber: Number(get<number>('minimum_version_number')),
          updateUrl: get<string | null>('update_url'),
          iosUpdateUrl: get<string | null>('ios_update_url'),
          parameters: get<string | null>('parameters'),
        },
        platform,
      );
      return new Response(JSON.stringify(body, null, 2), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          // Read by apps, not by pages of another origin — but a web client may read it too.
          'access-control-allow-origin': '*',
          // Short: a maintenance switch has to reach installed apps within a minute.
          'cache-control': 'public, max-age=60',
          'x-request-id': requestId,
        },
      });
    },
    {
      query: t.Object({ platform: t.Optional(t.String({ maxLength: 16 })) }),
      response: { 200: t.Unknown(), ...errorResponses },
      detail: {
        summary: 'Get the mobile Remote Config',
        description:
          'Public. The mobile app configuration from Settings → Remote Config as a Firebase ' +
          'Remote Config template (`parameters` + `version` at the root, no envelope). ' +
          '`platform=ios` makes `update_url` the App Store link. 404 while switched off.',
      },
    },
  );
