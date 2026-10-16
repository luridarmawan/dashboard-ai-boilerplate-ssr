import { logger } from '@core/logger';
import { defineMqtt } from '@core/module-kit';

/**
 * MQTT subscription (extension point 18). The core owns the client (Settings → MQTT); a message
 * on the topic reaches ONE instance of the deployment. Nothing happens until an admin switches
 * the client on, so this costs nothing in a deployment without a broker.
 */
export default defineMqtt('Hello', [
  {
    name: 'hello.ping',
    topic: 'hello/ping',
    description: { id: 'Menerima ping dari perangkat', en: 'Receives a device ping' },
    handler: async (message, ctx) => {
      logger.info('hello: ping over MQTT', {
        payload: message.text().slice(0, 200),
        instanceId: ctx.instanceId,
      });
      await ctx.publish('hello/pong', message.text());
    },
  },
]);
