import { defineIconSets } from '@core/module-kit';

/** An icon set from a module (extension point 16): Lucide with round caps and a thicker stroke. */
export default defineIconSets('Dummy', [
  {
    id: 'dummy.rounded-24',
    name: { id: 'Bulat 24 (Dummy)', en: 'Rounded 24 (Dummy)' },
    style: 'stroke',
    strokeWidth: 2.25,
    grid: 24,
    source: 'lucide',
    license: 'ISC',
    glyphs: 'web/icons/rounded-24.ts',
  },
]);
