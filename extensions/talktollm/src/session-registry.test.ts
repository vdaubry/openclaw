import { describe, expect, it, beforeEach } from "vitest";
import {
  registerDeviceSession,
  unregisterDevice,
  getSessionsForDevice,
  clearSessionRegistry,
} from "./session-registry.js";

describe("session-registry", () => {
  beforeEach(() => {
    clearSessionRegistry();
  });

  it("registers a single device-session pair", () => {
    registerDeviceSession("device-1", "agent:main:main");

    expect(getSessionsForDevice("device-1")).toEqual(["agent:main:main"]);
  });

  it("registers multiple sessions per device", () => {
    registerDeviceSession("device-1", "agent:main:main");
    registerDeviceSession("device-1", "agent:main:test");

    const sessions = getSessionsForDevice("device-1");
    expect(sessions).toHaveLength(2);
    expect(sessions).toContain("agent:main:main");
    expect(sessions).toContain("agent:main:test");
  });

  it("unregisterDevice cleans up all session mappings for that device", () => {
    registerDeviceSession("device-1", "agent:main:main");
    registerDeviceSession("device-1", "agent:main:test");

    unregisterDevice("device-1");

    expect(getSessionsForDevice("device-1")).toEqual([]);
  });

  it("unregisterDevice does not affect other devices on same session", () => {
    registerDeviceSession("device-1", "agent:main:main");
    registerDeviceSession("device-2", "agent:main:main");

    unregisterDevice("device-1");

    expect(getSessionsForDevice("device-2")).toEqual(["agent:main:main"]);
  });

  it("duplicate registration is idempotent", () => {
    registerDeviceSession("device-1", "agent:main:main");
    registerDeviceSession("device-1", "agent:main:main");
    registerDeviceSession("device-1", "agent:main:main");

    expect(getSessionsForDevice("device-1")).toEqual(["agent:main:main"]);
  });

  it("returns empty array for unknown device", () => {
    expect(getSessionsForDevice("unknown-device")).toEqual([]);
  });

  it("unregisterDevice is a no-op for unknown device", () => {
    registerDeviceSession("device-1", "agent:main:main");

    // Should not throw
    unregisterDevice("unknown-device");

    // Existing data should be unaffected
    expect(getSessionsForDevice("device-1")).toEqual(["agent:main:main"]);
  });
});
