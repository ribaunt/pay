import http from "node:http";
import https from "node:https";
import type { RpcResponse } from "./types";
import { digestAuthorization, parseDigestChallenge } from "./digest";

const RPC_URL = process.env.MONERO_WALLET_RPC_URL ?? "http://localhost:18082";
const REQUEST_TIMEOUT_MS = 15_000;
const RPC_USER = process.env.MONERO_RPC_USER;
const RPC_PASSWORD = process.env.MONERO_RPC_PASSWORD;

// monero-wallet-rpc binds digest nonces to a TCP connection. Each RPC call
// gets a fresh keep-alive agent so the 401 challenge and authenticated retry
// share one socket, without reusing a socket the daemon may have closed.
const transport = RPC_URL.startsWith("https:") ? https : http;
function newAgent() {
  return new transport.Agent({ keepAlive: true, maxSockets: 1 });
}

export class MoneroRpcError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "MoneroRpcError";
    this.code = code;
  }
}

type RawResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

function rawRequest(
  agent: http.Agent | https.Agent,
  headers: Record<string, string>,
  body: string
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(RPC_URL);

    const request = transport.request(
      {
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}/json_rpc`.replace("//json_rpc", "/json_rpc"),
        method: "POST",
        agent,
        headers: {
          ...headers,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: data,
          });
        });
      }
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Request timed out"));
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function post(agent: http.Agent | https.Agent, body: string): Promise<RawResponse> {
  // The challenge probe carries an empty body, like standard digest clients.
  let response = await rawRequest(agent, {}, "");

  if (response.status === 401) {
    if (!RPC_USER || !RPC_PASSWORD) {
      throw new MoneroRpcError("wallet RPC requires credentials (set MONERO_RPC_USER/PASSWORD)");
    }

    const challengeHeader = Array.isArray(response.headers["www-authenticate"])
      ? response.headers["www-authenticate"][0]
      : response.headers["www-authenticate"];
    const challenge = parseDigestChallenge(challengeHeader ?? null);

    if (!challenge) {
      throw new MoneroRpcError("wallet RPC returned 401 without a digest challenge");
    }

    const path = new URL(RPC_URL).pathname.replace(/\/$/, "") + "/json_rpc";
    const authorization = digestAuthorization(
      challenge,
      RPC_USER,
      RPC_PASSWORD,
      "POST",
      path
    );

    response = await rawRequest(agent, { authorization }, body);
  }

  return response;
}

export async function walletRpc<T>(
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: "0", method, params });

  const agent = newAgent();
  let response: RawResponse;
  try {
    response = await post(agent, body);
  } catch (error) {
    if (error instanceof MoneroRpcError) throw error;
    throw new MoneroRpcError(`Could not reach monero-wallet-rpc at ${RPC_URL}: ${String(error)}`);
  } finally {
    agent.destroy();
  }

  if (!response.status || response.status < 200 || response.status >= 300) {
    throw new MoneroRpcError(`monero-wallet-rpc returned HTTP ${response.status} for ${method}`);
  }

  let payload: RpcResponse<T>;
  try {
    payload = JSON.parse(response.body) as RpcResponse<T>;
  } catch {
    throw new MoneroRpcError(`monero-wallet-rpc returned invalid JSON for ${method}`);
  }

  if (payload.error) {
    throw new MoneroRpcError(payload.error.message, payload.error.code);
  }

  if (payload.result === undefined) {
    throw new MoneroRpcError(`monero-wallet-rpc returned no result for ${method}`);
  }

  return payload.result;
}

export async function walletRpcPing(): Promise<boolean> {
  try {
    await walletRpc("get_version");
    return true;
  } catch {
    return false;
  }
}
