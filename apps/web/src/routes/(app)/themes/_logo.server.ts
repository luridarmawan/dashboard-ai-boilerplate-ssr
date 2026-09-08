import type { RequestEvent } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';
import type { EditorValues } from './_editor.ts';

/**
 * Logo upload for the theme editor (L-24 + Q-16): when the form carries a non-empty `logo` file,
 * store it as a PUBLIC file of kind `theme-logo` through the API and put its id into the values.
 * Returns an error message when the API refuses (type, size); the theme is then not saved.
 */
export async function attachLogo(
  event: RequestEvent,
  form: FormData,
  values: EditorValues,
): Promise<string | null> {
  const logo = form.get('logo');
  if (!(logo instanceof File) || logo.size === 0) return null;
  const r = await apiFor(event).v1.files.post({
    file: logo,
    kind: 'theme-logo',
    visibility: 'public',
  });
  if (!r.data?.success) {
    const err = (r.error as { value?: { error?: { message?: string } } } | null)?.value?.error
      ?.message;
    return err ?? 'Logo tidak bisa diunggah';
  }
  values.logoId = r.data.data.id;
  values.logoUrl = r.data.data.url;
  return null;
}
