import type { Translate } from '@core/i18n';
import type { FieldDef } from '@core/ui';
import { SLUG_MAX, SLUG_PATTERN } from '../../../api/schemas.ts';

/**
 * Field declarations for the page forms (FormBuilder), shared by new + edit. The slug is only
 * part of the CREATE form: on an existing page it has its own form (the permalink card), because
 * changing it is not an ordinary edit — it may leave a permanent redirect behind. The body is not
 * here either: it is the MarkdownEditor (../../lib), rendered in the form's `extra` slot.
 */
export function pageFields(t: Translate, opts: { slug: boolean }): FieldDef[] {
  return [
    {
      name: 'title',
      label: t('pages.field.title'),
      type: 'string',
      required: true,
      maxlength: 191,
    },
    ...(opts.slug ? [slugField(t)] : []),
    {
      name: 'status',
      label: t('pages.field.status'),
      type: 'select',
      options: [
        { value: 'draft', label: t('pages.status.draft') },
        { value: 'published', label: t('pages.status.published') },
      ],
    },
    {
      name: 'summary',
      label: t('pages.field.summary'),
      hint: t('pages.field.summary_hint'),
      type: 'text',
      rows: 2,
      maxlength: 512,
    },
  ];
}

export function slugField(t: Translate): FieldDef {
  return {
    name: 'slug',
    label: t('pages.field.slug'),
    hint: t('pages.field.slug_hint'),
    type: 'string',
    maxlength: SLUG_MAX,
    pattern: SLUG_PATTERN.slice(1, -1),
  };
}

/** The API's slug conflicts, as a field error in the reader's language (never the API's prose). */
export function slugError(t: Translate, details: unknown): Record<string, string> | null {
  const reason = (details as { reason?: unknown } | null)?.reason;
  if (reason === 'slug_taken' || reason === 'slug_redirected' || reason === 'slug_race')
    return { slug: t(`pages.err.${reason}`) };
  return null;
}
