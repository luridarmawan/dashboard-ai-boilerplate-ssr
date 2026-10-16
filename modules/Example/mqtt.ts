import { logger } from '@core/logger';
import { defineMqtt } from '@core/module-kit';
import { inboundInquiry, recordInquiry } from './api/inquiries.ts';

/**
 * MQTT subscriptions (extension point 18). The core owns the client — broker, credentials and
 * the on/off switch are Settings → MQTT — and hands every matching message to the handler on
 * ONE instance of the deployment (shared subscription). This is the MQTT twin of the signed
 * inbound route in csrf-exempt.ts: a gateway or device that only speaks MQTT publishes an
 * inquiry to `example/<tenant id>/inquiries` and it lands in the same table, bell and audit log.
 *
 * The tenant travels in the topic because a broker session carries no tenant of its own; the
 * broker's ACL is what decides which account may publish under which tenant. A bad payload is
 * dropped and logged once — a handler that throws is logged and counted too, but a malformed
 * message is not a failure of this module.
 */
export default defineMqtt('Example', [
  {
    name: 'example.inquiries',
    topic: 'example/+/inquiries',
    qos: 1,
    description: {
      id: 'Inquiry dari perangkat/gateway: example/<tenant>/inquiries',
      en: 'Inquiries from devices/gateways: example/<tenant>/inquiries',
    },
    handler: async (message, ctx) => {
      const clientId = message.params[0] ?? '';
      const body = inboundInquiry(message.json());
      if (!/^[0-9a-f-]{20,36}$/i.test(clientId) || !body) {
        logger.warn('example: inquiry over MQTT dropped', {
          topic: message.topic,
          reason: body ? 'tenant id tidak valid' : 'isi tidak valid',
        });
        return;
      }
      const id = await recordInquiry(clientId, body, {
        fallbackSource: 'mqtt',
        ip: null,
        requestId: null,
      });
      logger.info('example: inquiry received over MQTT', {
        inquiryId: id,
        clientId,
        subscription: ctx.subscription,
        instanceId: ctx.instanceId,
      });
    },
  },
]);
