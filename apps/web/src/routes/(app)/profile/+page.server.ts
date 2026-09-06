import { themes } from '@core/ui-theme';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Own profile (D-4): basics + preferences, and a separate password form. */
export const load: PageServerLoad = async (event) => {
  const locale = event.locals.session?.user.locale === 'en' ? 'en' : 'id';
  const allowed = event.locals.theme.allowed;
  return {
    themes: themes()
      .filter((t) => !allowed || allowed.includes(t.id))
      .map((t) => ({ id: t.id, name: t.name[locale] })),
  };
};
export const actions: Actions = {
  profile: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    }
    const r = unwrap(
      await apiFor(event).v1.users.profile.me.put({
        name: str(form, 'name'),
        locale: str(form, 'locale') || 'id',
        theme: str(form, 'theme') || null,
        avatarUrl: str(form, 'avatarUrl') || null,
      }),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'profile' as const };
  },
  password: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    }
    if (str(form, 'newPassword') !== str(form, 'confirm')) {
      return actionFailure({
        status: 422,
        code: 'validation_failed',
        message: 'Konfirmasi kata sandi tidak sama',
      });
    }
    const r = unwrap(
      await apiFor(event).v1.users.profile.password.put({
        currentPassword: str(form, 'currentPassword'),
        newPassword: str(form, 'newPassword'),
      }),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'password' as const };
  },
};
