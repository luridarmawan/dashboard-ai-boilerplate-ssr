import { env } from '@core/config';

/**
 * Stand-in for the outbox (M4, J-2): make a verification / reset link visible to the developer.
 * Never in production — there the event is logged without the link, and nothing is delivered
 * until the email transport lands.
 */
export function deliverLink(
  kind: 'verify-email' | 'reset-password' | 'set-password',
  email: string,
  token: string,
): void {
  const origin = env().APP_ORIGIN ?? 'http://127.0.0.1:5173';
  const path =
    kind === 'verify-email' ? `/auth/verify?token=${token}` : `/auth/reset?token=${token}`;
  const line = (extra: Record<string, unknown>) =>
    console.log(
      JSON.stringify({ t: new Date().toISOString(), level: 'warn', kind, to: email, ...extra }),
    );
  if (env().NODE_ENV === 'production') {
    line({ msg: 'email not delivered — outbox arrives in M4' });
    return;
  }
  line({ msg: 'DEV ONLY: email link', link: `${origin}${path}` });
}
