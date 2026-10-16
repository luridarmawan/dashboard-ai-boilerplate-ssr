import type { RequestEvent } from '@sveltejs/kit';
import { landingTarget } from '../../hooks.server';
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
