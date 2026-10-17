import type { RequestEvent } from '@sveltejs/kit';
import { landingTarget } from '../../hooks.server';
import { DEFAULT_OG_IMAGE } from '../seo';
import { apiFetchData } from './session';
import { canonicalPath, trappedPath } from './trap';

/**
 * The canonical URL of the page being rendered (R-4): the address the visitor sees, without the
 * query, and `/` for the page that currently serves the front door (F-5) — even on a direct
 * visit to its own path, so search engines index one URL per content. Module public pages put
 * this in `rel=canonical`, `og:url` and their JSON-LD.
 */
export function canonicalUrl(event: RequestEvent): string {
  const trapped = trappedPath(event);
  return (
    event.url.origin +
    canonicalPath({
      visible: trapped ? trapped.pathname : event.url.pathname,
      route: event.url.pathname,
      landing: landingTarget(event),
    })
  );
}

/** An absolute og:image with what crawlers like to know about it. */
export interface ShareImage {
  readonly url: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly mime: string;
}

/**
 * The site's default share image for this request: the one an admin uploaded under Settings →
 * Application (`app.share_image`, the visitor's tenant else global), else the file the deploy
 * ships (`DEFAULT_OG_IMAGE`). Public pages without an image of their own put it in og:image and
 * twitter:image. Absolute, as crawlers require. Asks the API only when the setting is filled.
 */
export async function shareImage(event: RequestEvent): Promise<ShareImage> {
  const origin = event.url.origin;
  const fallback: ShareImage = {
    url: `${origin}${DEFAULT_OG_IMAGE.path}`,
    width: DEFAULT_OG_IMAGE.width,
    height: DEFAULT_OG_IMAGE.height,
    mime: DEFAULT_OG_IMAGE.mime,
  };
  const id = event.locals.config.values['app.share_image'];
  if (typeof id !== 'string' || !id) return fallback;
  const meta = await apiFetchData<{
    url: string;
    width: number | null;
    height: number | null;
    mime: string;
  } | null>(
    event,
    '/v1/configuration/image/app.share_image',
    event.locals.session?.clientId ?? null,
    {
      signal: AbortSignal.timeout(2000),
    },
  );
  if (!meta) return fallback;
  return { ...meta, url: /^https?:\/\//.test(meta.url) ? meta.url : `${origin}${meta.url}` };
}
