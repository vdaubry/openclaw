import { describe, expect, it, beforeEach } from "vitest";
import {
  registerDeviceSession,
  unregisterDevice,
  getDevicesForSession,
  getSessionsForDevice,
  clearSessionRegistry,
} from "./session-registry.js";

describe("session-registry", () => {
  beforeEach(() => {
    clearSessionRegistry();
  });

  it("registers a single device-session pair and looks up both directions", () => {
    registerDeviceSession("device-1", "agent:main:main");

    expect(getDevicesForSession("agent:main:main")).toEqual(["device-1"]);
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

  it("registers multiple devices per session", () => {
    registerDeviceSession("device-1", "agent:main:main");
    registerDeviceSession("device-2", "agent:main:main");

    const devices = getDevicesForSession("agent:main:main");
    expect(devices).toHaveLength(2);
    expect(devices).toContain("device-1");
    expect(devices).toContain("device-2");
  });

  it("unregisterDevice cleans up all session mappings for that device", () => {
    registerDeviceSession("device-1", "agent:main:main");
    registerDeviceSession("device-1", "agent:main:test");

    unregisterDevice("device-1");

    expect(getSessionsForDevice("device-1")).toEqual([]);
    expect(getDevicesForSession("agent:main:main")).toEqual([]);
    expect(getDevicesForSession("agent:main:test")).toEqual([]);
  });

  it("unregisterDevice does not affect other devices on same session", () => {
    registerDeviceSession("device-1", "agent:main:main");
    registerDeviceSession("device-2", "agent:main:main");

    unregisterDevice("device-1");

    expect(getDevicesForSession("agent:main:main")).toEqual(["device-2"]);
    expect(getSessionsForDevice("device-2")).toEqual(["agent:main:main"]);
  });

  it("duplicate registration is idempotent", () => {
    registerDeviceSession("device-1", "agent:main:main");
    registerDeviceSession("device-1", "agent:main:main");
    registerDeviceSession("device-1", "agent:main:main");

    expect(getDevicesForSession("agent:main:main")).toEqual(["device-1"]);
    expect(getSessionsForDevice("device-1")).toEqual(["agent:main:main"]);
  });

  it("returns empty arrays for unknown lookups", () => {
    expect(getDevicesForSession("agent:unknown:session")).toEqual([]);
    expect(getSessionsForDevice("unknown-device")).toEqual([]);
  });

  it("unregisterDevice is a no-op for unknown device", () => {
    registerDeviceSession("device-1", "agent:main:main");

    // Should not throw
    unregisterDevice("unknown-device");

    // Existing data should be unaffected
    expect(getDevicesForSession("agent:main:main")).toEqual(["device-1"]);
  });
});
