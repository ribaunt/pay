/**
 * Keep this module edge-safe: middleware causes Next to load instrumentation
 * in the edge runtime, where node built-ins such as node:http are unavailable.
 * Node-only work is imported lazily inside register().
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Validate secrets and force the full-scan daemon mode at startup, not on
  // first request, so a misconfigured production deployment fails fast.
  const { assertProductionEnv } = await import("@/lib/env");
  assertProductionEnv();

  const { startNodeInstrumentation } = await import("@/lib/instrumentation-node");
  startNodeInstrumentation();
}
