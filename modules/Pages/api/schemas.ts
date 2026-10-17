import { t } from 'elysia';

/** Body schemas shared by the API routes AND the dashboard forms (one truth). */

/** Lower-case words joined by single hyphens: `about-us`, `faq-2026`. */
export const SLUG_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$';
export const SLUG_MAX = 120;

const Slug = t.String({ minLength: 1, maxLength: SLUG_MAX, pattern: SLUG_PATTERN });
const Status = t.Union([t.Literal('draft'), t.Literal('published')]);

export const PageBody = t.Object({
  title: t.String({ minLength: 1, maxLength: 191 }),
  /** Optional on create: derived from the title when left empty. */
  slug: t.Optional(Slug),
  summary: t.Optional(t.Nullable(t.String({ maxLength: 512 }))),
  body: t.Optional(t.Nullable(t.String({ maxLength: 100_000 }))),
  status: t.Optional(Status),
  /** Alt text of the featured image (the image itself is uploaded separately, as multipart). */
  imageAlt: t.Optional(t.Nullable(t.String({ maxLength: 191 }))),
});
export const PageUpdateBody = t.Partial(PageBody);

/** Featured image upload: the file, and optionally its alt text in the same request. */
export const ImageBody = t.Object({
  file: t.File(),
  alt: t.Optional(t.String({ maxLength: 191 })),
});

/** The permalink form on the edit page: the slug alone. */
export const SlugBody = t.Object({ slug: Slug });
