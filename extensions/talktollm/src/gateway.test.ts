import { describe, expect, it, beforeEach } from "vitest";
import {
  registerConnection,
  unregisterConnection,
  isDeviceConnected,
  getActiveConnection,
  getConnectedDeviceIds,
} from "./gateway.js";

describe("gateway connection registry", () => {
  beforeEach(() => {
    // Clean up any connections from previous tests
    for (const id of getConnectedDeviceIds()) {
      unregisterConnection(id);
    }
  });

  describe("registerConnection", () => {
    it("registers a device connection", () => {
      const conn = registerConnection("device-abc");
      expect(conn.deviceId).toBe("device-abc");
      expect(conn.connectedAt).toBeGreaterThan(0);
    });

    it("makes device appear as connected", () => {
      registerConnection("device-abc");
      expect(isDeviceConnected("device-abc")).toBe(true);
    });
  });

  describe("unregisterConnection", () => {
    it("removes a device connection", () => {
      registerConnection("device-abc");
      unregisterConnection("device-abc");
      expect(isDeviceConnected("device-abc")).toBe(false);
    });

    it("does not throw for unknown device", () => {
      expect(() => unregisterConnection("unknown")).not.toThrow();
    });
  });

  describe("isDeviceConnected", () => {
    it("returns false for unknown device", () => {
      expect(isDeviceConnected("unknown")).toBe(false);
    });

    it("returns true for registered device", () => {
      registerConnection("device-abc");
      expect(isDeviceConnected("device-abc")).toBe(true);
    });
  });

  describe("getActiveConnection", () => {
    it("returns undefined for unknown device", () => {
      expect(getActiveConnection("unknown")).toBeUndefined();
    });

    it("returns connection for registered device", () => {
      registerConnection("device-abc");
      const conn = getActiveConnection("device-abc");
      expect(conn).toBeDefined();
      expect(conn?.deviceId).toBe("device-abc");
    });
  });

  describe("getConnectedDeviceIds", () => {
    it("returns empty array when no devices connected", () => {
      expect(getConnectedDeviceIds()).toEqual([]);
    });

    it("returns all connected device IDs", () => {
      registerConnection("device-1");
      registerConnection("device-2");
      const ids = getConnectedDeviceIds();
      expect(ids).toContain("device-1");
      expect(ids).toContain("device-2");
      expect(ids).toHaveLength(2);
    });
  });
});
