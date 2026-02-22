/**
 * Agent Event Listener — subscribes to agent events for proactive message delivery.
 *
 * When the agent sends a message outside of a request–response dispatch cycle
 * (e.g. a scheduled/proactive message), this listener forwards the text to
 * all connected devices for the relevant session via WebSocket.
 *
 * Events whose runId is tracked as an active dispatch (via ws-handler) are
 * skipped to avoid double-delivery with the request–response path.
 */

import crypto from "node:crypto";
import { WebSocket } from "ws";
import { resolveAssistantStreamDeltaText } from "../../../src/gateway/agent-event-assistant-text.js";
import { onAgentEvent } from "../../../src/infra/agent-events.js";
import { getTalktollmRuntime } from "./runtime.js";
import { getDevicesForSession } from "./session-registry.js";
import { getConnectedClient } from "./ws-server.js";

/** Run IDs that are currently being handled by ws-handler (request–response path). */
const activeDispatchRunIds = new Set<string>();

/** Message IDs that have already been delivered by this listener. */
const deliveredMessageIds = new Set<string>();

/** Per-runId buffer: tracks messageId for agentDone framing. */
const runBuffers = new Map<string, { messageId: string }>();

/** Unsubscribe function returned by onAgentEvent */
let unsubscribe: (() => void) | null = null;

// ── Dispatch tracking (called by ws-handler) ──────────────────────────

export function markDispatchActive(runId: string): void {
  activeDispatchRunIds.add(runId);
}

export function markDispatchComplete(runId: string): void {
  activeDispatchRunIds.delete(runId);
}

// ── Delivered message tracking (used by outbound adapter) ─────────────

export function isMessageDelivered(messageId: string): boolean {
  return deliveredMessageIds.has(messageId);
}

// ── Listener lifecycle ────────────────────────────────────────────────

export function startAgentEventListener(): void {
  if (unsubscribe) return; // already running

  const logger = getTalktollmRuntime().logging.getChildLogger({ channel: "talktollm-events" });

  unsubscribe = onAgentEvent((evt) => {
    // Skip events from active request–response dispatches
    if (activeDispatchRunIds.has(evt.runId)) {
      logger.info(
        `[talktollm-events] skipping event runId=${evt.runId} seq=${evt.seq} (active dispatch)`,
      );
      return;
    }

    const sessionKey = evt.sessionKey;
    if (!sessionKey) {
      logger.info(
        `[talktollm-events] skipping event runId=${evt.runId} seq=${evt.seq} stream=${evt.stream} (no sessionKey)`,
      );
      return;
    }

    // Find connected devices for this session
    const deviceIds = getDevicesForSession(sessionKey);
    if (deviceIds.length === 0) {
      logger.info(
        `[talktollm-events] skipping event for session=${sessionKey} (no connected devices)`,
      );
      return;
    }

    logger.info(
      `[talktollm-events] processing event runId=${evt.runId} seq=${evt.seq} stream=${evt.stream} session=${sessionKey} devices=${deviceIds.length}`,
    );

    // Handle assistant text deltas
    if (evt.stream === "assistant") {
      const text = resolveAssistantStreamDeltaText(evt);
      if (!text) return;

      // Ensure we have a buffer entry with a messageId for this run
      let buf = runBuffers.get(evt.runId);
      if (!buf) {
        buf = { messageId: crypto.randomUUID() };
        runBuffers.set(evt.runId, buf);
        logger.info(
          `[talktollm-events] new proactive run=${evt.runId} session=${sessionKey} messageId=${buf.messageId}`,
        );
      }

      // Forward agentText to all connected devices
      for (const deviceId of deviceIds) {
        sendToDevice(deviceId, {
          type: "agentText",
          sessionKey,
          text,
          messageId: buf.messageId,
        });
      }
      return;
    }

    // Handle lifecycle end/error — send agentDone and clean up
    if (evt.stream === "lifecycle") {
      const phase = evt.data.phase;
      if (phase !== "end" && phase !== "error") return;

      const buf = runBuffers.get(evt.runId);
      if (!buf) return; // No text was buffered for this run

      logger.info(
        `[talktollm-events] run complete runId=${evt.runId} phase=${phase} messageId=${buf.messageId}`,
      );

      // Track as delivered to prevent outbound adapter double-delivery
      deliveredMessageIds.add(buf.messageId);

      for (const deviceId of deviceIds) {
        sendToDevice(deviceId, {
          type: "agentDone",
          sessionKey,
          messageId: buf.messageId,
        });
      }

      runBuffers.delete(evt.runId);

      // Prune old delivered IDs (keep last 1000)
      if (deliveredMessageIds.size > 1000) {
        const entries = [...deliveredMessageIds];
        for (let i = 0; i < entries.length - 1000; i++) {
          deliveredMessageIds.delete(entries[i]!);
        }
      }
    }
  });

  logger.info("[talktollm-events] agent event listener started");
}

export function stopAgentEventListener(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  activeDispatchRunIds.clear();
  deliveredMessageIds.clear();
  runBuffers.clear();
}

// ── Helpers ───────────────────────────────────────────────────────────

function sendToDevice(deviceId: string, frame: Record<string, unknown>): void {
  const ws = getConnectedClient(deviceId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}
