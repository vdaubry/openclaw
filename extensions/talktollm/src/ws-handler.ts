import crypto from "node:crypto";
import { WebSocket } from "ws";
import { resolveSessionAgentId } from "../../../src/agents/agent-scope.js";
import { dispatchInboundMessage } from "../../../src/auto-reply/dispatch.js";
import { createReplyDispatcher } from "../../../src/auto-reply/reply/reply-dispatcher.js";
import type { MsgContext } from "../../../src/auto-reply/templating.js";
import { createReplyPrefixOptions } from "../../../src/channels/reply-prefix.js";
import {
  injectTimestamp,
  timestampOptsFromConfig,
} from "../../../src/gateway/server-methods/agent-timestamp.js";
import { registerApnsToken } from "../../../src/infra/push-apns.js";
import { getTalktollmRuntime } from "./runtime.js";
import { registerDeviceSession } from "./session-registry.js";

const SESSION_KEY_RE = /^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/;

/** Idempotency deduplication map: idempotencyKey -> expiration timestamp */
const recentKeys = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Periodic cleanup of expired idempotency entries
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of recentKeys) {
    if (now >= expiresAt) {
      recentKeys.delete(key);
    }
  }
}, 60_000);
cleanupInterval.unref();

function sendFrame(ws: WebSocket, frame: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

export function handleWsMessage(ws: WebSocket, deviceId: string, raw: string): void {
  const logger = getTalktollmRuntime().logging.getChildLogger({ channel: "talktollm-ws" });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendFrame(ws, { type: "error", message: "invalid JSON" });
    return;
  }

  // Handle ping
  if (parsed.type === "ping") {
    sendFrame(ws, { type: "pong" });
    return;
  }

  // Handle push token registration
  if (parsed.type === "push.register") {
    const token = typeof parsed.token === "string" ? parsed.token : "";
    const topic = typeof parsed.topic === "string" ? parsed.topic : "";
    if (!token || !topic) {
      sendFrame(ws, { type: "error", message: "push.register requires token and topic" });
      return;
    }
    const environment = typeof parsed.environment === "string" ? parsed.environment : undefined;
    registerApnsToken({ nodeId: deviceId, token, topic, environment })
      .then(() => {
        logger.info(`APNs token registered for deviceId=${deviceId}`);
        sendFrame(ws, { type: "push.registered" });
      })
      .catch((err) => {
        logger.error(`Failed to register APNs token: ${err}`);
        sendFrame(ws, { type: "error", message: `push.register failed: ${err}` });
      });
    return;
  }

  // Only handle "message" type from here
  if (parsed.type !== "message") {
    sendFrame(ws, { type: "error", message: `unknown message type: ${parsed.type}` });
    return;
  }

  // Validate sessionKey
  const rawSessionKey = parsed.sessionKey;
  if (!rawSessionKey || typeof rawSessionKey !== "string") {
    sendFrame(ws, { type: "error", message: "sessionKey is required" });
    return;
  }
  const sessionKey = rawSessionKey.trim();
  if (!SESSION_KEY_RE.test(sessionKey)) {
    sendFrame(ws, {
      type: "error",
      message: "Invalid sessionKey format. Expected: agent:<name>:<conversation>",
    });
    return;
  }

  // Validate text
  const rawText = parsed.text;
  if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
    sendFrame(ws, { type: "error", message: "text is required" });
    return;
  }
  const text = rawText.trim();

  const rawIdempotencyKey = parsed.idempotencyKey;
  const idempotencyKey =
    typeof rawIdempotencyKey === "string" && rawIdempotencyKey.trim()
      ? rawIdempotencyKey.trim()
      : crypto.randomUUID();

  // Idempotency check
  if (typeof rawIdempotencyKey === "string" && rawIdempotencyKey.trim()) {
    const expiresAt = recentKeys.get(idempotencyKey);
    if (expiresAt && Date.now() < expiresAt) {
      sendFrame(ws, { type: "ack", idempotencyKey, status: "duplicate" });
      return;
    }
  }

  // Record idempotency key
  recentKeys.set(idempotencyKey, Date.now() + IDEMPOTENCY_TTL_MS);

  // Track which sessions this device is using
  registerDeviceSession(deviceId, sessionKey);

  // Send ack immediately
  sendFrame(ws, { type: "ack", idempotencyKey, status: "started" });

  // Dispatch to the agent
  const runtime = getTalktollmRuntime();
  const cfg = runtime.config.loadConfig();
  const stampedMessage = injectTimestamp(text, timestampOptsFromConfig(cfg));

  const ctx: MsgContext = {
    Body: text,
    BodyForAgent: stampedMessage,
    BodyForCommands: text,
    RawBody: text,
    CommandBody: text,
    SessionKey: sessionKey,
    Provider: "talktollm",
    Surface: "talktollm",
    OriginatingChannel: "talktollm",
    ChatType: "direct",
    CommandAuthorized: true,
    MessageSid: idempotencyKey,
  };

  const messageId = crypto.randomUUID();
  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg,
    agentId,
    channel: "talktollm",
  });

  // Send typing indicator
  sendFrame(ws, { type: "typing", sessionKey, isTyping: true });

  const dispatcher = createReplyDispatcher({
    ...prefixOptions,
    onError: (err) => {
      logger.warn(`[talktollm-ws] dispatch error: ${err}`);
      sendFrame(ws, { type: "error", message: String(err) });
      sendFrame(ws, { type: "typing", sessionKey, isTyping: false });
      sendFrame(ws, { type: "agentDone", sessionKey, messageId });
    },
    deliver: async (chunk) => {
      sendFrame(ws, {
        type: "agentText",
        sessionKey,
        text: typeof chunk === "string" ? chunk : chunk.text,
        messageId,
      });
    },
  });

  void dispatchInboundMessage({
    ctx,
    cfg,
    dispatcher,
    replyOptions: { runId: idempotencyKey, onModelSelected },
  })
    .then(() => {
      sendFrame(ws, { type: "typing", sessionKey, isTyping: false });
      sendFrame(ws, { type: "agentDone", sessionKey, messageId });
    })
    .catch((err) => {
      logger.error(`[talktollm-ws] dispatch failed: ${err}`);
      sendFrame(ws, { type: "error", message: "dispatch failed" });
      sendFrame(ws, { type: "typing", sessionKey, isTyping: false });
      sendFrame(ws, { type: "agentDone", sessionKey, messageId });
    });
}
