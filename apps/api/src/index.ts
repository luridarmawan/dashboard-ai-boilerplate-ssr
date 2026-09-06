import { env } from '@core/config';
import { app } from './app.ts';
import { createRuntime } from './runtime.ts';

// Fail fast on a bad environment before the port is even opened (P-4).
const e = env();

app.listen({ port: e.API_PORT, hostname: '127.0.0.1' });

// Event bus + scheduler live for the life of the process; stop cleanly so a running job can
// finish (or abort) before the port closes.
const runtime = createRuntime();
await runtime.start();
const shutdown = async (signal: string) => {
  console.log(
    JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: 'shutting down', signal }),
  );
  await runtime.stop();
  await app.stop();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

console.log(
  JSON.stringify({
    t: new Date().toISOString(),
    level: 'info',
    msg: 'api listening',
    url: `http://127.0.0.1:${e.API_PORT}`,
    docs: `http://127.0.0.1:${e.API_PORT}/docs`,
    dialect: e.DB_DIALECT,
    instanceId: runtime.instanceId,
    jobs: runtime.scheduler.jobs().map((j) => j.name),
    hooks: runtime.bus.subscriptions().length,
  }),
);
