import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { talktollmConfigAdapter, type ResolvedTalktollmAccount } from "./config.js";
import { talktollmGatewayAdapter } from "./gateway.js";
import { getConnectedDeviceIds, isDeviceConnected } from "./gateway.js";
import { talktollmMessagingAdapter } from "./messaging.js";
import { talktollmOutboundAdapter } from "./outbound.js";
import { talktollmSecurityAdapter } from "./security.js";
import { talktollmSetupAdapter } from "./setup.js";
import { talktollmStatusAdapter } from "./status.js";

export const talktollmPlugin: ChannelPlugin<ResolvedTalktollmAccount> = {
  id: "talktollm",
  meta: {
    id: "talktollm",
    label: "Talk to LLM",
    selectionLabel: "Talk to LLM (iOS)",
    docsPath: "/channels/talktollm",
    docsLabel: "talktollm",
    blurb: "Talk to LLM iOS messaging app — WebSocket + APNs delivery.",
    systemImage: "iphone",
  },
  capabilities: {
    chatTypes: ["direct"],
    polls: false,
    reactions: false,
    edit: false,
    unsend: false,
    reply: false,
    effects: false,
    groupManagement: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  config: talktollmConfigAdapter,
  security: talktollmSecurityAdapter,
  messaging: talktollmMessagingAdapter,
  setup: talktollmSetupAdapter,
  status: talktollmStatusAdapter,
  gateway: talktollmGatewayAdapter,
  outbound: talktollmOutboundAdapter,
  threading: {
    resolveReplyToMode: () => "off",
  },
  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 200, idleMs: 500 },
  },
  heartbeat: {
    checkReady: async () => {
      const devices = getConnectedDeviceIds();
      return {
        ok: devices.length > 0,
        reason: devices.length > 0 ? "device connected" : "no device connected",
      };
    },
    resolveRecipients: ({ cfg }) => {
      const section = (cfg.channels as Record<string, unknown> | undefined)?.talktollm as
        | Record<string, unknown>
        | undefined;
      const deviceId = section?.deviceId as string | undefined;
      if (deviceId && isDeviceConnected(deviceId)) {
        return { recipients: [deviceId], source: "talktollm" };
      }
      return { recipients: [], source: "talktollm" };
    },
  },
};
