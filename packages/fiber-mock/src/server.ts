import { createServer, type ServerResponse } from "node:http";
import { dispatch, type JsonRpcRequest } from "./dispatch.js";
import { RpcError } from "./errors.js";
import { createInitialState, type MockState } from "./state.js";

export interface MockNodeHandle {
  url: string;
  port: number;
  state: MockState;
  close(): Promise<void>;
}

export interface StartMockNodeOptions {
  port?: number;
  host?: string;
  state?: MockState;
}

function respond(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

/**
 * Starts the mock over a single POST endpoint speaking JSON-RPC 2.0. Pass
 * `port: 0` for an ephemeral port (read it back from the resolved handle).
 */
export function startMockNode(options: StartMockNodeOptions = {}): Promise<MockNodeHandle> {
  const state = options.state ?? createInitialState();
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8227;

  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method not allowed; use POST" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonRpcRequest;
      } catch {
        respond(res, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        return;
      }
      const id = request.id ?? null;
      try {
        respond(res, { jsonrpc: "2.0", id, result: dispatch(state, request) });
      } catch (error) {
        const rpcError =
          error instanceof RpcError
            ? { code: error.code, message: error.message }
            : { code: -32603, message: `internal error: ${String((error as Error).message)}` };
        respond(res, { jsonrpc: "2.0", id, error: rpcError });
      }
    });
    req.on("error", () => {
      respond(res, { jsonrpc: "2.0", id: null, error: { code: -32603, message: "request stream error" } });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        url: `http://${host}:${boundPort}`,
        port: boundPort,
        state,
        close: () =>
          new Promise<void>((closed, failed) => {
            server.close((error) => (error ? failed(error) : closed()));
          }),
      });
    });
  });
}
