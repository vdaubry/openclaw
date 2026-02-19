import {
  DEFAULT_ACCOUNT_ID,
  type ChannelSetupAdapter,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import { registerConnection, unregisterConnection } from "./gateway.js";

export const talktollmSetupAdapter: ChannelSetupAdapter = {
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const id = accountId || DEFAULT_ACCOUNT_ID;

    // Build the fields to merge into the talktollm config section.
    // Supports: token (deviceId), pushToken, pushTopic, pushEnvironment, deviceOnline.
    const updates: Record<string, unknown> = { enabled: true };

    if (input.token) {
      updates.deviceId = input.token;
    }
    // Accept both naming conventions:
    // - "pushToken"/"pushTopic"/"pushEnvironment" (setup adapter convention)
    // - "token"/"topic"/"environment" (push.apns.register RPC convention from iOS)
    const pushToken = input.pushToken ?? input.token;
    const pushTopic = input.pushTopic ?? input.topic;
    const pushEnvironment = input.pushEnvironment ?? input.environment;

    if (pushToken && typeof pushToken === "string") {
      updates.apnsToken = pushToken;
    }
    if (pushTopic && typeof pushTopic === "string") {
      updates.apnsTopic = pushTopic;
    }
    if (pushEnvironment && typeof pushEnvironment === "string") {
      updates.apnsEnvironment = pushEnvironment;
    }

    // Track device connectivity when the iOS app reports it.
    // The iOS app sends deviceOnline=true after a successful WebSocket handshake.
    if (input.deviceOnline === true && input.token) {
      registerConnection(input.token as string);
    } else if (input.deviceOnline === false && input.token) {
      unregisterConnection(input.token as string);
    }

    const existingTalktollm =
      ((cfg.channels as Record<string, unknown> | undefined)?.talktollm as
        | Record<string, unknown>
        | undefined) ?? {};

    const nextCfg: OpenClawConfig = {
      ...cfg,
      channels: {
        ...cfg.channels,
        talktollm: {
          ...existingTalktollm,
          ...updates,
        },
      },
    };

    if (id !== DEFAULT_ACCOUNT_ID) {
      const talktollmSection = (nextCfg.channels as Record<string, unknown>).talktollm as Record<
        string,
        unknown
      >;
      const existingAccounts = talktollmSection.accounts as
        | Record<string, Record<string, unknown>>
        | undefined;
      talktollmSection.accounts = {
        ...existingAccounts,
        [id]: {
          ...existingAccounts?.[id],
          ...updates,
        },
      };
    }

    return nextCfg;
  },
};
