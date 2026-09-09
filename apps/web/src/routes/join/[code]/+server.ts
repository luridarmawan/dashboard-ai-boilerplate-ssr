import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** The short public link from the invitation e-mail (A-13): `/join/<code>` → the auth-shell page. */
export const GET: RequestHandler = ({ params }) => {
  redirect(303, `/auth/join/${encodeURIComponent(params.code)}`);
};
