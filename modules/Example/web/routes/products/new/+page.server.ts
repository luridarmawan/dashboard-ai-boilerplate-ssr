import { formToObject, validateForm } from '@core/contracts';
import type { Actions } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import { ProductBody } from '../../../../api/schemas.ts';

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const raw = formToObject(form, { nullable: ['summary', 'description', 'imageUrl'] });
    const input = { ...raw, featured: raw.featured !== undefined, currency: 'IDR' };
    if (!checkCsrf(event, form))
      return actionFailure(
        {
          status: 403,
          code: 'csrf_failed',
          message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
        },
        raw,
      );
    const v = validateForm(ProductBody, input); // the API's own schema (L-17)
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: 'Periksa isian yang ditandai',
          details: v.errors,
        },
        raw,
      );
    const r = unwrap<{ success: true; data: { id: string } }>(
      await apiFor(event).v1.m.example.admin.products.post(v.value),
    );
    if (!r.ok) return actionFailure(r.failure, raw);
    redirect(303, `/m/example/products/${r.data.data.id}?saved=1`);
  },
};
