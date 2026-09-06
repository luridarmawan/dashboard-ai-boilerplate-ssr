// Duck-typed stand-in for an Elysia instance (fixtures must not depend on elysia).
export default { routes: [{ path: '/items' }], handle: () => new Response('ok') };
