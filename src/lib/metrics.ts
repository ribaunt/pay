export type Labels = Record<string, string>;

type SimpleMetric = { type: "counter" | "gauge"; values: Map<string, number> };
type HistogramMetric = {
  type: "histogram";
  buckets: number[];
  values: Map<string, { counts: number[]; sum: number; count: number }>;
};
type Metric = SimpleMetric | HistogramMetric;

type Registry = Map<string, Metric>;

// Keep the registry on globalThis so instrumentation, route handlers, and
// duplicated server bundles all read from the same store in a standalone build.
const globalForMetrics = globalThis as unknown as { __payMetrics?: Registry };
const registry: Registry = globalForMetrics.__payMetrics ?? new Map();
globalForMetrics.__payMetrics = registry;

export const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function keyOf(labels?: Labels): string {
  if (!labels) return "";
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}="${escapeLabel(value)}"`)
    .join(",");
}

function metric(name: string, type: "counter" | "gauge"): SimpleMetric;
function metric(name: string, type: "histogram", buckets: number[]): HistogramMetric;
function metric(
  name: string,
  type: Metric["type"],
  buckets: number[] = HTTP_BUCKETS
): Metric {
  let found = registry.get(name);
  if (!found) {
    found =
      type === "histogram"
        ? { type, buckets: [...buckets].sort((a, b) => a - b), values: new Map() }
        : { type, values: new Map() };
    registry.set(name, found);
  }
  return found;
}

export function inc(name: string, labels?: Labels, amount = 1): void {
  const entry = metric(name, "counter");
  const k = keyOf(labels);
  entry.values.set(k, (entry.values.get(k) ?? 0) + amount);
}

export function setGauge(name: string, value: number, labels?: Labels): void {
  const entry = metric(name, "gauge");
  entry.values.set(keyOf(labels), value);
}

export function addGauge(name: string, delta: number, labels?: Labels): void {
  const entry = metric(name, "gauge");
  const k = keyOf(labels);
  entry.values.set(k, (entry.values.get(k) ?? 0) + delta);
}

export function observe(name: string, value: number, labels?: Labels, buckets = HTTP_BUCKETS): void {
  const entry = metric(name, "histogram", buckets);
  const k = keyOf(labels);
  let state = entry.values.get(k);
  if (!state) {
    state = { counts: entry.buckets.map(() => 0), sum: 0, count: 0 };
    entry.values.set(k, state);
  }
  entry.buckets.forEach((bound, index) => {
    if (value <= bound) state!.counts[index] += 1;
  });
  state.sum += value;
  state.count += 1;
}

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [name, entry] of registry) {
    lines.push(`# TYPE ${name} ${entry.type}`);
    if (entry.type === "histogram") {
      for (const [k, state] of entry.values) {
        const prefix = k ? `{${k},` : "{";
        entry.buckets.forEach((bound, index) => {
          lines.push(
            `${name}_bucket${prefix}le="${bound}"} ${state.counts[index]}`
          );
        });
        lines.push(`${name}_bucket${prefix}le="+Inf"} ${state.count}`);
        lines.push(`${name}_sum${k ? `{${k}}` : ""} ${state.sum}`);
        lines.push(`${name}_count${k ? `{${k}}` : ""} ${state.count}`);
      }
    } else {
      for (const [k, value] of entry.values) {
        lines.push(`${name}${k ? `{${k}}` : ""} ${value}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
