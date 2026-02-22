import type { ChannelGatewayAdapter } from "openclaw/plugin-sdk";
import type { ResolvedTalktollmAccount } from "./config.js";
import { isWsClientConnected, getWsConnectedDeviceIds } from "./ws-server.js";

/**
 * Module-level registry of active device connections.
 *
 * Maps deviceId → connection metadata. The outbound adapter reads this
 * to decide whether to deliver via WebSocket (device connected) or
 * APNs push (device offline).
 *
 * Follows the same pattern as Discord's gateway registry.
 */
export type TalktollmConnection = {
  deviceId: string;
  connectedAt: number;
};

const activeConnections = new Map<string, TalktollmConnection>();

export function getActiveConnection(deviceId: string): TalktollmConnection | undefined {
  return activeConnections.get(deviceId);
}

export function isDeviceConnected(deviceId: string): boolean {
  return activeConnections.has(deviceId) || isWsClientConnected(deviceId);
}

export function registerConnection(deviceId: string): TalktollmConnection {
  const conn: TalktollmConnection = {
    deviceId,
    connectedAt: Date.now(),
  };
  activeConnections.set(deviceId, conn);
  return conn;
}

export function unregisterConnection(deviceId: string): void {
  activeConnections.delete(deviceId);
}

export function getConnectedDeviceIds(): string[] {
  const gatewayDevices = [...activeConnections.keys()];
  const wsDevices = getWsConnectedDeviceIds();
  return [...new Set([...gatewayDevices, ...wsDevices])];
}

export const talktollmGatewayAdapter: ChannelGatewayAdapter<ResolvedTalktollmAccount> = {
  startAccount: async (ctx) => {
    const account = ctx.account;
    const deviceId = account.config.deviceId;

    ctx.log?.info(`[${account.accountId}] starting talktollm channel`);

    // Device connectivity is tracked separately — the iOS app notifies
    // via a setup RPC when its WebSocket handshake completes.
    // Do NOT register the device as connected here; startAccount only
    // means the channel account is running, not that a device is online.
    ctx.setStatus({
      accountId: account.accountId,
      running: true,
      lastStartAt: Date.now(),
    });
    ctx.log?.info(`[${account.accountId}] started (device=${deviceId ?? "none"})`);

    // The iOS app connects via the existing WebSocket gateway infrastructure.
    // Messages are routed through the gateway's RPC methods (chat.send, agent.request).
    // Session keys are passed explicitly by the iOS app, enabling cross-client
    // session sharing (same session from CLI, iOS, macOS).
    //
    // This adapter's primary role is tracking device connectivity for the
    // outbound adapter (WebSocket vs APNs delivery decision).

    // Wait for abort signal (keeps the account "running" until stopped)
    return new Promise<void>((resolve) => {
      ctx.abortSignal.addEventListener("abort", () => {
        if (deviceId) {
          unregisterConnection(deviceId);
        }
        ctx.setStatus({
          accountId: account.accountId,
          running: false,
          lastStopAt: Date.now(),
        });
        ctx.log?.info(`[${account.accountId}] stopped`);
        resolve();
      });
    });
  },
};
