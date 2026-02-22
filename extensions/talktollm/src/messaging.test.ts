import { describe, expect, it } from "vitest";
import { talktollmMessagingAdapter } from "./messaging.js";

describe("talktollmMessagingAdapter", () => {
  describe("normalizeTarget", () => {
    it("trims whitespace", () => {
      expect(talktollmMessagingAdapter.normalizeTarget?.("  device-abc  ")).toBe("device-abc");
    });

    it("returns undefined for empty string", () => {
      expect(talktollmMessagingAdapter.normalizeTarget?.("")).toBeUndefined();
    });

    it("returns undefined for whitespace only", () => {
      expect(talktollmMessagingAdapter.normalizeTarget?.("   ")).toBeUndefined();
    });

    it("passes through valid device IDs", () => {
      expect(talktollmMessagingAdapter.normalizeTarget?.("device-abc123")).toBe("device-abc123");
    });
  });

  describe("targetResolver.looksLikeId", () => {
    it("accepts alphanumeric device IDs", () => {
      expect(talktollmMessagingAdapter.targetResolver?.looksLikeId?.("device-abc123")).toBe(true);
    });

    it("accepts UUIDs", () => {
      expect(
        talktollmMessagingAdapter.targetResolver?.looksLikeId?.(
          "550e8400-e29b-41d4-a716-446655440000",
        ),
      ).toBe(true);
    });

    it("accepts IDs with underscores", () => {
      expect(talktollmMessagingAdapter.targetResolver?.looksLikeId?.("talktollm_device_1")).toBe(
        true,
      );
    });

    it("rejects empty string", () => {
      expect(talktollmMessagingAdapter.targetResolver?.looksLikeId?.("")).toBe(false);
    });

    it("rejects single character", () => {
      expect(talktollmMessagingAdapter.targetResolver?.looksLikeId?.("a")).toBe(false);
    });

    it("rejects two characters", () => {
      expect(talktollmMessagingAdapter.targetResolver?.looksLikeId?.("ab")).toBe(false);
    });

    it("has correct hint", () => {
      expect(talktollmMessagingAdapter.targetResolver?.hint).toBe("<deviceId>");
    });
  });
});
