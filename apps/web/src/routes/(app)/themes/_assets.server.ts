import type { RequestEvent } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';
import type { EditorValues } from './_editor.ts';

/**
 * Brand asset uploads for the theme editor (L-24 + Q-16): when the form carries a non-empty `logo`
 * or `favicon` file, store it as a PUBLIC file of kind `theme-logo` / `theme-favicon` through the
 * API and put its id (and URL) into the values. Returns field errors when the API refuses (type,
 * size); the theme is then not saved.
 */
export async function attachAssets(
  event: RequestEvent,
  form: FormData,
  values: EditorValues,
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const field of ['logo', 'favicon'] as const) {
    const file = form.get(field);
    if (!(file instanceof File) || file.size === 0) continue;
    const r = await apiFor(event).v1.files.post({
      file,
      kind: `theme-${field}`,
      visibility: 'public',
    });
    if (!r.data?.success) {
      const err = (r.error as { value?: { error?: { message?: string } } } | null)?.value?.error
        ?.message;
      errors[field] =
        err ?? (field === 'logo' ? 'Logo tidak bisa diunggah' : 'Favicon tidak bisa diunggah');
      continue;
    }
    if (field === 'logo') {
      values.logoId = r.data.data.id;
      values.logoUrl = r.data.data.url;
    } else {
      values.faviconId = r.data.data.id;
      values.faviconUrl = r.data.data.url;
    }
  }
  return errors;
}
