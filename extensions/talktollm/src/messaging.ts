import type { ChannelMessagingAdapter } from "openclaw/plugin-sdk";

/**
 * Device ID format: alphanumeric + hyphens, typically a UUID.
 * Example: "talktollm-device-abc123" or "550e8400-e29b-41d4-a716-446655440000"
 */
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,}$/;

export const talktollmMessagingAdapter: ChannelMessagingAdapter = {
  normalizeTarget: (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    return trimmed;
  },
  targetResolver: {
    looksLikeId: (raw) => DEVICE_ID_PATTERN.test(raw.trim()),
    hint: "<deviceId>",
  },
};
