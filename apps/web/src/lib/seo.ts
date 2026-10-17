/**
 * The site's default share image (R-4): the file the deploy ships at apps/web/static/og-image.jpg.
 * Public pages without an image of their own use it for og:image / twitter:image, so a shared
 * link never goes out as a bare text card. Replacing the file means updating the size here too.
 * Crawlers need an absolute URL: prefix `path` with the request origin.
 */
export const DEFAULT_OG_IMAGE = {
  path: '/og-image.jpg',
  width: 1672,
  height: 941,
  mime: 'image/jpeg',
} as const;
