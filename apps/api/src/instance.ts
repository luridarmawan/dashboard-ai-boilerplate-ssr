import { hostname } from 'node:os';
import { env } from '@core/config';

/** Stable identity of this process: lease rows, logs, and /v1/health (useful behind a load balancer). */
export const instanceId: string = env().INSTANCE_ID ?? `${hostname()}:${process.pid}`;
