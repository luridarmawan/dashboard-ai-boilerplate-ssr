import { logger } from '@core/logger';
import { defineHooks } from '@core/module-kit';

/** Event hooks (extension point 9). A failing handler is logged, never re-thrown to the emitter (G-7). */
export default defineHooks('Hello', {
  'user.created': async (payload, ctx) => {
    logger.info('hello: user created', {
      userId: payload.userId,
      clientId: payload.clientId,
      requestId: ctx.requestId,
    });
  },
});
