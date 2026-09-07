export default [
  {
    name: 'alpha.count_items',
    description: { id: 'Hitung item', en: 'Count items' },
    permission: 'alpha.item.read',
    input: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    run: () => 0,
  },
];
