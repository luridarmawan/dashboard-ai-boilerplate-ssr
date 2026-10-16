export default [
  { name: 'readings', topic: 'naughty/readings', handler: () => {} },
  { name: 'naughty.broken', topic: 'naughty/#/x', handler: () => {} },
  { name: 'naughty.shared', topic: '$share/g/naughty/x', handler: () => {} },
];
