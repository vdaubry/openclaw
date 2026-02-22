import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AgentEventPayload } from "../../../src/infra/agent-events.js";

// ── Hoisted mocks ──────────────────────────────────────────────────────

// Listeners registry — kept outside the hoisted block so emitAgentEvent can access it
const agentEventListeners: Array<(evt: AgentEventPayload) => void> = [];

const { mockOnAgentEvent, mockGetConnectedClient } = vi.hoisted(() => ({
  mockOnAgentEvent: vi.fn(),
  mockGetConnectedClient: vi.fn().mockReturnValue(undefined),
}));

// Wire up the real implementation AFTER hoisting
mockOnAgentEvent.mockImplementation((listener: (evt: AgentEventPayload) => void) => {
  agentEventListeners.push(listener);
  return () => {
    const idx = agentEventListeners.indexOf(listener);
    if (idx >= 0) agentEventListeners.splice(idx, 1);
  };
});

// Helper: emit an event to all registered listeners
function emitAgentEvent(evt: AgentEventPayload) {
  for (const fn of [...agentEventListeners]) {
    fn(evt);
  }
}

vi.mock("../../../src/infra/agent-events.js", () => ({
  onAgentEvent: mockOnAgentEvent,
}));

vi.mock("../../../src/gateway/agent-event-assistant-text.js", () => ({
  resolveAssistantStreamDeltaText: (evt: AgentEventPayload) => {
    const delta = evt.data.delta;
    const text = evt.data.text;
    return typeof delta === "string" ? delta : typeof text === "string" ? text : "";
  },
}));

vi.mock("./ws-server.js", () => ({
  getConnectedClient: mockGetConnectedClient,
}));

vi.mock("./runtime.js", () => ({
  getTalktollmRuntime: () => ({
    logging: {
      getChildLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    },
  }),
}));

// Mock session-registry — we control device-session mapping per test
const mockGetDevicesForSession = vi.fn().mockReturnValue([]);
vi.mock("./session-registry.js", () => ({
  getDevicesForSession: (...args: unknown[]) => mockGetDevicesForSession(...args),
}));

import { WebSocket } from "ws";
import {
  startAgentEventListener,
  stopAgentEventListener,
  markDispatchActive,
  markDispatchComplete,
} from "./event-listener.js";

/** Creates a mock WebSocket */
function createMockWs(): WebSocket & { sentFrames: unknown[] } {
  const sent: unknown[] = [];
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn((data: string) => {
      sent.push(JSON.parse(data));
    }),
    sentFrames: sent,
  } as unknown as WebSocket & { sentFrames: unknown[] };
}

describe("event-listener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopAgentEventListener();
    agentEventListeners.length = 0;
    mockGetDevicesForSession.mockReturnValue([]);
    // Re-wire the implementation after clearAllMocks
    mockOnAgentEvent.mockImplementation((listener: (evt: AgentEventPayload) => void) => {
      agentEventListeners.push(listener);
      return () => {
        const idx = agentEventListeners.indexOf(listener);
        if (idx >= 0) agentEventListeners.splice(idx, 1);
      };
    });
  });

  afterEach(() => {
    stopAgentEventListener();
  });

  it("starts and subscribes to agent events", () => {
    startAgentEventListener();
    expect(mockOnAgentEvent).toHaveBeenCalledTimes(1);
  });

  it("skips events with runId in activeDispatchRunIds", () => {
    const ws = createMockWs();
    mockGetConnectedClient.mockReturnValue(ws);
    mockGetDevicesForSession.mockReturnValue(["device-1"]);

    startAgentEventListener();

    // Mark a dispatch as active
    markDispatchActive("run-123");

    emitAgentEvent({
      runId: "run-123",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Hello" },
      sessionKey: "agent:main:main",
    });

    // No frames should be sent (event was skipped)
    expect(ws.sentFrames).toHaveLength(0);

    markDispatchComplete("run-123");
  });

  it("skips events for sessions with no connected devices", () => {
    const ws = createMockWs();
    mockGetConnectedClient.mockReturnValue(ws);
    mockGetDevicesForSession.mockReturnValue([]);

    startAgentEventListener();

    emitAgentEvent({
      runId: "run-456",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Hello" },
      sessionKey: "agent:main:main",
    });

    expect(ws.sentFrames).toHaveLength(0);
  });

  it("sends agentText frame for assistant stream events", () => {
    const ws = createMockWs();
    mockGetConnectedClient.mockReturnValue(ws);
    mockGetDevicesForSession.mockReturnValue(["device-1"]);

    startAgentEventListener();

    emitAgentEvent({
      runId: "run-proactive",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Hello from agent" },
      sessionKey: "agent:main:main",
    });

    expect(ws.sentFrames).toHaveLength(1);
    const frame = ws.sentFrames[0] as Record<string, unknown>;
    expect(frame.type).toBe("agentText");
    expect(frame.sessionKey).toBe("agent:main:main");
    expect(frame.text).toBe("Hello from agent");
    expect(frame.messageId).toBeDefined();
  });

  it("sends agentDone frame on lifecycle end", () => {
    const ws = createMockWs();
    mockGetConnectedClient.mockReturnValue(ws);
    mockGetDevicesForSession.mockReturnValue(["device-1"]);

    startAgentEventListener();

    // First send an assistant event to create a buffer entry
    emitAgentEvent({
      runId: "run-done",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Some text" },
      sessionKey: "agent:main:main",
    });

    // Then lifecycle end
    emitAgentEvent({
      runId: "run-done",
      seq: 2,
      stream: "lifecycle",
      ts: Date.now(),
      data: { phase: "end" },
      sessionKey: "agent:main:main",
    });

    // Should have: agentText + agentDone
    expect(ws.sentFrames).toHaveLength(2);
    expect((ws.sentFrames[0] as Record<string, unknown>).type).toBe("agentText");
    expect((ws.sentFrames[1] as Record<string, unknown>).type).toBe("agentDone");

    // agentDone should have same messageId as agentText
    const textFrame = ws.sentFrames[0] as Record<string, unknown>;
    const doneFrame = ws.sentFrames[1] as Record<string, unknown>;
    expect(doneFrame.messageId).toBe(textFrame.messageId);
  });

  it("sends agentDone frame on lifecycle error", () => {
    const ws = createMockWs();
    mockGetConnectedClient.mockReturnValue(ws);
    mockGetDevicesForSession.mockReturnValue(["device-1"]);

    startAgentEventListener();

    emitAgentEvent({
      runId: "run-err",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Partial" },
      sessionKey: "agent:main:main",
    });

    emitAgentEvent({
      runId: "run-err",
      seq: 2,
      stream: "lifecycle",
      ts: Date.now(),
      data: { phase: "error" },
      sessionKey: "agent:main:main",
    });

    expect(ws.sentFrames).toHaveLength(2);
    expect((ws.sentFrames[1] as Record<string, unknown>).type).toBe("agentDone");
  });

  it("accumulates multiple assistant events and forwards each as individual agentText", () => {
    const ws = createMockWs();
    mockGetConnectedClient.mockReturnValue(ws);
    mockGetDevicesForSession.mockReturnValue(["device-1"]);

    startAgentEventListener();

    emitAgentEvent({
      runId: "run-multi",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "chunk1" },
      sessionKey: "agent:main:main",
    });

    emitAgentEvent({
      runId: "run-multi",
      seq: 2,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "chunk2" },
      sessionKey: "agent:main:main",
    });

    emitAgentEvent({
      runId: "run-multi",
      seq: 3,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "chunk3" },
      sessionKey: "agent:main:main",
    });

    expect(ws.sentFrames).toHaveLength(3);
    expect((ws.sentFrames[0] as Record<string, unknown>).text).toBe("chunk1");
    expect((ws.sentFrames[1] as Record<string, unknown>).text).toBe("chunk2");
    expect((ws.sentFrames[2] as Record<string, unknown>).text).toBe("chunk3");

    // All should share the same messageId
    const id = (ws.sentFrames[0] as Record<string, unknown>).messageId;
    expect((ws.sentFrames[1] as Record<string, unknown>).messageId).toBe(id);
    expect((ws.sentFrames[2] as Record<string, unknown>).messageId).toBe(id);
  });

  it("sends to all connected devices for a session", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    mockGetConnectedClient.mockImplementation((deviceId: string) => {
      if (deviceId === "device-1") return ws1;
      if (deviceId === "device-2") return ws2;
      return undefined;
    });
    mockGetDevicesForSession.mockReturnValue(["device-1", "device-2"]);

    startAgentEventListener();

    emitAgentEvent({
      runId: "run-multi-device",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "broadcast" },
      sessionKey: "agent:main:main",
    });

    expect(ws1.sentFrames).toHaveLength(1);
    expect(ws2.sentFrames).toHaveLength(1);
    expect((ws1.sentFrames[0] as Record<string, unknown>).text).toBe("broadcast");
    expect((ws2.sentFrames[0] as Record<string, unknown>).text).toBe("broadcast");
  });
});
