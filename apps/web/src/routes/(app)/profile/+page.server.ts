import { formToObject, PasswordChangeBody, ProfileBody, validateForm } from '@core/contracts';
import { themes } from '@core/ui-theme';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Own profile (D-4): basics + preferences, and a separate password form. */
export const load: PageServerLoad = async (event) => {
  const locale = event.locals.locale.locale;
  const allowed = event.locals.theme.allowed;
  return {
    themes: themes()
      .filter(
        (t) =>
          !t.module ||
          t.module === 'core' ||
          event.locals.config.enabledModules.has(t.module.toLowerCase()),
      )
      .filter((t) => !allowed || allowed.includes(t.id))
      .map((t) => ({ id: t.id, name: t.name[locale] })),
  };
};

const csrfFail = () =>
  actionFailure({
    status: 403,
    code: 'csrf_failed',
    message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
  });

export const actions: Actions = {
  profile: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const input = formToObject(form, { nullable: ['theme', 'avatarUrl'] });
    const v = validateForm(ProfileBody, input);
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
    const r = unwrap(await apiFor(event).v1.users.profile.me.put(v.value));
    if (!r.ok) return actionFailure(r.failure, input);
    return { saved: 'profile' as const };
  },
  password: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    if (str(form, 'newPassword') !== str(form, 'confirm')) {
      return actionFailure({
        status: 422,
        code: 'validation_failed',
        message: 'Periksa isian yang ditandai',
        details: { confirm: 'Konfirmasi kata sandi tidak sama' },
      });
    }
    const v = validateForm(PasswordChangeBody, formToObject(form));
    if (!v.ok)
      return actionFailure({
        status: 422,
        code: 'validation_failed',
        message: 'Periksa isian yang ditandai',
        details: v.errors,
      });
    const r = unwrap(await apiFor(event).v1.users.profile.password.put(v.value));
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'password' as const };
  },
};
