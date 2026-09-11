/**
 * Theme generator plan (PRD P-11). Pure functions: what a new theme's files look like, and the two
 * core edits a CORE theme needs (the registry import and the stylesheet import). Kept apart from
 * the CLI so the fiddly half — id rewriting and idempotent edits — is unit-tested without touching
 * the filesystem, exactly like modgen's `spec.ts`.
 *
 * A theme is data, not code (§4.8): tokens + a manifest naming a registered icon set and
 * registered layouts. The generator therefore derives everything from an existing theme instead of
 * inventing colours — copying a palette that already passes WCAG AA (L-21) is a better starting
 * point than a blank file the author must make accessible from scratch.
 */

export type ShellKind = 'dashboard' | 'public' | 'auth';

export interface ThemeSpec {
  /** Folder name, and the id itself for a core theme: `sunset`. */
  readonly id: string;
  /** Module that owns it, or null for a core theme. */
  readonly module: string | null;
  /** The id as themes address each other: `sunset`, or `billing.sunset` for a module theme. */
  readonly fullId: string;
  /** Theme this one is derived from (a core theme folder). */
  readonly from: string;
  readonly name: { readonly id: string; readonly en: string };
  readonly description: { readonly id: string; readonly en: string };
  readonly icons: string;
  readonly layouts: Readonly<Record<ShellKind, Readonly<Record<string, string>>>>;
}

export const THEME_ID = /^[a-z][a-z0-9-]{1,30}$/;
export const MODULE_NAME = /^[A-Z][A-Za-z0-9]*$/;

export interface ThemeInput {
  readonly id: string;
  readonly module?: string | null;
  readonly from?: string;
  readonly name?: string;
  readonly nameEn?: string;
  readonly description?: string;
  readonly descriptionEn?: string;
  readonly icons?: string;
  readonly layouts?: Partial<Record<ShellKind, Record<string, string>>>;
}

/** Title-case a kebab id for a default display name: `mid-night` → `Mid night`. */
export function titleOf(id: string): string {
  return id.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
/** Variable name for the registry import: `mid-night` → `midNightTheme`. */
export function varOf(id: string): string {
  return `${id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())}Theme`;
}

export function makeSpec(input: ThemeInput, sourceLayouts: ThemeSpec['layouts']): ThemeSpec {
  const id = input.id.trim();
  if (!THEME_ID.test(id))
    throw new Error(`id tema "${id}" tidak valid — huruf kecil, angka dan "-", 2–31 karakter`);
  const module = input.module?.trim() || null;
  if (module && !MODULE_NAME.test(module))
    throw new Error(`nama modul "${module}" tidak valid — PascalCase`);
  const from = (input.from ?? 'base').trim();
  if (!THEME_ID.test(from)) throw new Error(`tema sumber "${from}" tidak valid`);
  if (from === id && !module) throw new Error(`tema "${id}" tidak bisa diturunkan dari dirinya`);
  const name = input.name?.trim() || titleOf(id);
  const layouts = {
    dashboard: { ...sourceLayouts.dashboard, ...(input.layouts?.dashboard ?? {}) },
    public: { ...sourceLayouts.public, ...(input.layouts?.public ?? {}) },
    auth: { ...sourceLayouts.auth, ...(input.layouts?.auth ?? {}) },
  };
  return {
    id,
    module,
    fullId: module ? `${module.toLowerCase()}.${id}` : id,
    from,
    name: { id: name, en: input.nameEn?.trim() || name },
    description: {
      id: input.description?.trim() || `Tema ${name}, diturunkan dari ${from}.`,
      en: input.descriptionEn?.trim() || `The ${name} theme, derived from ${from}.`,
    },
    icons: input.icons?.trim() || 'outline-24',
    layouts,
  };
}

/**
 * The derived tokens file: same palette, addressed by the new id. Every `[data-app-theme="<from>"]`
 * becomes `[data-app-theme="<fullId>"]` — light block, dark block and any future selector alike —
 * so nothing silently keeps styling the theme it was copied from.
 */
export function renderTokens(sourceCss: string, spec: ThemeSpec): string {
  const selector = `[data-app-theme="${spec.from}"]`;
  if (!sourceCss.includes(selector))
    throw new Error(`tokens.css tema "${spec.from}" tidak memuat ${selector}`);
  const body = sourceCss
    .split(selector)
    .join(`[data-app-theme="${spec.fullId}"]`)
    // Drop the source theme's own header comment; ours replaces it.
    .replace(/^\/\*[\s\S]*?\*\/\n*/, '');
  return `/* Tema: ${spec.fullId} — dihasilkan \`bun themegen\`, diturunkan dari ${spec.from}.
 *
 * Nilai di sini adalah SATU-SATUNYA tempat warna ditulis; komponen memakai token, bukan warna
 * literal (L-2). Setiap perubahan harus tetap lolos \`bun run theme:validate\` — kontras WCAG AA
 * di kedua mode, termasuk --input dan --ring yang wajib >= 3:1 (L-21).
 */

${body.trimStart()}`;
}

/** The manifest. No `assets`/`preview`: a fresh theme has no logo or screenshot yet. */
export function renderManifest(spec: ThemeSpec): string {
  return `${JSON.stringify(
    {
      id: spec.fullId,
      name: { id: spec.name.id, en: spec.name.en },
      description: { id: spec.description.id, en: spec.description.en },
      tokens: './tokens.css',
      icons: spec.icons,
      layouts: spec.layouts,
    },
    null,
    2,
  )}\n`;
}

/**
 * Register a CORE theme in `packages/ui-theme/src/registry.ts`: the JSON import, and the list the
 * registry builds from. Idempotent — running the generator twice changes nothing the second time.
 * (Module themes need neither: `modules:sync` collects them, extension point 14.)
 */
export function addRegistryImport(source: string, spec: ThemeSpec): string {
  const variable = varOf(spec.id);
  const line = `import ${variable} from '../themes/${spec.id}/theme.json';`;
  let out = source;
  if (!out.includes(line)) {
    const imports = [
      ...out.matchAll(/^import \w+ from '\.\.\/themes\/([a-z0-9-]+)\/theme\.json';$/gm),
    ];
    const first = imports[0];
    if (first?.index === undefined)
      throw new Error('registry.ts: tidak menemukan blok import tema');
    // Biome sorts imports by path and `bun run lint` is a gate, so put it where it already belongs.
    const prev = imports.filter((m) => (m[1] ?? '') < spec.id).at(-1);
    out =
      prev?.index === undefined
        ? `${out.slice(0, first.index)}${line}\n${out.slice(first.index)}`
        : `${out.slice(0, prev.index + prev[0].length)}\n${line}${out.slice(prev.index + prev[0].length)}`;
  }
  const list = /\.\.\.\[([^\]]*)\]\.map/.exec(out);
  if (!list?.[1]) throw new Error('registry.ts: tidak menemukan daftar tema bawaan');
  if (!new RegExp(`\\b${variable}\\b`).test(list[1])) {
    const replaced = `...[${list[1].trimEnd()}, ${variable}].map`;
    out = out.replace(list[0], replaced);
  }
  return out;
}

/** Register a CORE theme's tokens in `apps/web/src/app.css` (Tailwind reads them from the bundle). */
export function addAppCssImport(source: string, spec: ThemeSpec): string {
  const line = `@import "@core/ui-theme/themes/${spec.id}/tokens.css";`;
  if (source.includes(line)) return source;
  const imports = [
    ...source.matchAll(/^@import "@core\/ui-theme\/themes\/[a-z0-9-]+\/tokens\.css";$/gm),
  ];
  const last = imports.at(-1);
  if (last?.index === undefined)
    throw new Error('app.css: tidak menemukan blok import tokens tema');
  const at = last.index + last[0].length;
  return `${source.slice(0, at)}\n${line}${source.slice(at)}`;
}
