import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerConnection, unregisterConnection, getConnectedDeviceIds } from "./gateway.js";

const {
  mockLoadApnsRegistration,
  mockResolveApnsAuthConfigFromEnv,
  mockSendApnsAlert,
  mockGetConnectedClient,
  mockGetSessionsForDevice,
} = vi.hoisted(() => ({
  mockLoadApnsRegistration: vi.fn().mockResolvedValue(null),
  mockResolveApnsAuthConfigFromEnv: vi.fn().mockResolvedValue({
    ok: false,
    error: "APNs auth missing (test)",
  }),
  mockSendApnsAlert: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    apnsId: "test-apns-id",
    tokenSuffix: "abcd1234",
    topic: "com.test",
    environment: "sandbox",
  }),
  mockGetConnectedClient: vi.fn().mockReturnValue(undefined),
  mockGetSessionsForDevice: vi.fn().mockReturnValue([]),
}));

vi.mock("./runtime.js", () => ({
  getTalktollmRuntime: () => ({
    config: {
      loadConfig: () => ({}) as OpenClawConfig,
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

vi.mock("../../../src/infra/push-apns.js", () => ({
  loadApnsRegistration: mockLoadApnsRegistration,
  resolveApnsAuthConfigFromEnv: mockResolveApnsAuthConfigFromEnv,
  sendApnsAlert: mockSendApnsAlert,
}));

vi.mock("./ws-server.js", () => ({
  getConnectedClient: (...args: unknown[]) => mockGetConnectedClient(...args),
  isWsClientConnected: vi.fn().mockReturnValue(false),
  getWsConnectedDeviceIds: vi.fn().mockReturnValue([]),
}));

vi.mock("./session-registry.js", () => ({
  getSessionsForDevice: (...args: unknown[]) => mockGetSessionsForDevice(...args),
}));

import { WebSocket } from "ws";
import { talktollmOutboundAdapter } from "./outbound.js";

describe("talktollmOutboundAdapter", () => {
  beforeEach(() => {
    for (const id of getConnectedDeviceIds()) {
      unregisterConnection(id);
    }
    mockLoadApnsRegistration.mockReset().mockResolvedValue(null);
    mockResolveApnsAuthConfigFromEnv.mockReset().mockResolvedValue({
      ok: false,
      error: "APNs auth missing (test)",
    });
    mockSendApnsAlert.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      apnsId: "test-apns-id",
      tokenSuffix: "abcd1234",
      topic: "com.test",
      environment: "sandbox",
    });
    mockGetConnectedClient.mockReset().mockReturnValue(undefined);
    mockGetSessionsForDevice.mockReset().mockReturnValue([]);
  });

  describe("sendText — APNs integration", () => {
    it("calls sendApnsAlert when registration exists", async () => {
      mockLoadApnsRegistration.mockResolvedValueOnce({
        nodeId: "device-push",
        token: "apns-token-hex",
        topic: "com.test.app",
        environment: "sandbox",
        updatedAtMs: Date.now(),
      });
      mockResolveApnsAuthConfigFromEnv.mockResolvedValueOnce({
        ok: true,
        value: { type: "token", keyId: "k1", teamId: "t1", key: "pk" },
      });

      await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-push",
        text: "Hello via push",
      });

      expect(mockSendApnsAlert).toHaveBeenCalled();
      const callArgs = mockSendApnsAlert.mock.calls[0][0];
      expect(callArgs.body).toBe("Hello via push");
      expect(callArgs.title).toBe("New message");
      expect(callArgs.nodeId).toMatch(/^talktollm\|/);
    });

    it("truncates body to 2000 chars for push payload", async () => {
      mockLoadApnsRegistration.mockResolvedValueOnce({
        nodeId: "device-push",
        token: "apns-token-hex",
        topic: "com.test.app",
        environment: "sandbox",
        updatedAtMs: Date.now(),
      });
      mockResolveApnsAuthConfigFromEnv.mockResolvedValueOnce({
        ok: true,
        value: { type: "token", keyId: "k1", teamId: "t1", key: "pk" },
      });

      const longText = "A".repeat(3000);
      await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-push",
        text: longText,
      });

      expect(mockSendApnsAlert).toHaveBeenCalled();
      const callArgs = mockSendApnsAlert.mock.calls[0][0];
      expect(callArgs.body.length).toBeLessThanOrEqual(2000);
    });

    it("encodes sessionKey and messageId in nodeId", async () => {
      mockLoadApnsRegistration.mockResolvedValueOnce({
        nodeId: "device-push",
        token: "apns-token-hex",
        topic: "com.test.app",
        environment: "sandbox",
        updatedAtMs: Date.now(),
      });
      mockResolveApnsAuthConfigFromEnv.mockResolvedValueOnce({
        ok: true,
        value: { type: "token", keyId: "k1", teamId: "t1", key: "pk" },
      });

      await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-push",
        text: "Test message",
      });

      expect(mockSendApnsAlert).toHaveBeenCalled();
      const callArgs = mockSendApnsAlert.mock.calls[0][0];
      const parts = callArgs.nodeId.split("|");
      expect(parts[0]).toBe("talktollm");
      expect(parts[1]).toBe("device-push"); // sessionKey === deviceId
      expect(parts[2]).toMatch(/^[0-9a-f]{8}-/); // UUID messageId
    });

    it("skips push when no APNs registration", async () => {
      mockLoadApnsRegistration.mockResolvedValueOnce(null);

      await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-no-reg",
        text: "No push expected",
      });

      expect(mockSendApnsAlert).not.toHaveBeenCalled();
    });
  });

  describe("sendText", () => {
    it("returns a result with messageId", async () => {
      registerConnection("device-abc");
      const result = await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-abc",
        text: "Hello from the agent",
      });
      expect(result.messageId).toBeDefined();
      expect(result.messageId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("returns channel talktollm", async () => {
      registerConnection("device-abc");
      const result = await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-abc",
        text: "Hello",
      });
      expect(result.channel).toBe("talktollm");
    });

    it("includes chatId matching the device", async () => {
      registerConnection("device-abc");
      const result = await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-abc",
        text: "Hello",
      });
      expect(result.chatId).toBe("device-abc");
    });

    it("includes timestamp", async () => {
      registerConnection("device-abc");
      const before = Date.now();
      const result = await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-abc",
        text: "Hello",
      });
      expect(result.timestamp).toBeGreaterThanOrEqual(before);
    });

    it("generates unique messageIds for each call", async () => {
      registerConnection("device-abc");
      const result1 = await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-abc",
        text: "Message 1",
      });
      const result2 = await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-abc",
        text: "Message 2",
      });
      expect(result1.messageId).not.toBe(result2.messageId);
    });

    it("returns result even when device is offline", async () => {
      // Device not registered — should still return a result (offline path)
      const result = await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-offline",
        text: "Offline message",
      });
      expect(result.messageId).toBeDefined();
      expect(result.channel).toBe("talktollm");
      expect(result.chatId).toBe("device-offline");
    });
  });

  describe("deliveryMode", () => {
    it("is direct", () => {
      expect(talktollmOutboundAdapter.deliveryMode).toBe("direct");
    });
  });

  describe("textChunkLimit", () => {
    it("is 4096", () => {
      expect(talktollmOutboundAdapter.textChunkLimit).toBe(4096);
    });
  });

  describe("sendText — WebSocket delivery", () => {
    function createMockWs(): WebSocket & { sentFrames: unknown[] } {
      const sent: unknown[] = [];
      return {
        readyState: WebSocket.OPEN,
        send: vi.fn((data: string) => {
          sent.push(JSON.parse(data));
        }),
        sentFrames: sent,
      } as unknown as WebSocket & { sentFrames: unknown[] };
    }

    it("sends agentText + agentDone when WS client is connected", async () => {
      const ws = createMockWs();
      mockGetConnectedClient.mockReturnValue(ws);

      await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-ws",
        text: "Hello via WS",
      });

      expect(ws.sentFrames).toHaveLength(2);
      expect((ws.sentFrames[0] as Record<string, unknown>).type).toBe("agentText");
      expect((ws.sentFrames[0] as Record<string, unknown>).text).toBe("Hello via WS");
      expect((ws.sentFrames[1] as Record<string, unknown>).type).toBe("agentDone");

      // Both frames share the same messageId
      const msgId = (ws.sentFrames[0] as Record<string, unknown>).messageId;
      expect((ws.sentFrames[1] as Record<string, unknown>).messageId).toBe(msgId);
    });

    it("resolves session key from registry", async () => {
      const ws = createMockWs();
      mockGetConnectedClient.mockReturnValue(ws);
      mockGetSessionsForDevice.mockReturnValue(["agent:main:main"]);

      await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-ws",
        text: "Hello",
      });

      expect((ws.sentFrames[0] as Record<string, unknown>).sessionKey).toBe("agent:main:main");
      expect((ws.sentFrames[1] as Record<string, unknown>).sessionKey).toBe("agent:main:main");
    });

    it("falls back to deviceId as sessionKey when registry is empty", async () => {
      const ws = createMockWs();
      mockGetConnectedClient.mockReturnValue(ws);
      mockGetSessionsForDevice.mockReturnValue([]);

      await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-fallback",
        text: "Hello",
      });

      expect((ws.sentFrames[0] as Record<string, unknown>).sessionKey).toBe("device-fallback");
    });
  });
});
