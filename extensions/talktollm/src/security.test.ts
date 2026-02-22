import { describe, expect, it } from "vitest";
import { talktollmSecurityAdapter } from "./security.js";

describe("talktollmSecurityAdapter", () => {
  describe("resolveDmPolicy", () => {
    it("returns open policy", () => {
      const result = talktollmSecurityAdapter.resolveDmPolicy!({} as any);
      expect(result.policy).toBe("open");
    });

    it("returns empty allowFrom", () => {
      const result = talktollmSecurityAdapter.resolveDmPolicy!({} as any);
      expect(result.allowFrom).toEqual([]);
    });

    it("returns correct allowFromPath", () => {
      const result = talktollmSecurityAdapter.resolveDmPolicy!({} as any);
      expect(result.allowFromPath).toBe("channels.talktollm.");
    });

    it("returns empty approveHint", () => {
      const result = talktollmSecurityAdapter.resolveDmPolicy!({} as any);
      expect(result.approveHint).toBe("");
    });
  });
});
