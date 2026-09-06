import type { Session } from '$lib/server/session';

// See https://svelte.dev/docs/kit/types#app.d.ts for what can be declared here.
declare global {
  namespace App {
    interface Locals {
      requestId: string;
      /** Resolved once per request in hooks.server.ts; null when nobody is logged in. */
      session: Session | null;
    }
  }
}
