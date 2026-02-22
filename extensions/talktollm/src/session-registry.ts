/**
 * Session Registry — bidirectional mapping between deviceId and sessionKey.
 *
 * - **deviceId**: delivery target (e.g. "openclaw-ios") — identifies WHERE to send
 * - **sessionKey**: conversation context (e.g. "agent:main:main") — identifies WHICH conversation
 *
 * A single device may participate in multiple sessions, and a single session
 * may have multiple connected devices.
 */

/** deviceId -> Set<sessionKey> */
const deviceToSessions = new Map<string, Set<string>>();

/** sessionKey -> Set<deviceId> */
const sessionToDevices = new Map<string, Set<string>>();

/**
 * Register a device–session pair. Called when a device sends a message.
 * Duplicate registrations are idempotent.
 */
export function registerDeviceSession(deviceId: string, sessionKey: string): void {
  let sessions = deviceToSessions.get(deviceId);
  if (!sessions) {
    sessions = new Set();
    deviceToSessions.set(deviceId, sessions);
  }
  sessions.add(sessionKey);

  let devices = sessionToDevices.get(sessionKey);
  if (!devices) {
    devices = new Set();
    sessionToDevices.set(sessionKey, devices);
  }
  devices.add(deviceId);
}

/**
 * Unregister a device, removing all its session mappings.
 * Called on WebSocket disconnect.
 */
export function unregisterDevice(deviceId: string): void {
  const sessions = deviceToSessions.get(deviceId);
  if (!sessions) return;

  for (const sessionKey of sessions) {
    const devices = sessionToDevices.get(sessionKey);
    if (devices) {
      devices.delete(deviceId);
      if (devices.size === 0) {
        sessionToDevices.delete(sessionKey);
      }
    }
  }

  deviceToSessions.delete(deviceId);
}

/**
 * Get all device IDs connected to a given session.
 */
export function getDevicesForSession(sessionKey: string): string[] {
  const devices = sessionToDevices.get(sessionKey);
  return devices ? [...devices] : [];
}

/**
 * Get all session keys for a given device.
 */
export function getSessionsForDevice(deviceId: string): string[] {
  const sessions = deviceToSessions.get(deviceId);
  return sessions ? [...sessions] : [];
}

/**
 * Clear all mappings. Useful for tests and server shutdown.
 */
export function clearSessionRegistry(): void {
  deviceToSessions.clear();
  sessionToDevices.clear();
}
