import { describe, expect, it } from "@/testkit";

const { inc, renderMetrics, setGauge } = await import("./metrics");

describe("metrics", () => {
  it("renders counters and gauges", () => {
    inc("test_counter_total", { status: "ok" }, 2);
    setGauge("test_gauge", 7);

    const output = renderMetrics();
    expect(output).toContain("# TYPE test_counter_total counter");
    expect(output).toContain('test_counter_total{status="ok"} 2');
    expect(output).toContain("test_gauge 7");
  });
});

export {};
