import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";

// Mock runtime before importing the module under test
vi.mock("./runtime.js", () => ({
  getTalktollmRuntime: () => ({
    config: {
      loadConfig: () => ({
        gateway: { auth: { token: "test-token-123" } },
        channels: { talktollm: { wsPort: 0 } },
      }),
    },
    logging: {
      getChildLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    },
  }),
}));

vi.mock("./ws-handler.js", () => ({
  handleWsMessage: vi.fn(),
}));

import { handleWsMessage } from "./ws-handler.js";
import {
  startWsServer,
  stopWsServer,
  getConnectedClient,
  isWsClientConnected,
  getWsConnectedDeviceIds,
} from "./ws-server.js";

// Helper to get the actual port after server starts on port 0
function getServerPort(): Promise<number> {
  // Give the server a moment to start listening
  return new Promise((resolve) => {
    setTimeout(() => {
      // Access the module internals — the httpServer is on a random port
      // We need to read the address from the server
      const net = require("node:net");
      const server = net.createServer();
      server.listen(0, () => {
        const port = server.address().port;
        server.close();
        resolve(port);
      });
    }, 100);
  });
}

// Since the server uses port from config (which we set to 0), we need a different approach.
// We'll test the exported functions directly and test WS connection behavior.

describe("ws-server", () => {
  // For unit tests, we test the registry functions directly
  describe("client registry (unit)", () => {
    beforeEach(() => {
      stopWsServer(); // Ensure clean state
    });

    afterEach(() => {
      stopWsServer();
    });

    it("getConnectedClient returns undefined for unknown device", () => {
      expect(getConnectedClient("unknown-device")).toBeUndefined();
    });

    it("isWsClientConnected returns false for unknown device", () => {
      expect(isWsClientConnected("unknown-device")).toBe(false);
    });

    it("getWsConnectedDeviceIds returns empty array initially", () => {
      expect(getWsConnectedDeviceIds()).toEqual([]);
    });
  });

  describe("WebSocket server integration", () => {
    let serverPort: number;

    beforeEach(async () => {
      // Use port 0 for tests — OS assigns a free port
      // Our mock config returns wsPort: 0, so the server will pick a random port
      startWsServer();

      // Wait for server to start and discover its port
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Unfortunately with port 0 we can't easily discover the port from outside.
      // For integration tests, use a fixed test port instead.
      stopWsServer();

      // Re-mock with a specific test port
      const testPort = 19876 + Math.floor(Math.random() * 100);
      serverPort = testPort;

      const { getTalktollmRuntime } = await import("./runtime.js");
      vi.mocked(getTalktollmRuntime).mockReturnValue({
        config: {
          loadConfig: () => ({
            gateway: { auth: { token: "test-token-123" } },
            channels: { talktollm: { wsPort: testPort } },
          }),
        },
        logging: {
          getChildLogger: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          }),
        },
      } as ReturnType<typeof getTalktollmRuntime>);

      startWsServer();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    afterEach(async () => {
      stopWsServer();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("accepts connections and authenticates successfully", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);

      const messages: unknown[] = [];
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      await new Promise<void>((resolve) => ws.on("open", resolve));

      ws.send(
        JSON.stringify({
          type: "auth",
          token: "test-token-123",
          deviceId: "device-001",
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages).toContainEqual({ type: "connected" });
      expect(isWsClientConnected("device-001")).toBe(true);
      expect(getWsConnectedDeviceIds()).toContain("device-001");

      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("rejects auth with wrong token", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);

      const messages: unknown[] = [];
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      await new Promise<void>((resolve) => ws.on("open", resolve));

      ws.send(
        JSON.stringify({
          type: "auth",
          token: "wrong-token",
          deviceId: "device-bad",
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages).toContainEqual({ type: "error", message: "auth failed" });
      expect(isWsClientConnected("device-bad")).toBe(false);
    });

    it("closes connection on auth timeout", async () => {
      // This test would need to wait 5 seconds for the timeout.
      // We just verify that a connection without auth message is eventually closed.
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);

      let closed = false;
      ws.on("close", () => {
        closed = true;
      });

      await new Promise<void>((resolve) => ws.on("open", resolve));

      // Don't send any auth message — wait for timeout (5s)
      await new Promise((resolve) => setTimeout(resolve, 5500));

      expect(closed).toBe(true);
    }, 10_000);

    it("forwards messages to handleWsMessage after auth", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);

      await new Promise<void>((resolve) => ws.on("open", resolve));

      ws.send(
        JSON.stringify({
          type: "auth",
          token: "test-token-123",
          deviceId: "device-002",
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const testMessage = JSON.stringify({
        type: "message",
        sessionKey: "agent:main:test",
        text: "hello",
        idempotencyKey: "test-key-1",
      });
      ws.send(testMessage);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handleWsMessage).toHaveBeenCalledWith(
        expect.any(Object), // WebSocket instance
        "device-002",
        testMessage,
      );

      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("unregisters client on disconnect", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);

      await new Promise<void>((resolve) => ws.on("open", resolve));

      ws.send(
        JSON.stringify({
          type: "auth",
          token: "test-token-123",
          deviceId: "device-003",
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(isWsClientConnected("device-003")).toBe(true);

      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(isWsClientConnected("device-003")).toBe(false);
      expect(getWsConnectedDeviceIds()).not.toContain("device-003");
    });

    it("getConnectedClient returns WebSocket for authenticated device", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);

      await new Promise<void>((resolve) => ws.on("open", resolve));

      ws.send(
        JSON.stringify({
          type: "auth",
          token: "test-token-123",
          deviceId: "device-004",
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const client = getConnectedClient("device-004");
      expect(client).toBeDefined();
      expect(client!.readyState).toBe(WebSocket.OPEN);

      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });
});
