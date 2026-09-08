import { formToObject, PasswordChangeBody, ProfileBody, validateForm } from '@core/contracts';
import { createTranslator, type Locale } from '@core/i18n';
import { themes } from '@core/ui-theme';
import QRCode from 'qrcode';
import { actionFailure, apiFor, checkCsrf, optStr, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Own profile (D-4): basics + preferences, a separate password form, and API tokens (A-4). */
export const load: PageServerLoad = async (event) => {
  const locale = event.locals.locale.locale;
  const allowed = event.locals.theme.allowed;
  const api = apiFor(event);
  const [tokens, mfaRes] = await Promise.all([api.v1.tokens.get(), api.v1.users.profile.mfa.get()]);
  const mfa = mfaRes.data?.success
    ? mfaRes.data.data
    : { enabled: false, pending: false, recoveryCodesLeft: 0, secret: null, otpauthUrl: null };
  // The QR is rendered server-side as SVG while setup is pending: no script, no third-party image.
  const qr = mfa.otpauthUrl
    ? await QRCode.toString(mfa.otpauthUrl, { type: 'svg', margin: 1, width: 200 })
    : null;
  return {
    tokens: tokens.data?.success ? tokens.data.data : [],
    mfa: { ...mfa, qr },
    appOrigin: event.url.origin,
    themes: [...themes(), ...event.locals.config.customThemes.map((c) => c.manifest)]
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

const csrfFail = (locale: Locale) =>
  actionFailure({
    status: 403,
    code: 'csrf_failed',
    message: createTranslator(locale)('common.form_expired'),
  });

export const actions: Actions = {
  profile: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const input = formToObject(form, { nullable: ['theme', 'avatarUrl'] });
    const v = validateForm(ProfileBody, input);
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: t('common.check_fields'),
          details: v.errors,
        },
        input,
      );
    const r = unwrap(await apiFor(event).v1.users.profile.me.put(v.value));
    if (!r.ok) return actionFailure(r.failure, input);
    return { saved: 'profile' as const };
  },
  /** Avatar upload (Q-16): multipart `avatar` → PUT /v1/users/profile/avatar; the session user refreshes on next load. */
  avatar: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const file = form.get('avatar');
    if (!(file instanceof File) || file.size === 0)
      return actionFailure({
        status: 422,
        code: 'validation_failed',
        message: t('profile.avatar.pick_file'),
        details: { avatar: t('profile.avatar.pick_file') },
      });
    const r = unwrap(await apiFor(event).v1.users.profile.avatar.put({ file }));
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'avatar' as const };
  },
  avatarRemove: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap(await apiFor(event).v1.users.profile.avatar.delete());
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'avatar' as const };
  },
  password: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    if (str(form, 'newPassword') !== str(form, 'confirm')) {
      return actionFailure({
        status: 422,
        code: 'validation_failed',
        message: t('common.check_fields'),
        details: { confirm: t('profile.password.mismatch') },
      });
    }
    const v = validateForm(PasswordChangeBody, formToObject(form));
    if (!v.ok)
      return actionFailure({
        status: 422,
        code: 'validation_failed',
        message: t('common.check_fields'),
        details: v.errors,
      });
    const r = unwrap(await apiFor(event).v1.users.profile.password.put(v.value));
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'password' as const };
  },
  // ---- 2FA TOTP (A-11) ----
  mfaSetup: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap(await apiFor(event).v1.users.profile.mfa.setup.post());
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'mfaSetup' as const }; // the reloaded page shows the pending QR
  },
  mfaEnable: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap<{ success: true; data: { recoveryCodes: string[] } }>(
      await apiFor(event).v1.users.profile.mfa.enable.post({ code: str(form, 'code') }),
    );
    if (!r.ok) return actionFailure(r.failure, {}, { mfaStage: 'enable' as const });
    return { saved: 'mfaEnabled' as const, recoveryCodes: r.data.data.recoveryCodes };
  },
  mfaCodes: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap<{ success: true; data: { recoveryCodes: string[] } }>(
      await apiFor(event).v1.users.profile.mfa['recovery-codes'].post({ code: str(form, 'code') }),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'mfaCodes' as const, recoveryCodes: r.data.data.recoveryCodes };
  },
  mfaDisable: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap(
      await apiFor(event).v1.users.profile.mfa.disable.post({ password: str(form, 'password') }),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'mfaDisabled' as const };
  },
  // ---- API tokens (A-4): minted for MCP clients and other non-browser callers ----
  createToken: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
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
          message: t('common.check_fields'),
          details: { name: t('profile.tokens.name_required') },
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
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap(
      await apiFor(event)
        .v1.tokens({ id: str(form, 'id') })
        .delete(),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { saved: 'revoke' as const };
  },
};
