import http from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { HTTP_BUCKETS, addGauge, inc, observe, setGauge } from "./lib/metrics";

function normalizeRoute(url: string): string {
  const path = url.split("?")[0] || "/";
  return path
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (/^(cm[a-z0-9]{15,}|[a-f0-9]{24,}|\d+)$/i.test(segment)) return "[id]";
      return segment;
    })
    .join("/");
}

function instrumentHttp(): void {
  const originalEmit = http.Server.prototype.emit;

  http.Server.prototype.emit = function patchedEmit(
    this: http.Server,
    event: string,
    ...args: unknown[]
  ) {
    if (event === "request") {
      const request = args[0] as http.IncomingMessage;
      const response = args[1] as http.ServerResponse;
      const method = request.method ?? "GET";
      const route = normalizeRoute(request.url ?? "/");
      const labels = { method, route };

      addGauge("pay_http_requests_in_flight", 1, labels);
      const started = process.hrtime.bigint();

      let recorded = false;
      const record = (status: number) => {
        if (recorded) return;
        recorded = true;
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        addGauge("pay_http_requests_in_flight", -1, labels);
        const finalLabels = { ...labels, status: String(status) };
        inc("pay_http_requests_total", finalLabels);
        observe("pay_http_request_duration_seconds", seconds, finalLabels, HTTP_BUCKETS);
        if (status >= 500) inc("pay_http_errors_total", labels);
      };

      response.once("finish", () => record(response.statusCode));
      response.once("close", () => record(response.statusCode));
    }

    return originalEmit.apply(this, [event, ...args] as never);
  };
}

function instrumentProcess(): void {
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();

  let previous = process.cpuUsage();
  const timer = setInterval(() => {
    const current = process.cpuUsage();
    inc("process_cpu_seconds_total", { mode: "user" }, (current.user - previous.user) / 1e6);
    inc(
      "process_cpu_seconds_total",
      { mode: "system" },
      (current.system - previous.system) / 1e6
    );
    previous = current;

    const memory = process.memoryUsage();
    setGauge("process_resident_memory_bytes", memory.rss);
    setGauge("process_heap_bytes", memory.heapUsed, { kind: "used" });
    setGauge("process_heap_bytes", memory.heapTotal, { kind: "total" });
    setGauge("process_uptime_seconds", process.uptime());
    setGauge("nodejs_eventloop_lag_seconds", loopDelay.mean / 1e9);
  }, 5_000);
  timer.unref();
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  instrumentHttp();
  instrumentProcess();
}
