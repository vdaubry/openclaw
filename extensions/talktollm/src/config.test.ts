import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { describe, expect, it } from "vitest";
import { talktollmConfigAdapter } from "./config.js";

describe("talktollmConfigAdapter", () => {
  describe("listAccountIds", () => {
    it("returns empty array when no talktollm config", () => {
      const cfg = {} as OpenClawConfig;
      expect(talktollmConfigAdapter.listAccountIds(cfg)).toEqual([]);
    });

    it("returns default account when section exists without accounts", () => {
      const cfg = {
        channels: { talktollm: { enabled: true } },
      } as OpenClawConfig;
      expect(talktollmConfigAdapter.listAccountIds(cfg)).toEqual(["default"]);
    });

    it("returns account IDs from accounts sub-key", () => {
      const cfg = {
        channels: {
          talktollm: {
            accounts: {
              "device-1": { enabled: true },
              "device-2": { enabled: true },
            },
          },
        },
      } as OpenClawConfig;
      const ids = talktollmConfigAdapter.listAccountIds(cfg);
      expect(ids).toContain("device-1");
      expect(ids).toContain("device-2");
      expect(ids).toHaveLength(2);
    });
  });

  describe("resolveAccount", () => {
    it("resolves default account from top-level config", () => {
      const cfg = {
        channels: {
          talktollm: {
            enabled: true,
            deviceId: "abc123",
            apnsToken: "hex-token",
          },
        },
      } as OpenClawConfig;
      const account = talktollmConfigAdapter.resolveAccount(cfg);
      expect(account.accountId).toBe("default");
      expect(account.enabled).toBe(true);
      expect(account.configured).toBe(true);
      expect(account.config.deviceId).toBe("abc123");
      expect(account.config.apnsToken).toBe("hex-token");
    });

    it("resolves named account from accounts sub-key", () => {
      const cfg = {
        channels: {
          talktollm: {
            accounts: {
              "my-device": {
                enabled: true,
                deviceId: "xyz789",
                name: "My iPhone",
              },
            },
          },
        },
      } as OpenClawConfig;
      const account = talktollmConfigAdapter.resolveAccount(cfg, "my-device");
      expect(account.accountId).toBe("my-device");
      expect(account.name).toBe("My iPhone");
      expect(account.configured).toBe(true);
      expect(account.config.deviceId).toBe("xyz789");
    });

    it("returns unconfigured account when section is empty", () => {
      const cfg = {} as OpenClawConfig;
      const account = talktollmConfigAdapter.resolveAccount(cfg);
      expect(account.accountId).toBe("default");
      expect(account.configured).toBe(false);
      expect(account.config.deviceId).toBeUndefined();
    });
  });

  describe("isConfigured", () => {
    it("returns true when deviceId is set", () => {
      const account = {
        accountId: "default",
        enabled: true,
        configured: true,
        config: { deviceId: "abc123" },
      };
      expect(talktollmConfigAdapter.isConfigured?.(account, {} as OpenClawConfig)).toBe(true);
    });

    it("returns false when deviceId is missing", () => {
      const account = {
        accountId: "default",
        enabled: true,
        configured: false,
        config: {},
      };
      expect(talktollmConfigAdapter.isConfigured?.(account, {} as OpenClawConfig)).toBe(false);
    });
  });

  describe("describeAccount", () => {
    it("returns account description", () => {
      const account = {
        accountId: "default",
        name: "Test Device",
        enabled: true,
        configured: true,
        config: { deviceId: "abc123" },
      };
      const desc = talktollmConfigAdapter.describeAccount?.(account, {} as OpenClawConfig);
      expect(desc?.accountId).toBe("default");
      expect(desc?.name).toBe("Test Device");
      expect(desc?.enabled).toBe(true);
      expect(desc?.configured).toBe(true);
    });
  });
});
