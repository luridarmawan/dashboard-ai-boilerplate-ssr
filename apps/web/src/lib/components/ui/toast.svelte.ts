/**
 * Toast store (L-20). Toasts are ephemeral, per browser; the page still shows the durable
 * outcome (an Alert / notice) so no-JS visitors lose nothing (L-22).
 */
export interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: 'info' | 'success' | 'warning' | 'error';
}

let seq = 0;
export const toasts = $state<Toast[]>([]);

export function toast(
  t: Omit<Toast, 'id' | 'variant'> & { variant?: Toast['variant'] },
  ttlMs = 5000,
) {
  const item: Toast = { id: ++seq, variant: 'info', ...t };
  toasts.push(item);
  if (ttlMs > 0) setTimeout(() => dismiss(item.id), ttlMs);
  return item.id;
}

export function dismiss(id: number) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
