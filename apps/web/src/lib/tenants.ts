import type { MessageKey } from '@core/i18n';
import type { FieldDef, FieldOption } from '$lib/components/form';

type Translate = (key: MessageKey) => string;

/**
 * The tenant's identity group, shared by the create and the edit form so both lay it out the
 * same way. `slug` is only on the create form: once made, the code cannot change.
 */
export function identityFields(t: Translate, parents: FieldOption[], slug?: FieldDef): FieldDef[] {
  const group = t('tenants.group_identity');
  const fields: FieldDef[] = [
    { name: 'name', type: 'string', label: t('tenants.name'), required: true, maxlength: 191 },
    ...(slug ? [slug] : []),
    {
      name: 'parentId',
      type: 'select',
      label: t('tenants.parent'),
      hint: t('tenants.parent_hint'),
      options: parents,
    },
    {
      // Lower case is accepted on the way in; `shortCodeValue` upper-cases it before validation.
      name: 'shortCode',
      type: 'string',
      label: t('tenants.short_code'),
      hint: t('tenants.short_code_hint'),
      maxlength: 3,
      pattern: '[A-Za-z]{1,3}',
      placeholder: 'JKT',
      autocomplete: 'off',
    },
    {
      name: 'referenceId',
      type: 'string',
      label: t('tenants.reference_id'),
      hint: t('tenants.reference_id_hint'),
      maxlength: 191,
      autocomplete: 'off',
    },
    { name: 'joinDate', type: 'date', label: t('tenants.join_date') },
    {
      name: 'description',
      type: 'text',
      label: t('tenants.description'),
      maxlength: 2000,
      span: 2,
    },
  ];
  return fields.map((f) => ({ ...f, group }));
}

/** The short code is stored upper case; typing `jkt` is not worth a validation error. */
export function shortCodeValue(v: unknown): unknown {
  return typeof v === 'string' ? v.trim().toUpperCase() || null : v;
}
