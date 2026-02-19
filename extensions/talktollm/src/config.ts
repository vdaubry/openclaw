import {
  DEFAULT_ACCOUNT_ID,
  type ChannelConfigAdapter,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";

export type ResolvedTalktollmAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  config: {
    deviceId?: string;
    apnsToken?: string;
    apnsTopic?: string;
    apnsEnvironment?: "sandbox" | "production";
  };
};

function getTalktollmSection(cfg: OpenClawConfig): Record<string, unknown> | undefined {
  return (cfg.channels as Record<string, unknown> | undefined)?.talktollm as
    | Record<string, unknown>
    | undefined;
}

function getAccountSection(
  cfg: OpenClawConfig,
  accountId: string,
): Record<string, unknown> | undefined {
  const section = getTalktollmSection(cfg);
  if (!section) return undefined;
  if (accountId === DEFAULT_ACCOUNT_ID) return section;
  const accounts = section.accounts as Record<string, Record<string, unknown>> | undefined;
  return accounts?.[accountId];
}

export const talktollmConfigAdapter: ChannelConfigAdapter<ResolvedTalktollmAccount> = {
  listAccountIds: (cfg) => {
    const section = getTalktollmSection(cfg);
    if (!section) return [];
    const accounts = section.accounts as Record<string, unknown> | undefined;
    if (accounts && typeof accounts === "object") {
      return Object.keys(accounts);
    }
    // If the section exists but no accounts sub-key, treat as default account
    return [DEFAULT_ACCOUNT_ID];
  },

  resolveAccount: (cfg, accountId) => {
    const id = accountId ?? DEFAULT_ACCOUNT_ID;
    const section = getAccountSection(cfg, id);
    return {
      accountId: id,
      name: (section?.name as string) ?? undefined,
      enabled: section?.enabled !== false,
      configured: Boolean(section?.deviceId),
      config: {
        deviceId: (section?.deviceId as string) ?? undefined,
        apnsToken: (section?.apnsToken as string) ?? undefined,
        apnsTopic: (section?.apnsTopic as string) ?? undefined,
        apnsEnvironment: (section?.apnsEnvironment as "sandbox" | "production") ?? undefined,
      },
    };
  },

  isConfigured: (account) => account.configured,

  isEnabled: (account) => account.enabled,

  describeAccount: (account) => ({
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
  }),
};
