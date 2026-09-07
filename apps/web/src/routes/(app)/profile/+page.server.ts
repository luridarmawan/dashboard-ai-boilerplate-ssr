import { formToObject, PasswordChangeBody, ProfileBody, validateForm } from '@core/contracts';
import { themes } from '@core/ui-theme';
import { actionFailure, apiFor, checkCsrf, optStr, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Own profile (D-4): basics + preferences, a separate password form, and API tokens (A-4). */
export const load: PageServerLoad = async (event) => {
  const locale = event.locals.locale.locale;
  const allowed = event.locals.theme.allowed;
  const tokens = await apiFor(event).v1.tokens.get();
  return {
    tokens: tokens.data?.success ? tokens.data.data : [],
    appOrigin: event.url.origin,
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
  // ---- API tokens (A-4): minted for MCP clients and other non-browser callers ----
  createToken: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const name = str(form, 'name').trim();
    const days = Number(optStr(form, 'expiresInDays') ?? '0');
    const scopes = str(form, 'scopes')
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!name)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: 'Periksa isian yang ditandai',
          details: { name: 'Nama token wajib diisi' },
        },
        { name, scopes: scopes.join(' ') },
      );
    const r = unwrap<{
      success: true;
      data: { id: string; token: string; expiresAt: string | null };
    }>(
      await apiFor(event).v1.tokens.post({
        name,
        ...(days > 0 ? { expiresInDays: days } : {}),
        ...(scopes.length ? { scopes } : {}),
      }),
    );
    if (!r.ok) return actionFailure(r.failure, { name, scopes: scopes.join(' ') });
    return { saved: 'token' as const, token: r.data.data.token, tokenName: name };
  },
  revokeToken: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap(
      await apiFor(event)
        .v1.tokens({ id: str(form, 'id') })
        .delete(),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'revoke' as const };
  },
};
