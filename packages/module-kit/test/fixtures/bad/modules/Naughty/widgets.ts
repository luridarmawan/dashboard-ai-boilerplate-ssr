// Bypasses defineWidgets on purpose: sync must still catch a missing component and a foreign id.
export default [
  {
    id: 'naughty.ghost',
    title: { id: 'Hantu', en: 'Ghost' },
    component: 'web/widgets/Missing.svelte',
  },
  {
    id: 'other.widget',
    title: { id: 'Lain', en: 'Other' },
    component: 'web/widgets/Missing.svelte',
  },
];
