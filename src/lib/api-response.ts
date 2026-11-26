import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { MoneroRpcError } from "./monero/rpc";
import { RateLimitError } from "./rate-limit";

export class ConflictError extends Error {
  constructor(message = "Conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export function apiError(error: unknown, fallback = "Request failed") {
  const message = error instanceof Error ? error.message : fallback;

  let status = 500;
  if (error instanceof AuthError) status = 401;
  else if (error instanceof NotFoundError) status = 404;
  else if (error instanceof ConflictError) status = 409;
  else if (error instanceof RateLimitError) status = 429;
  else if (error instanceof MoneroRpcError) status = 502;
  else if (/required|invalid|at most|address|url/i.test(message)) status = 400;

  const safeMessage =
    status >= 500
      ? status === 502
        ? "Upstream service unavailable"
        : "Internal server error"
      : message;

  const response = NextResponse.json({ error: safeMessage }, { status });
  if (error instanceof RateLimitError) {
    response.headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  return response;
}
