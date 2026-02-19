import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock all external dependencies before imports
vi.mock("./runtime.js", () => ({
  getTalktollmRuntime: () => ({
    config: {
      loadConfig: () => ({
        gateway: { auth: { token: "test-token" } },
        channels: { talktollm: {} },
      }),
    },
    logging: {
      getChildLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    },
  }),
}));

vi.mock("../../../src/auto-reply/dispatch.js", () => ({
  dispatchInboundMessage: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../../src/agents/agent-scope.js", () => ({
  resolveSessionAgentId: vi.fn().mockReturnValue("main"),
}));
vi.mock("../../../src/channels/reply-prefix.js", () => ({
  createReplyPrefixOptions: vi.fn().mockReturnValue({ onModelSelected: vi.fn() }),
}));
vi.mock("../../../src/auto-reply/reply/reply-dispatcher.js", () => ({
  createReplyDispatcher: vi.fn().mockReturnValue({
    markComplete: vi.fn(),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("../../../src/gateway/server-methods/agent-timestamp.js", () => ({
  injectTimestamp: vi.fn((msg: string) => msg),
  timestampOptsFromConfig: vi.fn().mockReturnValue({}),
}));

import { WebSocket } from "ws";
import { dispatchInboundMessage } from "../../../src/auto-reply/dispatch.js";
import { handleWsMessage } from "./ws-handler.js";

/** Creates a mock WebSocket with a send spy */
function createMockWs(): WebSocket & { sentMessages: unknown[] } {
  const sent: unknown[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    send: vi.fn((data: string) => {
      sent.push(JSON.parse(data));
    }),
    sentMessages: sent,
  } as unknown as WebSocket & { sentMessages: unknown[] };
  return ws;
}

describe("handleWsMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("responds to ping with pong", () => {
    const ws = createMockWs();

    handleWsMessage(ws, "device-1", JSON.stringify({ type: "ping" }));

    expect(ws.sentMessages).toContainEqual({ type: "pong" });
  });

  it("sends error for invalid JSON", () => {
    const ws = createMockWs();

    handleWsMessage(ws, "device-1", "not json{{{");

    expect(ws.sentMessages).toContainEqual({ type: "error", message: "invalid JSON" });
  });

  it("sends error for unknown message type", () => {
    const ws = createMockWs();

    handleWsMessage(ws, "device-1", JSON.stringify({ type: "unknown" }));

    expect(ws.sentMessages).toContainEqual({
      type: "error",
      message: "unknown message type: unknown",
    });
  });

  it("sends error when sessionKey is missing", () => {
    const ws = createMockWs();

    handleWsMessage(ws, "device-1", JSON.stringify({ type: "message", text: "hello" }));

    expect(ws.sentMessages).toContainEqual({
      type: "error",
      message: "sessionKey is required",
    });
  });

  it("sends error when sessionKey is empty", () => {
    const ws = createMockWs();

    handleWsMessage(
      ws,
      "device-1",
      JSON.stringify({ type: "message", sessionKey: "", text: "hello" }),
    );

    expect(ws.sentMessages).toContainEqual({
      type: "error",
      message: "sessionKey is required",
    });
  });

  it("sends error for invalid sessionKey format", () => {
    const ws = createMockWs();

    handleWsMessage(
      ws,
      "device-1",
      JSON.stringify({
        type: "message",
        sessionKey: "invalid-key",
        text: "hello",
      }),
    );

    expect(ws.sentMessages).toContainEqual({
      type: "error",
      message: "Invalid sessionKey format. Expected: agent:<name>:<conversation>",
    });
  });

  it("sends error for sessionKey missing agent prefix", () => {
    const ws = createMockWs();

    handleWsMessage(
      ws,
      "device-1",
      JSON.stringify({
        type: "message",
        sessionKey: "main:test",
        text: "hello",
      }),
    );

    expect(ws.sentMessages).toContainEqual({
      type: "error",
      message: "Invalid sessionKey format. Expected: agent:<name>:<conversation>",
    });
  });

  it("sends error when text is missing", () => {
    const ws = createMockWs();

    handleWsMessage(
      ws,
      "device-1",
      JSON.stringify({
        type: "message",
        sessionKey: "agent:main:test",
      }),
    );

    expect(ws.sentMessages).toContainEqual({
      type: "error",
      message: "text is required",
    });
  });

  it("sends error when text is empty", () => {
    const ws = createMockWs();

    handleWsMessage(
      ws,
      "device-1",
      JSON.stringify({
        type: "message",
        sessionKey: "agent:main:test",
        text: "   ",
      }),
    );

    expect(ws.sentMessages).toContainEqual({
      type: "error",
      message: "text is required",
    });
  });

  it("sends ack and calls dispatchInboundMessage for valid message", async () => {
    const ws = createMockWs();

    handleWsMessage(
      ws,
      "device-1",
      JSON.stringify({
        type: "message",
        sessionKey: "agent:main:test",
        text: "Hello from WS",
        idempotencyKey: "idem-001",
      }),
    );

    // Should get ack immediately
    expect(ws.sentMessages).toContainEqual({
      type: "ack",
      idempotencyKey: "idem-001",
      status: "started",
    });

    // Should get typing indicator
    expect(ws.sentMessages).toContainEqual({
      type: "typing",
      sessionKey: "agent:main:test",
      isTyping: true,
    });

    // dispatchInboundMessage should be called
    expect(dispatchInboundMessage).toHaveBeenCalledTimes(1);
    const call = vi.mocked(dispatchInboundMessage).mock.calls[0]![0];
    expect(call.ctx.Body).toBe("Hello from WS");
    expect(call.ctx.SessionKey).toBe("agent:main:test");
    expect(call.ctx.Provider).toBe("talktollm");
    expect(call.ctx.Surface).toBe("talktollm");
    expect(call.ctx.OriginatingChannel).toBe("talktollm");
    expect(call.ctx.MessageSid).toBe("idem-001");
  });

  it("deduplicates by idempotencyKey", () => {
    const ws = createMockWs();
    const idempotencyKey = `dedup-test-${Date.now()}`;

    // First call
    handleWsMessage(
      ws,
      "device-1",
      JSON.stringify({
        type: "message",
        sessionKey: "agent:main:test",
        text: "Hello",
        idempotencyKey,
      }),
    );

    expect(ws.sentMessages).toContainEqual({
      type: "ack",
      idempotencyKey,
      status: "started",
    });

    // Reset to count second call's messages
    vi.mocked(dispatchInboundMessage).mockClear();
    const ws2 = createMockWs();

    // Second call with same key
    handleWsMessage(
      ws2,
      "device-1",
      JSON.stringify({
        type: "message",
        sessionKey: "agent:main:test",
        text: "Hello",
        idempotencyKey,
      }),
    );

    // Should get duplicate ack
    expect(ws2.sentMessages).toContainEqual({
      type: "ack",
      idempotencyKey,
      status: "duplicate",
    });

    // Should NOT dispatch again
    expect(dispatchInboundMessage).not.toHaveBeenCalled();
  });

  it("generates idempotencyKey when not provided", () => {
    const ws = createMockWs();

    handleWsMessage(
      ws,
      "device-1",
      JSON.stringify({
        type: "message",
        sessionKey: "agent:main:test",
        text: "Hello no key",
      }),
    );

    // Should still get ack with a generated key
    const ack = ws.sentMessages.find(
      (m: unknown) => (m as Record<string, unknown>).type === "ack",
    ) as Record<string, unknown> | undefined;
    expect(ack).toBeDefined();
    expect(ack!.status).toBe("started");
    expect(typeof ack!.idempotencyKey).toBe("string");
    expect(ack!.idempotencyKey).toBeTruthy();
  });

  it("accepts valid sessionKey with underscores and hyphens", () => {
    const ws = createMockWs();

    handleWsMessage(
      ws,
      "device-1",
      JSON.stringify({
        type: "message",
        sessionKey: "agent:my_agent-v2:conv-name_1",
        text: "Hello",
        idempotencyKey: `test-${Date.now()}-underscore`,
      }),
    );

    // Should succeed (no error about sessionKey format)
    const errorMessages = ws.sentMessages.filter(
      (m: unknown) => (m as Record<string, unknown>).type === "error",
    );
    expect(errorMessages).toHaveLength(0);

    expect(dispatchInboundMessage).toHaveBeenCalled();
  });
});
