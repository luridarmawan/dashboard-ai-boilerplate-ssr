import {
  AdminPasswordSetBody,
  formToObject,
  isUndeliverableEmail,
  UserUpdateBody,
  validateForm,
} from '@core/contracts';
import { createTranslator } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { allGroups } from '$lib/server/groups';
import {
  actionFailure,
  apiFor,
  checkCsrf,
  confirmed,
  confirmFail,
  forwardSetCookies,
  str,
  unwrap,
} from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const client = apiFor(event);
  const [user, groups, tenants] = await Promise.all([
    client.v1.users({ id: event.params.id }).get(),
    allGroups(event),
    client.v1.users({ id: event.params.id }).tenants.get(),
  ]);
  if (!user.data?.success)
    error(user.status === 404 ? 404 : user.status, t('users.detail.not_found'));
  // `user` here is the VIEWED user (it shadows the layout's session user); the viewer comes apart.
  const me = event.locals.session?.user;
  return {
    user: user.data.data,
    viewer: { id: me?.id ?? '', isSuperadmin: me?.isSuperadmin ?? false },
    groups: groups.ok ? groups.rows : [],
    /** Tenant access (B-2/B-4): what this user may open, as far as the viewer may see it. */
    tenants: tenants.data?.success
      ? tenants.data.data
      : { memberships: [], hidden: 0, candidates: [] },
    created: event.url.searchParams.has('created'),
    /**
     * Removing a user is destructive (the account itself is soft-deleted with its last tenant), so
     * it takes two steps: `?confirm=delete` opens the confirmation — a plain link, no JavaScript
     * needed (L-22) — and the action below still refuses a POST whose typed e-mail does not match.
     * `&tenant=<id>` is the same confirmation for revoking ONE tenant's access; the two never answer
     * for each other.
     */
    confirmDelete: confirmed(event) && !event.url.searchParams.has('tenant'),
    confirmTenantId: confirmed(event) ? event.url.searchParams.get('tenant') : null,
    /**
     * `.test` / `.invalid` addresses never receive mail (RFC 2606), so the reset-link button is not
     * offered for them; the API refuses the same addresses, this only spares the click.
     */
    resetLinkDeliverable: !isUndeliverableEmail(user.data.data.email),
  };
};

export const actions: Actions = {
  /** Impersonate (D-6): superadmin only; the API sets a second cookie, the dashboard shows a banner. */
  impersonate: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: t('common.form_expired'),
      });
    const res = await apiFor(event).v1.users({ id: event.params.id }).impersonate.post();
    const r = unwrap(res);
    if (!r.ok) return actionFailure(r.failure);
    forwardSetCookies(event, res.response);
    redirect(303, '/dashboard');
  },
  save: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: t('common.form_expired'),
      });
    }
    // Checkbox semantics → schema shape: `active` on/off becomes statusId 1/0.
    const raw = formToObject(form, { arrays: ['groupIds'], nullable: ['phone'] });
    const input: Record<string, unknown> = {
      name: raw.name,
      phone: raw.phone,
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
          message: t('common.check_fields'),
          details: v.errors,
        },
        raw,
      );
    const r = unwrap(await apiFor(event).v1.users({ id: event.params.id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, raw);
    return { saved: true };
  },
  /**
   * Set this user's password (D-1): the admin types it twice, the API applies the same strength
   * rule as everywhere else and ends every session of the target. Failures carry `scope` so the
   * profile form above does not mistake them for its own.
   */
  password: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        {},
        { scope: 'password' },
      );
    if (str(form, 'newPassword') !== str(form, 'confirm'))
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: t('common.check_fields'),
          details: { confirm: t('profile.password.mismatch') },
        },
        {},
        { scope: 'password' },
      );
    const v = validateForm(AdminPasswordSetBody, { newPassword: str(form, 'newPassword') });
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: t('common.check_fields'),
          details: v.errors,
        },
        {},
        { scope: 'password' },
      );
    const r = unwrap(await apiFor(event).v1.users({ id: event.params.id }).password.put(v.value));
    if (!r.ok) {
      // The API lists the strength problems in its own words; the field shows the i18n rule instead.
      if (r.failure.code === 'weak_password')
        return actionFailure(
          {
            status: 422,
            code: 'weak_password',
            message: t('common.check_fields'),
            details: { newPassword: t('users.detail.password.weak') },
          },
          {},
          { scope: 'password' },
        );
      return actionFailure(r.failure, {}, { scope: 'password' });
    }
    return { passwordChanged: true };
  },
  /** E-mail this user a (re)set-password link (A-7) on their behalf. */
  resetLink: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        {},
        { scope: 'resetLink' },
      );
    const r = unwrap(
      await apiFor(event).v1.users({ id: event.params.id }).password['reset-link'].post(),
    );
    if (!r.ok) {
      const reason = (r.failure.details as { reason?: string } | undefined)?.reason;
      if (reason === 'email_undeliverable')
        return actionFailure(
          {
            status: 422,
            code: 'validation_failed',
            message: t('users.detail.password.link_undeliverable'),
            details: r.failure.details,
          },
          {},
          { scope: 'resetLink' },
        );
      return actionFailure(r.failure, {}, { scope: 'resetLink' });
    }
    return { linkSent: true };
  },
  /** Give this user access to one more tenant (B-2): the API checks `user.create` THERE. */
  addTenant: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        {},
        { scope: 'tenants' },
      );
    const r = unwrap<{ success: true; data: { tenant: { name: string } } }>(
      await apiFor(event)
        .v1.users({ id: event.params.id })
        .tenants.post({ clientId: str(form, 'clientId') }),
    );
    if (!r.ok) return actionFailure(r.failure, {}, { scope: 'tenants' });
    return { tenantAdded: r.data.data.tenant.name };
  },
  /**
   * Revoke this user's access to one tenant. Confirmed like the removal below (L-22) — it is the
   * same step, aimed at a tenant other than the active one — and enforced here, not only in the
   * markup. Revoking the ACTIVE tenant makes this page a 404, so that case leaves for the list.
   */
  removeTenant: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        {},
        { scope: 'tenants' },
      );
    if (!confirmed(event)) return confirmFail(event.locals.locale.locale);
    const clientId = str(form, 'clientId');
    const tenantName = str(form, 'tenantName');
    const r = unwrap(
      await apiFor(event).v1.users({ id: event.params.id }).tenants({ clientId }).delete(),
    );
    if (!r.ok) return actionFailure(r.failure, {}, { scope: 'tenants' });
    if (clientId === event.locals.session?.clientId) redirect(303, '/users');
    return { tenantRemoved: tenantName };
  },
  delete: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: t('common.form_expired'),
      });
    }
    // The confirmation is enforced HERE, not only in the markup: the caller must type the user's own
    // e-mail, read back from the API rather than from a hidden field a client could edit.
    const current = await apiFor(event).v1.users({ id: event.params.id }).get();
    if (!current.data?.success)
      error(current.status === 404 ? 404 : current.status, t('users.detail.not_found'));
    if (str(form, 'email').trim().toLowerCase() !== current.data.data.email.toLowerCase())
      return actionFailure({
        status: 422,
        code: 'confirm_failed',
        message: t('users.detail.delete_confirm_mismatch'),
      });
    const r = unwrap(await apiFor(event).v1.users({ id: event.params.id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/users');
  },
};
