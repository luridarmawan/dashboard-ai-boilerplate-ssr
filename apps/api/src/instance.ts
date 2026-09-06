import { hostname } from 'node:os';

/**
 * Stable identity of this process: lease rows, logs, and /v1/health (useful behind a load balancer).
 * Read from process.env directly: importing the app (unit tests, `bun check`, OpenAPI generation)
 * must not trigger full env validation — that happens when something actually connects.
 */
export const instanceId: string = process.env.INSTANCE_ID?.trim() || `${hostname()}:${process.pid}`;
