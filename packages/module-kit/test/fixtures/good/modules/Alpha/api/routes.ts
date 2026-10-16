// Duck-typed stand-in for an Elysia instance (fixtures must not depend on elysia).
export default {
  routes: [
    { method: 'GET', path: '/items' },
    { method: 'POST', path: '/hooks/:provider' },
  ],
  handle: () => new Response('ok'),
};
