/** Strict same-origin check for browser (cookie-authenticated) mutations. */
export function isSameOrigin(
  origin: string | null | undefined,
  host: string | null | undefined,
  protocol: string | null | undefined
): boolean {
  if (!origin || !host || !protocol) return false;
  try {
    const parsed = new URL(origin);
    const expected = `${protocol.replace(/:$/, "")}://${host}`;
    // Compare whole origins: a path, userinfo or trailing dot must not pass.
    return parsed.origin === expected && origin === parsed.origin;
  } catch {
    return false;
  }
}
