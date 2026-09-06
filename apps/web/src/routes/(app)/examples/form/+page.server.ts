import { formToObject, validateForm } from '@core/contracts';
import { t } from 'elysia';
import { actionFailure, checkCsrf } from '$lib/server/session';
import type { Actions } from './$types';

/** One schema for this form — in a real module it lives in the module's API contract and is imported here. */
const ProductBody = t.Object({
  name: t.String({ minLength: 3, maxLength: 120 }),
  sku: t.String({ pattern: '^[A-Z0-9-]{3,20}$' }),
  category: t.Union([t.Literal('minuman'), t.Literal('bumbu'), t.Literal('pemanis')]),
  price: t.Number({ minimum: 0 }),
  stock: t.Integer({ minimum: 0 }),
  published: t.Optional(t.Boolean()),
  releasedAt: t.Optional(t.String({ format: 'date' })),
  tags: t.Optional(t.Array(t.String(), { maxItems: 5 })),
  description: t.Optional(t.String({ maxLength: 2000 })),
  notes: t.Optional(t.String({ maxLength: 5000 })),
});

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const input = formToObject(form, { arrays: ['tags'] });
    if (input.published !== undefined) input.published = true;
    if (!checkCsrf(event, form))
      return actionFailure(
        {
          status: 403,
          code: 'csrf_failed',
          message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
        },
        input,
      );
    const v = validateForm(ProductBody, input);
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: 'Periksa isian yang ditandai',
          details: v.errors,
        },
        input,
      );
    return { saved: true, values: input };
  },
};
