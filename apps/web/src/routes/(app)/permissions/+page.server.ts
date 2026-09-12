import { error } from '@sveltejs/kit';
import { hasPermission } from '$lib/permissions';
import { apiFor, unwrap } from '$lib/server/session';
import type { PageServerLoad } from './$types';

/**
 * Permission guide (PRD C-8): what `resource.action`, `manage` and the wildcards actually mean,
 * next to the registry of everything that exists in THIS installation — core plus whatever the
 * enabled modules contributed (C-4), so the examples are never hypothetical.
 *
 * The checker is a plain GET form: the answer is computed here, from the URL, which is why it
 * works without JavaScript and why the result is linkable. The rule itself is the one the whole
 * UI uses (`$lib/permissions`, the documented mirror of `@core/auth`; the API stays the
 * authority — C-6b), and `permissions.test.ts` pins the two implementations to each other.
 */
export const _layoutVariant = 'wide';

interface RegistryResource {
  module: string;
  resource: string;
  actions: string[];
  name: { id: string; en: string };
}

/** What a single grant does to a single requirement — the two questions an admin actually has. */
function explain(granted: string, required: string) {
  const grants = granted
    .split(/[\s,]+/)
    .map((g) => g.trim())
    .filter(Boolean);
  if (!grants.length || !required.trim()) return null;
  const dot = required.lastIndexOf('.');
  const concrete = dot > 0 && !required.includes('*');
  return {
    grants,
    required: required.trim(),
    /** A requirement is always concrete: `user.*` is something you GRANT, never something a route asks for. */
    concrete,
    allowed: concrete ? hasPermission(grants, required.trim()) : false,
    matched: concrete ? grants.filter((g) => hasPermission([g], required.trim())) : [],
  };
}

export const load: PageServerLoad = async (event) => {
  const res = await apiFor(event).v1.auth['permission-registry'].get();
  const r = unwrap<{ success: true; data: { resources: RegistryResource[] } }>(res);
  if (!r.ok) error(r.failure.status, r.failure.message);
  const resources = res.data?.success ? res.data.data.resources : [];
  const granted = event.url.searchParams.get('granted') ?? '';
  const required = event.url.searchParams.get('required') ?? '';
  return {
    resources,
    /** Every concrete string that exists, for the datalist on the checker. */
    all: resources.flatMap((x) => x.actions.map((a) => `${x.resource}.${a}`)).sort(),
    check: { granted, required, result: explain(granted, required) },
  };
};
