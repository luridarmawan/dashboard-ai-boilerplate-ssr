export default [
  { method: 'GET', path: '/feed', reason: 'GET is never checked anyway, so this is a mistake.' },
  { method: 'POST', path: '/hooks/*', reason: 'Wildcards would exempt routes added later.' },
  { method: 'POST', path: '/inbound', reason: 'short' },
  { method: 'POST', path: '/ghost', reason: 'Names a route the module does not serve.' },
];
