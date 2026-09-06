import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Installed modules and their state for the active tenant (G-8). */
export const load: PageServerLoad = async (event) => {
  const res = await apiFor(event).v1.module.get();
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403 ? 'Anda tidak punya izin melihat modul' : 'Modul tidak bisa dimuat',
    );
  return { modules: res.data.data, canGlobal: !!event.locals.session?.user.isSuperadmin };
};

export const actions: Actions = {
  toggle: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    const state = str(form, 'state'); // on | off | inherit
    const scope = str(form, 'scope') === 'global' ? 'global' : 'tenant';
    const r = unwrap(
      await apiFor(event)
        .v1.module({ id: str(form, 'module') })
        .enabled.put({
          enabled: state === 'inherit' ? null : state === 'on',
          ...(scope === 'global' ? { scope: 'global' as const } : {}),
        }),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/modules');
  },
};
