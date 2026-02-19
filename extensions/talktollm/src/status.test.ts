import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { ResolvedTalktollmAccount } from "./config.js";
import { registerConnection, unregisterConnection, getConnectedDeviceIds } from "./gateway.js";
import { talktollmStatusAdapter } from "./status.js";

describe("talktollmStatusAdapter", () => {
  beforeEach(() => {
    for (const id of getConnectedDeviceIds()) {
      unregisterConnection(id);
    }
  });

  describe("defaultRuntime", () => {
    it("has default account ID", () => {
      expect(talktollmStatusAdapter.defaultRuntime).toBeDefined();
      // defaultRuntime is created with DEFAULT_ACCOUNT_ID
      const runtime = talktollmStatusAdapter.defaultRuntime;
      expect(runtime).toBeDefined();
    });
  });

  describe("buildAccountSnapshot", () => {
    const baseAccount: ResolvedTalktollmAccount = {
      accountId: "default",
      name: "Test Device",
      enabled: true,
      configured: true,
      config: {
        deviceId: "device-abc",
      },
    };

    it("returns correct fields", () => {
      const snapshot = talktollmStatusAdapter.buildAccountSnapshot!({
        account: baseAccount,
        runtime: null as any,
      });

      expect(snapshot.accountId).toBe("default");
      expect(snapshot.name).toBe("Test Device");
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.configured).toBe(true);
    });

    it("connected=true when device registered", () => {
      registerConnection("device-abc");

      const snapshot = talktollmStatusAdapter.buildAccountSnapshot!({
        account: baseAccount,
        runtime: null as any,
      });

      expect(snapshot.connected).toBe(true);
    });

    it("connected=false when device not registered", () => {
      const snapshot = talktollmStatusAdapter.buildAccountSnapshot!({
        account: baseAccount,
        runtime: null as any,
      });

      expect(snapshot.connected).toBe(false);
    });

    it("connected=false when no deviceId configured", () => {
      const accountWithoutDevice: ResolvedTalktollmAccount = {
        ...baseAccount,
        config: {},
      };

      const snapshot = talktollmStatusAdapter.buildAccountSnapshot!({
        account: accountWithoutDevice,
        runtime: null as any,
      });

      expect(snapshot.connected).toBe(false);
    });

    it("uses runtime state for running/lastStart/lastStop", () => {
      const mockRuntime = {
        running: true,
        lastStartAt: 1700000000,
        lastStopAt: 1699000000,
        lastError: null,
        lastInboundAt: null,
        lastOutboundAt: null,
      };

      const snapshot = talktollmStatusAdapter.buildAccountSnapshot!({
        account: baseAccount,
        runtime: mockRuntime as any,
      });

      expect(snapshot.running).toBe(true);
      expect(snapshot.lastStartAt).toBe(1700000000);
      expect(snapshot.lastStopAt).toBe(1699000000);
    });

    it("defaults runtime fields when runtime is null", () => {
      const snapshot = talktollmStatusAdapter.buildAccountSnapshot!({
        account: baseAccount,
        runtime: null as any,
      });

      expect(snapshot.running).toBe(false);
      expect(snapshot.lastStartAt).toBeNull();
      expect(snapshot.lastStopAt).toBeNull();
      expect(snapshot.lastError).toBeNull();
    });
  });
});
