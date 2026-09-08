import { formToObject, UserUpdateBody, validateForm } from '@core/contracts';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, forwardSetCookies, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const client = apiFor(event);
  const [user, groups] = await Promise.all([
    client.v1.users({ id: event.params.id }).get(),
    client.v1.groups.get({ query: { limit: 100 } }),
  ]);
  if (!user.data?.success)
    error(user.status === 404 ? 404 : user.status, 'Pengguna tidak ditemukan');
  // `user` here is the VIEWED user (it shadows the layout's session user); the viewer comes apart.
  const me = event.locals.session?.user;
  return {
    user: user.data.data,
    viewer: { id: me?.id ?? '', isSuperadmin: me?.isSuperadmin ?? false },
    groups: groups.data?.success ? groups.data.data : [],
    created: event.url.searchParams.has('created'),
  };
};

export const actions: Actions = {
  /** Impersonate (D-6): superadmin only; the API sets a second cookie, the dashboard shows a banner. */
  impersonate: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    const res = await apiFor(event).v1.users({ id: event.params.id }).impersonate.post();
    const r = unwrap(res);
    if (!r.ok) return actionFailure(r.failure);
    forwardSetCookies(event, res.response);
    redirect(303, '/dashboard');
  },
  save: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    }
    // Checkbox semantics → schema shape: `active` on/off becomes statusId 1/0.
    const raw = formToObject(form, { arrays: ['groupIds'] });
    const input: Record<string, unknown> = {
      name: raw.name,
      locale: raw.locale,
      statusId: raw.active !== undefined ? 1 : 0,
      groupIds: raw.groupIds,
    };
    if (event.locals.session?.user.isSuperadmin)
      input.isSuperadmin = raw.isSuperadmin !== undefined;
    const v = validateForm(UserUpdateBody, input);
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
    const r = unwrap(await apiFor(event).v1.users({ id: event.params.id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, raw);
    return { saved: true };
  },
  delete: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    }
    const r = unwrap(await apiFor(event).v1.users({ id: event.params.id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/users');
  },
};
