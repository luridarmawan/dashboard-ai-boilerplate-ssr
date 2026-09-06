import { defineHooks } from '@core/module-kit';

/** Event subscriptions (extension point 9). A failing handler is logged, never re-thrown to the emitter. */
export default defineHooks('Dummy', {
  'system.ping': async (payload, ctx) => {
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        level: 'info',
        msg: 'dummy heard ping',
        at: payload.at,
        requestId: ctx.requestId,
      }),
    );
  },
});
