import type { ChannelSecurityAdapter } from "openclaw/plugin-sdk";
import type { ResolvedTalktollmAccount } from "./config.js";

export const talktollmSecurityAdapter: ChannelSecurityAdapter<ResolvedTalktollmAccount> = {
  resolveDmPolicy: () => ({
    // Single-user device — no allowlist needed.
    // Auth is handled at the gateway level (token + device pairing).
    policy: "open",
    allowFrom: [],
    allowFromPath: "channels.talktollm.",
    approveHint: "",
  }),
};
