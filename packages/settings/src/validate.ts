import type { ConfigFieldDef } from '@core/module-kit';
import { themeById } from '@core/ui-theme';
import { webRoutes } from './generated/routes.ts';

/**
 * Typed validation of a configuration value (E-3): a `route` must exist in the route registry
 * built by `modules:sync`/`layout:variants` (§4.7 rule 1), a `theme` must be registered, a
 * `select` must be one of its options, numbers respect bounds. Values are stored as strings;
 * `normalize` produces the canonical string, `parse` turns it back into a typed value.
 */
export type ConfigValue = string | number | boolean | string[] | null;

export interface ValidationOk {
  ok: true;
  stored: string | null;
}
export interface ValidationFail {
  ok: false;
  message: string;
}

const LOCALES = ['id', 'en'];

export function validateValue(
  field: ConfigFieldDef,
  input: unknown,
  ctx: { routes?: readonly string[] | undefined; locales?: readonly string[] | undefined } = {},
): ValidationOk | ValidationFail {
  const routes = ctx.routes ?? webRoutes;
  const locales = ctx.locales ?? LOCALES;
  const raw =
    input === undefined || input === null ? null : Array.isArray(input) ? input : String(input);
  const empty = raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);

  switch (field.type) {
    case 'boolean': {
      if (empty) return { ok: true, stored: null };
      const s = String(raw).toLowerCase();
      if (['true', '1', 'on', 'yes'].includes(s)) return { ok: true, stored: 'true' };
      if (['false', '0', 'off', 'no'].includes(s)) return { ok: true, stored: 'false' };
      return { ok: false, message: 'harus true/false' };
    }
    case 'number': {
      if (empty) return { ok: true, stored: null };
      const n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false, message: 'harus angka' };
      if (field.min !== undefined && n < field.min)
        return { ok: false, message: `minimal ${field.min}` };
      if (field.max !== undefined && n > field.max)
        return { ok: false, message: `maksimal ${field.max}` };
      return { ok: true, stored: String(n) };
    }
    case 'select': {
      if (empty) return { ok: true, stored: null };
      const s = String(raw);
      if (!field.options?.some((o) => o.value === s))
        return { ok: false, message: 'pilihan tidak dikenal' };
      return { ok: true, stored: s };
    }
    case 'list': {
      const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[,\n]/))
        .map((v) => String(v).trim())
        .filter(Boolean);
      // An `options`-less list (e.g. allowed themes) is validated by the caller's own registry.
      if (field.options?.length) {
        const bad = list.filter((v) => !field.options?.some((o) => o.value === v));
        if (bad.length) return { ok: false, message: `nilai tidak dikenal: ${bad.join(', ')}` };
      }
      return { ok: true, stored: list.length ? JSON.stringify(list) : null };
    }
    case 'route': {
      if (empty) return { ok: true, stored: null };
      const s = String(raw);
      if (!s.startsWith('/') || s.startsWith('//'))
        return { ok: false, message: 'harus path yang diawali /' };
      if (!routes.includes(s))
        return { ok: false, message: `route ${s} tidak ada di registry route (§4.7)` };
      return { ok: true, stored: s };
    }
    case 'theme': {
      if (empty) return { ok: true, stored: null };
      const s = String(raw);
      if (!themeById(s)) return { ok: false, message: `tema "${s}" tidak terdaftar` };
      return { ok: true, stored: s };
    }
    case 'locale': {
      if (empty) return { ok: true, stored: null };
      const s = String(raw);
      if (!locales.includes(s)) return { ok: false, message: `bahasa "${s}" tidak tersedia` };
      return { ok: true, stored: s };
    }
    default: {
      // string, text, markdown, secret
      if (empty) return { ok: true, stored: null };
      const s = String(raw);
      if (field.max !== undefined && s.length > field.max)
        return { ok: false, message: `maksimal ${field.max} karakter` };
      if (field.min !== undefined && s.length < field.min)
        return { ok: false, message: `minimal ${field.min} karakter` };
      return { ok: true, stored: s };
    }
  }
}

/** Stored string → typed value, or the field default when nothing is stored. */
export function parseValue(field: ConfigFieldDef, stored: string | null | undefined): ConfigValue {
  if (stored === null || stored === undefined) {
    const d = field.default;
    return d === undefined ? null : Array.isArray(d) ? [...d] : (d as ConfigValue);
  }
  switch (field.type) {
    case 'boolean':
      return stored === 'true';
    case 'number':
      return Number(stored);
    case 'list':
      try {
        const v = JSON.parse(stored);
        return Array.isArray(v) ? v.map(String) : [];
      } catch {
        return stored
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    default:
      return stored;
  }
}
