import type { Translate } from '@core/i18n';
import type { FieldDef } from '@core/ui';

/**
 * Field declarations for the note form (FormBuilder, L-17); shared by new + edit. It takes
 * the translator rather than exporting a constant, so every label comes from the catalogue and
 * follows the reader's language — a literal here would be the one string the picker cannot change.
 */
export function noteFields(t: Translate): FieldDef[] {
  return [
    {
      name: 'title',
      label: t('hello.note.field.title'),
      type: 'string',
      required: true,
      maxlength: 191,
    },
    { name: 'body', label: t('hello.note.field.body'), type: 'text', rows: 3 },
    { name: 'pinned', label: t('hello.note.field.pinned'), type: 'boolean' },
  ];
}
