import { env } from '@core/config';
import { app } from './app.ts';
import { bindServer } from './metrics.ts';
import { createRuntime } from './runtime.ts';
import { setBus } from './services.ts';

/** Start the HTTP server + runtime (event bus, scheduler) for the life of the process. */
export async function serve(): Promise<void> {
  // Fail fast on a bad environment before the port is even opened (P-4).
  const e = env();

  app.listen({ port: e.API_PORT, hostname: e.API_HOST });
  bindServer(() => app.server); // http_requests_in_flight (M-6)

  // Event bus + scheduler live for the life of the process; stop cleanly so a running job can
  // finish (or abort) before the port closes.
  const runtime = createRuntime();
  setBus(runtime.bus);
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
      url: `http://${e.API_HOST}:${e.API_PORT}`,
      docs: `http://${e.API_HOST}:${e.API_PORT}/docs`,
      dialect: e.DB_DIALECT,
      instanceId: runtime.instanceId,
      jobs: runtime.scheduler.jobs().map((j) => j.name),
      hooks: runtime.bus.subscriptions().length,
    }),
  );
}
