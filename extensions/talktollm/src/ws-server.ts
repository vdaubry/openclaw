import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { getTalktollmRuntime } from "./runtime.js";
import { unregisterDevice } from "./session-registry.js";
import { handleWsMessage } from "./ws-handler.js";

const DEFAULT_WS_PORT = 18790;
const AUTH_TIMEOUT_MS = 5_000;
const TICK_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 30_000;

/** Client registry: deviceId -> WebSocket */
const clients = new Map<string, WebSocket>();

let httpServer: HttpServer | null = null;
let wss: WebSocketServer | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

function resolvePort(): number {
  const runtime = getTalktollmRuntime();
  const cfg = runtime.config.loadConfig();
  const section = (cfg.channels as Record<string, unknown> | undefined)?.talktollm as
    | Record<string, unknown>
    | undefined;
  return (section?.wsPort as number) ?? DEFAULT_WS_PORT;
}

function resolveGatewayToken(): string | undefined {
  const runtime = getTalktollmRuntime();
  const cfg = runtime.config.loadConfig();
  const gateway = (cfg as Record<string, unknown>).gateway as Record<string, unknown> | undefined;
  const auth = gateway?.auth as Record<string, unknown> | undefined;
  return auth?.token as string | undefined;
}

export function startWsServer(): void {
  // Guard against double-start: if the server is already running, skip.
  if (httpServer) return;

  const port = resolvePort();
  const logger = getTalktollmRuntime().logging.getChildLogger({ channel: "talktollm-ws" });

  httpServer = createServer((_req, res) => {
    res.writeHead(426, { "Content-Type": "text/plain" });
    res.end("Upgrade required");
  });

  wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    let authenticated = false;
    let deviceId: string | null = null;

    // Auth timeout: close if not authenticated within 5 seconds
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        ws.send(JSON.stringify({ type: "error", message: "auth timeout" }));
        ws.close(4001, "auth timeout");
      }
    }, AUTH_TIMEOUT_MS);

    // Keepalive: pong tracking
    let pongReceived = true;

    ws.on("pong", () => {
      pongReceived = true;
    });

    ws.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf-8");

      if (!authenticated) {
        // Expect auth message
        try {
          const parsed = JSON.parse(raw) as {
            type?: string;
            token?: string;
            deviceId?: string;
          };

          if (parsed.type !== "auth") {
            ws.send(JSON.stringify({ type: "error", message: "expected auth message" }));
            ws.close(4002, "expected auth");
            clearTimeout(authTimer);
            return;
          }

          const expectedToken = resolveGatewayToken();
          if (!expectedToken || parsed.token !== expectedToken) {
            ws.send(JSON.stringify({ type: "error", message: "auth failed" }));
            ws.close(4003, "auth failed");
            clearTimeout(authTimer);
            return;
          }

          if (!parsed.deviceId || typeof parsed.deviceId !== "string") {
            ws.send(JSON.stringify({ type: "error", message: "deviceId required" }));
            ws.close(4004, "deviceId required");
            clearTimeout(authTimer);
            return;
          }

          authenticated = true;
          deviceId = parsed.deviceId;
          clearTimeout(authTimer);

          // Evict previous connection for the same deviceId
          const existing = clients.get(deviceId);
          if (existing && existing.readyState === WebSocket.OPEN) {
            existing.close(4005, "replaced by new connection");
          }

          clients.set(deviceId, ws);

          ws.send(JSON.stringify({ type: "connected" }));
          logger.info(`[talktollm-ws] client authenticated deviceId=${deviceId}`);
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
          ws.close(4006, "invalid JSON");
          clearTimeout(authTimer);
        }
        return;
      }

      // Authenticated: handle messages
      handleWsMessage(ws, deviceId!, raw);
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (deviceId) {
        // Only remove from registry if this is still the active connection
        if (clients.get(deviceId) === ws) {
          clients.delete(deviceId);
          logger.info(`[talktollm-ws] client disconnected deviceId=${deviceId}`);
        }
        unregisterDevice(deviceId);
      }
    });

    ws.on("error", (err) => {
      clearTimeout(authTimer);
      logger.warn(`[talktollm-ws] WebSocket error: ${err.message}`);
      if (deviceId && clients.get(deviceId) === ws) {
        clients.delete(deviceId);
      }
      if (deviceId) {
        unregisterDevice(deviceId);
      }
    });

    // Keepalive ping check for this connection
    const pingTimer = setInterval(() => {
      if (!pongReceived) {
        logger.info(`[talktollm-ws] pong timeout, terminating deviceId=${deviceId}`);
        ws.terminate();
        clearInterval(pingTimer);
        return;
      }
      pongReceived = false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, PONG_TIMEOUT_MS);

    ws.on("close", () => clearInterval(pingTimer));
  });

  // Tick: send periodic keepalive to all connected clients
  tickTimer = setInterval(() => {
    const tick = JSON.stringify({ type: "tick" });
    for (const [, client] of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(tick);
      }
    }
  }, TICK_INTERVAL_MS);
  tickTimer.unref();

  httpServer.listen(port, "0.0.0.0", () => {
    logger.info(`[talktollm-ws] WebSocket server listening on 0.0.0.0:${port}`);
  });
}

export function stopWsServer(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  // Unregister all devices from session registry before clearing
  for (const deviceId of clients.keys()) {
    unregisterDevice(deviceId);
  }
  if (wss) {
    for (const client of wss.clients) {
      client.close(1001, "server shutting down");
    }
    wss.close();
    wss = null;
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  clients.clear();
}

export function getConnectedClient(deviceId: string): WebSocket | undefined {
  return clients.get(deviceId);
}

export function isWsClientConnected(deviceId: string): boolean {
  const ws = clients.get(deviceId);
  return ws !== undefined && ws.readyState === WebSocket.OPEN;
}

export function getWsConnectedDeviceIds(): string[] {
  return [...clients.keys()];
}
