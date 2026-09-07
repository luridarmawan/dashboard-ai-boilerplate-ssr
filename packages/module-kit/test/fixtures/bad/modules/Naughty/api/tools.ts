export default [
  {
    name: 'other.thing',
    description: { id: 'x', en: 'x' },
    input: { type: 'object' },
    run: () => 0,
  },
  {
    name: 'naughty.ghost',
    description: { id: 'x', en: 'x' },
    permission: 'naughty.nothing.read',
    input: { type: 'object' },
    run: () => 0,
  },
  {
    name: 'naughty.bare',
    description: { id: 'x', en: 'x' },
    input: { type: 'string' },
    run: () => 0,
  },
];
