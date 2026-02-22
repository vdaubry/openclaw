import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

// outbound.ts now imports push-apns; mock it so the module can load.
vi.mock("../../src/infra/push-apns.js", () => ({
  loadApnsRegistration: vi.fn().mockResolvedValue(null),
  resolveApnsAuthConfigFromEnv: vi.fn().mockResolvedValue({ ok: false, error: "test" }),
  sendApnsAlert: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
}));

vi.mock("./runtime.js", () => ({
  getTalktollmRuntime: () => ({
    config: { loadConfig: () => ({}) },
    logging: {
      getChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    },
  }),
}));

import { talktollmPlugin } from "./channel.js";

describe("talktollmPlugin", () => {
  describe("id and meta", () => {
    it("has id talktollm", () => {
      expect(talktollmPlugin.id).toBe("talktollm");
    });

    it("has correct meta label", () => {
      expect(talktollmPlugin.meta.label).toBe("Talk to LLM");
    });

    it("has correct meta selectionLabel", () => {
      expect(talktollmPlugin.meta.selectionLabel).toBe("Talk to LLM (iOS)");
    });

    it("has systemImage iphone", () => {
      expect(talktollmPlugin.meta.systemImage).toBe("iphone");
    });
  });

  describe("capabilities", () => {
    it("supports only direct chat", () => {
      expect(talktollmPlugin.capabilities.chatTypes).toEqual(["direct"]);
    });

    it("blocks streaming", () => {
      expect(talktollmPlugin.capabilities.blockStreaming).toBe(true);
    });

    it("does not support polls", () => {
      expect(talktollmPlugin.capabilities.polls).toBe(false);
    });

    it("does not support reactions", () => {
      expect(talktollmPlugin.capabilities.reactions).toBe(false);
    });

    it("does not support media", () => {
      expect(talktollmPlugin.capabilities.media).toBe(false);
    });

    it("does not support threads", () => {
      expect(talktollmPlugin.capabilities.threads).toBe(false);
    });
  });

  describe("threading", () => {
    it("resolveReplyToMode returns off", () => {
      const mode = talktollmPlugin.threading?.resolveReplyToMode?.({
        cfg: {} as OpenClawConfig,
      });
      expect(mode).toBe("off");
    });
  });

  describe("streaming", () => {
    it("has blockStreamingCoalesceDefaults", () => {
      expect(talktollmPlugin.streaming?.blockStreamingCoalesceDefaults).toEqual({
        minChars: 1500,
        idleMs: 1000,
      });
    });
  });

  describe("security", () => {
    it("resolveDmPolicy returns open", () => {
      const policy = talktollmPlugin.security?.resolveDmPolicy?.({
        cfg: {} as OpenClawConfig,
        account: {
          accountId: "default",
          enabled: true,
          configured: false,
          config: {},
        },
      });
      expect(policy?.policy).toBe("open");
    });
  });

  describe("outbound", () => {
    it("has direct delivery mode", () => {
      expect(talktollmPlugin.outbound?.deliveryMode).toBe("direct");
    });

    it("has 4096 text chunk limit", () => {
      expect(talktollmPlugin.outbound?.textChunkLimit).toBe(4096);
    });
  });
});
