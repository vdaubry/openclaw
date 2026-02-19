import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerConnection,
  unregisterConnection,
  getConnectedDeviceIds,
  isDeviceConnected,
} from "./gateway.js";

// Mock gateway register/unregister to track calls
vi.mock("./gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gateway.js")>();
  return {
    ...actual,
  };
});

import { talktollmSetupAdapter } from "./setup.js";

describe("talktollmSetupAdapter", () => {
  beforeEach(() => {
    // Clean up connections from previous tests
    for (const id of getConnectedDeviceIds()) {
      unregisterConnection(id);
    }
  });

  describe("applyAccountConfig", () => {
    it("sets deviceId from input.token", () => {
      const cfg = { channels: {} } as OpenClawConfig;
      const result = talktollmSetupAdapter.applyAccountConfig({
        cfg,
        accountId: "default",
        input: { token: "device-123" },
      });

      const talktollm = (result.channels as Record<string, any>).talktollm;
      expect(talktollm.deviceId).toBe("device-123");
    });

    it("sets APNs token from input.pushToken", () => {
      const cfg = { channels: {} } as OpenClawConfig;
      const result = talktollmSetupAdapter.applyAccountConfig({
        cfg,
        accountId: "default",
        input: { token: "device-123", pushToken: "apns-hex-token" },
      });

      const talktollm = (result.channels as Record<string, any>).talktollm;
      expect(talktollm.apnsToken).toBe("apns-hex-token");
    });

    it("sets APNs topic from input.pushTopic", () => {
      const cfg = { channels: {} } as OpenClawConfig;
      const result = talktollmSetupAdapter.applyAccountConfig({
        cfg,
        accountId: "default",
        input: { token: "device-123", pushTopic: "com.example.app" },
      });

      const talktollm = (result.channels as Record<string, any>).talktollm;
      expect(talktollm.apnsTopic).toBe("com.example.app");
    });

    it("sets APNs environment from input.pushEnvironment", () => {
      const cfg = { channels: {} } as OpenClawConfig;
      const result = talktollmSetupAdapter.applyAccountConfig({
        cfg,
        accountId: "default",
        input: { token: "device-123", pushEnvironment: "production" },
      });

      const talktollm = (result.channels as Record<string, any>).talktollm;
      expect(talktollm.apnsEnvironment).toBe("production");
    });

    it("registers device when deviceOnline=true", () => {
      const cfg = { channels: {} } as OpenClawConfig;
      talktollmSetupAdapter.applyAccountConfig({
        cfg,
        accountId: "default",
        input: { token: "device-online", deviceOnline: true },
      });

      expect(isDeviceConnected("device-online")).toBe(true);
    });

    it("unregisters device when deviceOnline=false", () => {
      // First register
      registerConnection("device-offline");
      expect(isDeviceConnected("device-offline")).toBe(true);

      const cfg = { channels: {} } as OpenClawConfig;
      talktollmSetupAdapter.applyAccountConfig({
        cfg,
        accountId: "default",
        input: { token: "device-offline", deviceOnline: false },
      });

      expect(isDeviceConnected("device-offline")).toBe(false);
    });

    it("merges with existing config", () => {
      const cfg = {
        channels: {
          talktollm: {
            existingField: "preserved",
            enabled: true,
          },
        },
      } as OpenClawConfig;

      const result = talktollmSetupAdapter.applyAccountConfig({
        cfg,
        accountId: "default",
        input: { token: "new-device" },
      });

      const talktollm = (result.channels as Record<string, any>).talktollm;
      expect(talktollm.existingField).toBe("preserved");
      expect(talktollm.deviceId).toBe("new-device");
      expect(talktollm.enabled).toBe(true); // overwritten by updates
    });

    it("writes to named account when accountId != default", () => {
      const cfg = { channels: {} } as OpenClawConfig;
      const result = talktollmSetupAdapter.applyAccountConfig({
        cfg,
        accountId: "my-device",
        input: { token: "device-xyz" },
      });

      const talktollm = (result.channels as Record<string, any>).talktollm;
      expect(talktollm.accounts).toBeDefined();
      expect(talktollm.accounts["my-device"]).toBeDefined();
      expect(talktollm.accounts["my-device"].deviceId).toBe("device-xyz");
    });

    it("accepts RPC-style naming conventions", () => {
      const cfg = { channels: {} } as OpenClawConfig;
      const result = talktollmSetupAdapter.applyAccountConfig({
        cfg,
        accountId: "default",
        input: {
          token: "device-123",
          topic: "com.example.app",
          environment: "sandbox",
        },
      });

      const talktollm = (result.channels as Record<string, any>).talktollm;
      expect(talktollm.apnsTopic).toBe("com.example.app");
      expect(talktollm.apnsEnvironment).toBe("sandbox");
    });
  });
});
