import { env } from '@core/config';
import { app } from './app.ts';

// Fail fast on a bad environment before the port is even opened (P-4).
const e = env();

app.listen({ port: e.API_PORT, hostname: '127.0.0.1' });

console.log(
  JSON.stringify({
    t: new Date().toISOString(),
    level: 'info',
    msg: 'api listening',
    url: `http://127.0.0.1:${e.API_PORT}`,
    docs: `http://127.0.0.1:${e.API_PORT}/docs`,
    dialect: e.DB_DIALECT,
  }),
);
