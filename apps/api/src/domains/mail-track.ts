import { errorResponses, fail } from '@core/contracts';
import { unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';
import { markOpened, resolveClick } from '@core/mail';
import { Elysia, t } from 'elysia';
import { requestContext } from '../plugins/request-context.ts';

/**
 * Engagement endpoints an e-mail client hits on its own (J-6): the 1×1 image and the button
 * redirect, both keyed by the row's random token and both PUBLIC — no session, no tenant, no
 * CSRF (GET). They never reveal anything: the pixel is the same bytes whether the token exists
 * or not, and the redirect goes only where the mail's own payload pointed. Nothing about the
 * visitor (IP, user agent) is stored — the question is "was it opened", not "by whom from where".
 */

/** A transparent 1×1 GIF, 43 bytes — the smallest thing an `<img>` accepts everywhere. */
const PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

const Token = t.String({ minLength: 1, maxLength: 40 });

export const mailTrack = new Elysia({ name: 'mail-track', prefix: '/mail', tags: ['mail'] })
  .use(requestContext)
  .get(
    '/o/:token',
    async ({ params }) => {
      // `<token>.gif` so clients treat it as an image; the extension is not part of the token.
      const token = params.token.replace(/\.gif$/i, '');
      try {
        await markOpened(unsafeAcrossTenants(), token);
      } catch (err) {
        // The image must load regardless — a failed bookkeeping write is a log line, not a 500.
        logger.warn('mail: open tracking failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return new Response(PIXEL, {
        headers: {
          'content-type': 'image/gif',
          'content-length': String(PIXEL.byteLength),
          // Every open must reach the server: no client, proxy or CDN may serve it from cache.
          'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
          pragma: 'no-cache',
          expires: '0',
        },
      });
    },
    {
      params: t.Object({ token: Token }),
      detail: { summary: 'Tracking pixel: records an open, always answers a 1×1 GIF (J-6)' },
    },
  )
  .get(
    '/c/:token',
    async ({ params, set, requestId }) => {
      const link = await resolveClick(unsafeAcrossTenants(), params.token);
      if (!link) {
        set.status = 404;
        return fail('not_found', 'Tautan tidak dikenal atau sudah tidak berlaku', requestId);
      }
      return new Response(null, {
        status: 302,
        headers: { location: link, 'cache-control': 'no-store' },
      });
    },
    {
      params: t.Object({ token: Token }),
      response: { 404: errorResponses[404] },
      detail: {
        summary:
          'Tracked call-to-action: records the click, redirects to the link the mail carried (J-6)',
      },
    },
  );
