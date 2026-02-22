import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { talktollmPlugin } from "./src/channel.js";
import { startAgentEventListener } from "./src/event-listener.js";
import { setTalktollmRuntime } from "./src/runtime.js";
import { startWsServer } from "./src/ws-server.js";

const plugin = {
  id: "talktollm",
  name: "Talk to LLM",
  description: "Talk to LLM iOS messaging app channel for OpenClaw",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setTalktollmRuntime(api.runtime);
    api.registerChannel({ plugin: talktollmPlugin });
    startWsServer();
    startAgentEventListener();
  },
};

export default plugin;
