/**
 * `@core/metrics` — Prometheus instrumentation without a dependency (PRD M-6).
 *
 * Three instrument kinds, labelled, in one registry, rendered in the text exposition format
 * (version 0.0.4) that Prometheus, VictoriaMetrics, Grafana Agent and friends scrape. Each API
 * process exposes its own numbers; the scraper aggregates across replicas by the `instance` label
 * it adds itself. Nothing here is per tenant on purpose: metrics are operational, not product data.
 *
 * Label values are sanitised and cardinality is bounded by the caller (routes are matched
 * patterns, never raw paths; user ids and tenant ids are never labels).
 */

export type Labels = Readonly<Record<string, string | number | boolean>>;

const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertName(name: string, what: string): void {
  if (!NAME_RE.test(name)) throw new Error(`metrics: nama ${what} "${name}" tidak valid`);
}

function labelKey(labelNames: readonly string[], labels: Labels): string {
  return labelNames.map((n) => String(labels[n] ?? '')).join('\u0001');
}

export function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function renderLabels(labelNames: readonly string[], key: string, extra?: string): string {
  const values = key === '' && labelNames.length === 0 ? [] : key.split('\u0001');
  const parts = labelNames.map((n, i) => `${n}="${escapeLabelValue(values[i] ?? '')}"`);
  if (extra) parts.push(extra);
  return parts.length ? `{${parts.join(',')}}` : '';
}

function fmt(n: number): string {
  if (n === Number.POSITIVE_INFINITY) return '+Inf';
  if (n === Number.NEGATIVE_INFINITY) return '-Inf';
  if (Number.isNaN(n)) return 'NaN';
  return String(n);
}

interface Instrument {
  readonly name: string;
  readonly help: string;
  readonly type: 'counter' | 'gauge' | 'histogram';
  render(): string;
  reset(): void;
}

export class Counter implements Instrument {
  readonly type = 'counter' as const;
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
  ) {
    assertName(name, 'counter');
    for (const l of labelNames) if (!LABEL_RE.test(l)) throw new Error(`metrics: label "${l}"`);
  }
  inc(labels: Labels = {}, by = 1): void {
    if (by < 0) throw new Error('metrics: counter tidak boleh berkurang');
    const k = labelKey(this.labelNames, labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  get(labels: Labels = {}): number {
    return this.values.get(labelKey(this.labelNames, labels)) ?? 0;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [k, v] of this.values)
      lines.push(`${this.name}${renderLabels(this.labelNames, k)} ${fmt(v)}`);
    return lines.join('\n');
  }
  reset(): void {
    this.values.clear();
  }
}

export class Gauge implements Instrument {
  readonly type = 'gauge' as const;
  private readonly values = new Map<string, number>();
  private collector: ((g: Gauge) => void) | null = null;
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
  ) {
    assertName(name, 'gauge');
    for (const l of labelNames) if (!LABEL_RE.test(l)) throw new Error(`metrics: label "${l}"`);
  }
  set(labels: Labels, value: number): void;
  set(value: number): void;
  set(a: Labels | number, b?: number): void {
    if (typeof a === 'number') this.values.set(labelKey(this.labelNames, {}), a);
    else this.values.set(labelKey(this.labelNames, a), b ?? 0);
  }
  inc(labels: Labels = {}, by = 1): void {
    const k = labelKey(this.labelNames, labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  dec(labels: Labels = {}, by = 1): void {
    this.inc(labels, -by);
  }
  get(labels: Labels = {}): number {
    return this.values.get(labelKey(this.labelNames, labels)) ?? 0;
  }
  /** A function run at scrape time to refresh the value(s) — for pool sizes, memory, and the like. */
  collect(fn: (g: Gauge) => void): this {
    this.collector = fn;
    return this;
  }
  render(): string {
    try {
      this.collector?.(this);
    } catch {
      /* a broken collector must not break the scrape */
    }
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [k, v] of this.values)
      lines.push(`${this.name}${renderLabels(this.labelNames, k)} ${fmt(v)}`);
    return lines.join('\n');
  }
  reset(): void {
    this.values.clear();
  }
}

/** Latency buckets in seconds: 5 ms … 10 s, good for an HTTP API. */
export const DEFAULT_BUCKETS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

interface HistogramSeries {
  counts: number[];
  sum: number;
  count: number;
}

export class Histogram implements Instrument {
  readonly type = 'histogram' as const;
  private readonly series = new Map<string, HistogramSeries>();
  readonly buckets: readonly number[];
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_BUCKETS,
  ) {
    assertName(name, 'histogram');
    for (const l of labelNames) {
      if (!LABEL_RE.test(l)) throw new Error(`metrics: label "${l}"`);
      if (l === 'le') throw new Error('metrics: label "le" dicadangkan untuk histogram');
    }
    this.buckets = [...buckets].sort((a, b) => a - b);
  }
  observe(labels: Labels, value: number): void;
  observe(value: number): void;
  observe(a: Labels | number, b?: number): void {
    const labels = typeof a === 'number' ? {} : a;
    const value = typeof a === 'number' ? a : (b ?? 0);
    const k = labelKey(this.labelNames, labels);
    let s = this.series.get(k);
    if (!s) {
      s = { counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    for (let i = 0; i < this.buckets.length; i++)
      if (value <= (this.buckets[i] as number)) (s.counts[i] as number)++;
    s.sum += value;
    s.count++;
  }
  /** Observe a duration measured with performance.now() (milliseconds) as seconds. */
  observeMs(labels: Labels, ms: number): void {
    this.observe(labels, ms / 1000);
  }
  get(labels: Labels = {}): { count: number; sum: number } {
    const s = this.series.get(labelKey(this.labelNames, labels));
    return { count: s?.count ?? 0, sum: s?.sum ?? 0 };
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [k, s] of this.series) {
      for (let i = 0; i < this.buckets.length; i++)
        lines.push(
          `${this.name}_bucket${renderLabels(this.labelNames, k, `le="${fmt(this.buckets[i] as number)}"`)} ${s.counts[i]}`,
        );
      lines.push(`${this.name}_bucket${renderLabels(this.labelNames, k, 'le="+Inf"')} ${s.count}`);
      lines.push(`${this.name}_sum${renderLabels(this.labelNames, k)} ${fmt(s.sum)}`);
      lines.push(`${this.name}_count${renderLabels(this.labelNames, k)} ${s.count}`);
    }
    return lines.join('\n');
  }
  reset(): void {
    this.series.clear();
  }
}

/** Instruments by name; re-registering a name returns the existing instrument (modules reload). */
export class Registry {
  private readonly instruments = new Map<string, Instrument>();

  counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
    return this.getOrCreate(name, 'counter', () => new Counter(name, help, labelNames));
  }
  gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge {
    return this.getOrCreate(name, 'gauge', () => new Gauge(name, help, labelNames));
  }
  histogram(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_BUCKETS,
  ): Histogram {
    return this.getOrCreate(
      name,
      'histogram',
      () => new Histogram(name, help, labelNames, buckets),
    );
  }
  private getOrCreate<T extends Instrument>(name: string, type: T['type'], make: () => T): T {
    const existing = this.instruments.get(name);
    if (existing) {
      if (existing.type !== type)
        throw new Error(`metrics: "${name}" sudah terdaftar sebagai ${existing.type}`);
      return existing as T;
    }
    const inst = make();
    this.instruments.set(name, inst);
    return inst;
  }
  has(name: string): boolean {
    return this.instruments.has(name);
  }
  names(): string[] {
    return [...this.instruments.keys()].sort();
  }
  /** The scrape body: every instrument, names sorted, one blank line between families. */
  expose(): string {
    return `${this.names()
      .map((n) => (this.instruments.get(n) as Instrument).render())
      .join('\n\n')}\n`;
  }
  /** Tests: forget every series (instruments stay registered). */
  resetAll(): void {
    for (const i of this.instruments.values()) i.reset();
  }
}

export const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** The process-wide registry: core and modules register into the same one. */
export const registry = new Registry();

/**
 * Standard process gauges, refreshed at scrape time. Idempotent: registering twice keeps the
 * first collectors.
 */
export function registerProcessMetrics(reg: Registry = registry): void {
  if (reg.has('process_resident_memory_bytes')) return;
  const start = Date.now() / 1000;
  reg.gauge('process_start_time_seconds', 'Start time of the process since unix epoch.').set(start);
  reg
    .gauge('process_resident_memory_bytes', 'Resident memory size in bytes.')
    .collect((g) => g.set(process.memoryUsage.rss()));
  reg
    .gauge('process_heap_bytes', 'Heap used in bytes (JavaScriptCore).')
    .collect((g) => g.set(process.memoryUsage().heapUsed));
  reg
    .gauge('process_cpu_seconds_total', 'Total user and system CPU time spent in seconds.')
    .collect((g) => {
      const u = process.cpuUsage();
      g.set((u.user + u.system) / 1_000_000);
    });
  reg
    .gauge('process_uptime_seconds', 'Seconds since the process started.')
    .collect((g) => g.set(process.uptime()));
}

/** Route pattern → a bounded label: `:id` style params stay, raw ids never appear. */
export function routeLabel(route: string | undefined, path: string): string {
  if (route) return route;
  // No matched route (404s, static): collapse anything id-like so cardinality stays bounded.
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, 120);
}
