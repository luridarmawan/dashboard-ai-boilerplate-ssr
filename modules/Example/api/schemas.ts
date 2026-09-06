import { t } from 'elysia';

/** Body schemas shared by the module's API routes AND its dashboard forms (one truth, L-17). */
export const ProductBody = t.Object({
  slug: t.String({ minLength: 2, maxLength: 120, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  name: t.String({ minLength: 2, maxLength: 191 }),
  summary: t.Optional(t.Nullable(t.String({ maxLength: 512 }))),
  description: t.Optional(t.Nullable(t.String({ maxLength: 20000 }))),
  price: t.Integer({ minimum: 0 }),
  currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
  imageUrl: t.Optional(t.Nullable(t.String({ maxLength: 512 }))),
  featured: t.Optional(t.Boolean()),
  sort: t.Optional(t.Integer({ minimum: 0, maximum: 100000 })),
});
export const ProductUpdateBody = t.Partial(ProductBody);

export const InquiryBody = t.Object({
  name: t.String({ minLength: 2, maxLength: 191 }),
  email: t.String({ format: 'email', maxLength: 191 }),
  message: t.String({ minLength: 10, maxLength: 5000 }),
  /** Honeypot: real browsers leave it empty; bots fill every field (R-5). */
  website: t.Optional(t.String({ maxLength: 191 })),
  source: t.Optional(t.String({ maxLength: 191 })),
});
export const InquiryStateBody = t.Object({
  state: t.Union([t.Literal('new'), t.Literal('read'), t.Literal('replied'), t.Literal('spam')]),
});
