import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setTalktollmRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getTalktollmRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Talk to LLM runtime not initialized");
  }
  return runtime;
}
