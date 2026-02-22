import { randomUUID } from "node:crypto";
import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { WebSocket } from "ws";
import {
  loadApnsRegistration,
  resolveApnsAuthConfigFromEnv,
  sendApnsAlert,
  type ApnsEnvironment,
  type ApnsRegistration,
} from "../../../src/infra/push-apns.js";
import { isDeviceConnected } from "./gateway.js";
import { getTalktollmRuntime } from "./runtime.js";
import { getSessionsForDevice } from "./session-registry.js";
import { getConnectedClient } from "./ws-server.js";

/**
 * Maximum size for message text included in the APNs custom payload.
 * APNs has a 4 KB total payload limit; keep text well under that.
 */
const MAX_PAYLOAD_TEXT_LENGTH = 2000;

/**
 * Outbound adapter for the talktollm channel.
 *
 * Delivers agent responses to the iOS app via APNs push notifications.
 * Every outbound message gets a stable UUID (messageId) included in the
 * push payload for client-side deduplication.
 *
 * For MVP, APNs is always attempted regardless of WebSocket connectivity.
 * The iOS app deduplicates messages it already received over WebSocket
 * using the messageId.
 */
export const talktollmOutboundAdapter: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  textChunkLimit: 4096,

  sendText: async ({ to, text }) => {
    const messageId = randomUUID();
    const deviceId = to;
    const runtime = getTalktollmRuntime();
    const logger = runtime.logging.getChildLogger({ channel: "talktollm" });

    // Resolve session key from the registry; fall back to deviceId
    // when the registry has no mapping (e.g. device never sent a message).
    const sessions = getSessionsForDevice(deviceId);
    const sessionKey = sessions.length > 0 ? sessions[0]! : deviceId;

    // Try plugin WebSocket delivery first
    const wsClient = getConnectedClient(deviceId);
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(
        JSON.stringify({
          type: "agentText",
          sessionKey,
          text,
          messageId,
        }),
      );
      wsClient.send(
        JSON.stringify({
          type: "agentDone",
          sessionKey,
          messageId,
        }),
      );
      logger.info(`[talktollm] WS delivered messageId=${messageId} device=${deviceId}`);
      return {
        channel: "talktollm" as const,
        messageId,
        chatId: deviceId,
        timestamp: Date.now(),
      };
    }

    // Try to load APNs registration from the push-apns infrastructure.
    // This is populated by the gateway when the iOS app sends `push.apns.register`.
    let registration: ApnsRegistration | null = null;
    try {
      registration = await loadApnsRegistration(deviceId);
    } catch {
      // Registration lookup failed — fall through to config-based fallback
    }

    // Fallback: read APNs token from channel config (for backwards compatibility)
    if (!registration) {
      const cfg = runtime.config.loadConfig();
      const section = (cfg.channels as Record<string, unknown> | undefined)?.talktollm as
        | Record<string, unknown>
        | undefined;
      const apnsToken = (section?.apnsToken as string) ?? undefined;
      const apnsTopic = (section?.apnsTopic as string) ?? undefined;
      const apnsEnvironment = ((section?.apnsEnvironment as string) ??
        "sandbox") as ApnsEnvironment;

      if (apnsToken && apnsTopic) {
        registration = {
          nodeId: deviceId,
          token: apnsToken,
          topic: apnsTopic,
          environment: apnsEnvironment,
          updatedAtMs: Date.now(),
        };
      }
    }

    if (!registration) {
      logger.info(
        `[talktollm] no APNs registration found for device=${deviceId}, skipping push messageId=${messageId}`,
      );
      return {
        channel: "talktollm" as const,
        messageId,
        chatId: deviceId,
        timestamp: Date.now(),
      };
    }

    // Resolve APNs auth from environment variables
    const authResult = await resolveApnsAuthConfigFromEnv();
    if (!authResult.ok) {
      logger.warn(
        `[talktollm] APNs auth not configured: ${authResult.error} — message ${messageId} not pushed`,
      );
      return {
        channel: "talktollm" as const,
        messageId,
        chatId: deviceId,
        timestamp: Date.now(),
      };
    }

    // Truncate text for the APNs body to stay within 4 KB payload limit
    const payloadText =
      text.length > MAX_PAYLOAD_TEXT_LENGTH ? text.slice(0, MAX_PAYLOAD_TEXT_LENGTH) : text;

    try {
      const result = await sendApnsAlert({
        auth: authResult.value,
        registration,
        nodeId: `talktollm|${sessionKey}|${messageId}`,
        title: "New message",
        body: payloadText,
      });

      if (result.ok) {
        logger.info(
          `[talktollm] APNs delivered messageId=${messageId} device=${deviceId} apnsId=${result.apnsId}`,
        );
      } else {
        logger.warn(
          `[talktollm] APNs failed messageId=${messageId} status=${result.status} reason=${result.reason}`,
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[talktollm] APNs error messageId=${messageId}: ${errMsg}`);
    }

    return {
      channel: "talktollm" as const,
      messageId,
      chatId: deviceId,
      timestamp: Date.now(),
    };
  },
};
