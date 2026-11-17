type Metric = { type: "counter" | "gauge"; values: Map<string, number> };

const registry = new Map<string, Metric>();

function metric(name: string, type: Metric["type"]): Metric {
  let found = registry.get(name);
  if (!found) {
    found = { type, values: new Map() };
    registry.set(name, found);
  }
  return found;
}

function key(labels?: Record<string, string>): string {
  if (!labels) return "";
  return Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
}

export function inc(name: string, labels?: Record<string, string>, amount = 1): void {
  const entry = metric(name, "counter");
  const k = key(labels);
  entry.values.set(k, (entry.values.get(k) ?? 0) + amount);
}

export function setGauge(name: string, value: number, labels?: Record<string, string>): void {
  const entry = metric(name, "gauge");
  entry.values.set(key(labels), value);
}

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [name, entry] of registry) {
    lines.push(`# TYPE ${name} ${entry.type}`);
    for (const [labels, value] of entry.values) {
      lines.push(`${name}${labels ? `{${labels}}` : ""} ${value}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
