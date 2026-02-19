import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerConnection, unregisterConnection, getConnectedDeviceIds } from "./gateway.js";

const { mockLoadApnsRegistration, mockResolveApnsAuthConfigFromEnv, mockSendApnsAlert } =
  vi.hoisted(() => ({
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

vi.mock("../../src/infra/push-apns.js", () => ({
  loadApnsRegistration: mockLoadApnsRegistration,
  resolveApnsAuthConfigFromEnv: mockResolveApnsAuthConfigFromEnv,
  sendApnsAlert: mockSendApnsAlert,
}));

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
      expect(callArgs.customOpenclawData.kind).toBe("talktollm.message");
    });

    it("truncates body to 200 chars for push display", async () => {
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

      const longText = "A".repeat(300);
      await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-push",
        text: longText,
      });

      expect(mockSendApnsAlert).toHaveBeenCalled();
      const callArgs = mockSendApnsAlert.mock.calls[0][0];
      expect(callArgs.body.length).toBeLessThanOrEqual(200);
      expect(callArgs.body).toMatch(/\.\.\.$/);
    });

    it("truncates payload text to 2000 chars", async () => {
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

      const longText = "B".repeat(3000);
      await talktollmOutboundAdapter.sendText!({
        cfg: {} as OpenClawConfig,
        to: "device-push",
        text: longText,
      });

      expect(mockSendApnsAlert).toHaveBeenCalled();
      const callArgs = mockSendApnsAlert.mock.calls[0][0];
      expect(callArgs.customOpenclawData.text.length).toBeLessThanOrEqual(2000);
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
});
