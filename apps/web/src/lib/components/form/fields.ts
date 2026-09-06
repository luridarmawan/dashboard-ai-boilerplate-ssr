/**
 * FormBuilder field declarations (PRD L-17). A form is data: the page declares fields, the
 * builder renders token-styled controls, and the SAME TypeBox schema the API uses validates the
 * post in the action (`validateForm` from @core/contracts). Every field type degrades to a
 * native control, so the form submits without JavaScript (L-22).
 */
import type { FullAutoFill } from 'svelte/elements';

export type FieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'file'
  | 'password'
  | 'markdown'
  | 'email'
  | 'hidden';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  name: string;
  type: FieldType;
  label?: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autocomplete?: FullAutoFill;
  min?: number | string;
  max?: number | string;
  step?: number;
  minlength?: number;
  maxlength?: number;
  pattern?: string;
  rows?: number;
  options?: FieldOption[];
  /** Render `multiselect` as a checkbox grid (default) or a multiple <select>. */
  multiselectAs?: 'checkboxes' | 'select';
  accept?: string;
  /** Column span in a 2-column layout (1 = half, 2 = full). Default: text/markdown 2, others 1. */
  span?: 1 | 2;
}

export type FormValues = Record<string, unknown>;
export type FormErrors = Record<string, string>;

export function field(def: FieldDef): FieldDef {
  return def;
}
