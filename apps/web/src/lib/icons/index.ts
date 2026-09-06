import { ICON_SETS, type IconSetDef } from '@core/ui-theme';
import type { Component } from 'svelte';
import { glyphs as bold } from './bold-24.ts';
import { glyphs as outline } from './outline-24.ts';
import { glyphs as solid } from './solid-24.ts';

/**
 * Registered icon sets available to `<Icon>` (L-5). Sets contributed by modules (extension
 * point 16) are appended by `modules:sync` into the generated registry; this file lists the
 * built-ins. L-15 (ship only the sets that enabled themes reference) lands with the
 * `themes.enabled` allowlist — until then all three built-ins are bundled.
 */
export type Glyphs = Record<string, Component<Record<string, unknown>>>;

export const iconSets: Record<string, { meta: IconSetDef; glyphs: Glyphs }> = {
  'outline-24': { meta: ICON_SETS['outline-24'] as IconSetDef, glyphs: outline },
  'solid-24': { meta: ICON_SETS['solid-24'] as IconSetDef, glyphs: solid },
  'bold-24': { meta: ICON_SETS['bold-24'] as IconSetDef, glyphs: bold },
};

export const DEFAULT_ICON_SET = 'outline-24';
