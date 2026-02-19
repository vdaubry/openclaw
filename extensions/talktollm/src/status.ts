import {
  createDefaultChannelRuntimeState,
  collectStatusIssuesFromLastError,
  buildBaseChannelStatusSummary,
  DEFAULT_ACCOUNT_ID,
  type ChannelStatusAdapter,
} from "openclaw/plugin-sdk";
import type { ResolvedTalktollmAccount } from "./config.js";
import { isDeviceConnected } from "./gateway.js";

export const talktollmStatusAdapter: ChannelStatusAdapter<ResolvedTalktollmAccount> = {
  defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),

  collectStatusIssues: (accounts) => collectStatusIssuesFromLastError("talktollm", accounts),

  buildChannelSummary: ({ snapshot }) => ({
    ...buildBaseChannelStatusSummary(snapshot),
  }),

  buildAccountSnapshot: ({ account, runtime }) => ({
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    connected: account.config.deviceId ? isDeviceConnected(account.config.deviceId) : false,
    running: runtime?.running ?? false,
    lastStartAt: runtime?.lastStartAt ?? null,
    lastStopAt: runtime?.lastStopAt ?? null,
    lastError: runtime?.lastError ?? null,
    lastInboundAt: runtime?.lastInboundAt ?? null,
    lastOutboundAt: runtime?.lastOutboundAt ?? null,
  }),
};
