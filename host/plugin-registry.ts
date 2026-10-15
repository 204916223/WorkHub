// Adapted from the local BehaviorTreeTools Host; Web workspace lifecycle owned by WorkHub.
import type { WorkHubPlugin } from "./plugin-api.js";

export class PluginRegistry {
  private readonly plugins = new Map<string, WorkHubPlugin>();

  register(plugin: WorkHubPlugin): void {
    if (plugin.manifest.apiVersion != null && plugin.manifest.apiVersion !== 1) {
      throw new Error("Plugin API version is not supported.");
    }
    const pluginId = plugin.manifest.id.trim();
    if (!pluginId) {
      throw new Error("Plugin ID cannot be empty.");
    }
    if (this.plugins.has(pluginId)) {
      throw new Error(`Plugin "${pluginId}" is already registered.`);
    }
    this.plugins.set(pluginId, plugin);
  }

  get(pluginId: string): WorkHubPlugin {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" is not registered.`);
    }
    return plugin;
  }

  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  list(): WorkHubPlugin[] {
    return [...this.plugins.values()];
  }
}
