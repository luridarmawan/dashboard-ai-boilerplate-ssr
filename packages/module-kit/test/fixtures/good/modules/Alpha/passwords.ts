// Shape of definePasswordVerifiers() output, without importing module-kit from a fixture.
export default [
  {
    name: 'alpha.legacy',
    matches: (hash: string) => hash.startsWith('$alpha$'),
    verify: (plain: string, hash: string) => hash === `$alpha$${plain}`,
  },
];
