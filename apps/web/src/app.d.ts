import type { Direction, LocaleResolution } from '@core/i18n';
import type { PublicConfig } from '$lib/server/config';
import type { Session } from '$lib/server/session';
import type { ResolvedTheme } from '$lib/server/theme';

// See https://svelte.dev/docs/kit/types#app.d.ts for what can be declared here.
declare global {
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
      /** Writing direction (K-9): from the locale, or the `dab_dir` preview cookie. */
      dir: Direction;
    }
  }
}
