import { ICON_SETS, type IconSetDef } from '@core/ui-theme';
import type { Component } from 'svelte';
import { moduleIconGlyphs } from '$lib/../generated/icon-sets';
import { glyphs as bold } from './bold-24.ts';
import { glyphs as outline } from './outline-24.ts';
import { glyphs as solid } from './solid-24.ts';

/**
 * Registered icon sets available to `<Icon>` (L-5): the three built-ins plus sets contributed by
 * modules (extension point 16), whose glyph maps `modules:sync` verified cover every core name.
 * L-15 (ship only the sets that enabled themes reference) lands with the `themes.enabled`
 * allowlist — until then every registered set is bundled.
 */
export type Glyphs = Record<string, Component<Record<string, unknown>>>;

const builtIn: Record<string, Glyphs> = {
  'outline-24': outline,
  'solid-24': solid,
  'bold-24': bold,
};

export const iconSets: Record<string, { meta: IconSetDef; glyphs: Glyphs }> = Object.fromEntries(
  Object.entries({ ...builtIn, ...(moduleIconGlyphs as Record<string, Glyphs>) })
    .filter(([id]) => ICON_SETS[id])
    .map(([id, glyphs]) => [id, { meta: ICON_SETS[id] as IconSetDef, glyphs }]),
);

export const DEFAULT_ICON_SET = 'outline-24';
