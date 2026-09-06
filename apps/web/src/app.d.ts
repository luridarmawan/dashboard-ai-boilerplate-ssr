// See https://svelte.dev/docs/kit/types#app.d.ts for what can be declared here.
declare global {
  namespace App {
    interface Locals {
      requestId: string;
    }
  }
}

export {};
