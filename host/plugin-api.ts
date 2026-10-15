// Adapted from the local BehaviorTreeTools Host; Web workspace lifecycle owned by WorkHub.
import type { PluginManifest } from "./plugin-manifest.js";
import type { PluginContext } from "./plugin-context.js";

export interface WorkHubPlugin {
  readonly manifest: PluginManifest;
  activate(context: PluginContext): Promise<void> | void;
  deactivate(): Promise<void> | void;
}

export type PluginState = "inactive" | "starting" | "active" | "failed" | "stopping";

export type PluginActivationFailure = {
  pluginId: string;
  error: Error;
};

export type PluginActivationReport = {
  activated: string[];
  failed: PluginActivationFailure[];
  skipped: Array<{ pluginId: string; reason: string }>;
};
