import type { Direction, LocaleResolution } from '@core/i18n';
import type { PublicConfig } from '$lib/server/config';
import type { MaintenanceState } from '$lib/server/maintenance';
import type { Session } from '$lib/server/session';
import type { SidebarState } from '$lib/server/sidebar';
import type { ResolvedTheme } from '$lib/server/theme';

// See https://svelte.dev/docs/kit/types#app.d.ts for what can be declared here.
declare global {
  /** Root package.json version, inlined by Vite (see vite.config.ts). */
  const __APP_VERSION__: string;

  namespace App {
    interface Locals {
      requestId: string;
      /** Resolved once per request in hooks.server.ts; null when nobody is logged in. */
      session: Session | null;
      /** Theme + mode for this request (L-12), resolved before render. */
      theme: ResolvedTheme;
      /** Public runtime configuration + enabled modules of the active tenant (E-2, G-8). */
      config: PublicConfig;
      /** Language for this request (K-2), resolved before render. */
      locale: LocaleResolution;
      /** Writing direction (K-9): from the locale, or the `crk_dir` preview cookie. */
      dir: Direction;
      /** Sidebar rail (F-8): the user's own preference, resolved before render. */
      sidebar: SidebarState;
      /**
       * Maintenance mode (E-10) for this request: on or off, which switch, whether this user is
       * exempt. Module pages read `active` to switch their own features off while staying up.
       */
      maintenance: MaintenanceState;
    }
  }
}
