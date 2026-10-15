// Adapted from the local BehaviorTreeTools Host; Web workspace lifecycle owned by WorkHub.
import type {
  WorkHubPlugin,
  PluginActivationFailure,
  PluginActivationReport,
  PluginState
} from "./plugin-api.js";
import { MessageBus } from "./message-bus.js";
import { DisposableStore, PluginContext, PluginLogger, ServiceRegistry } from "./plugin-context.js";
import { PluginRegistry } from "./plugin-registry.js";
import { AiToolRegistry } from "./ai/ai-tool-registry.js";

const defaultLogger: PluginLogger = {
  info: (message) => console.info(`[WorkHub] ${message}`),
  warn: (message) => console.warn(`[WorkHub] ${message}`),
  error: (message) => console.error(`[WorkHub] ${message}`)
};

export class PluginManager {
  private readonly states = new Map<string, PluginState>();
  private readonly contexts = new Map<string, PluginContext>();
  private readonly activationOrder: string[] = [];
  private readonly services: ServiceRegistry;
  private readonly messageBus: MessageBus;
  private readonly aiTools: AiToolRegistry;
  private readonly logger: PluginLogger;
  private transitionQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly registry: PluginRegistry,
    options: {
      services?: ServiceRegistry;
      messageBus?: MessageBus;
      aiTools?: AiToolRegistry;
      logger?: PluginLogger;
    } = {}
  ) {
    this.services = options.services || new ServiceRegistry();
    this.messageBus = options.messageBus || new MessageBus();
    this.aiTools = options.aiTools || new AiToolRegistry();
    this.logger = options.logger || defaultLogger;

    for (const plugin of registry.list()) {
      this.states.set(plugin.manifest.id, "inactive");
    }
  }

  async enable(pluginId: string): Promise<PluginActivationReport> {
    return this.enqueue(async () => {
      const requested = new Set(this.getActivePluginIds());
      requested.add(pluginId);
      return this.activateEnabledInternal(requested);
    });
  }

  async disable(pluginId: string): Promise<void> {
    return this.enqueue(() => this.disableInternal(pluginId));
  }

  async activateEnabled(pluginIds?: Iterable<string>): Promise<PluginActivationReport> {
    return this.enqueue(() => this.activateEnabledInternal(pluginIds));
  }

  async deactivate(pluginId: string): Promise<void> {
    return this.enqueue(() => this.deactivateInternal(pluginId));
  }

  async deactivateAll(): Promise<void> {
    return this.enqueue(() => this.deactivateAllInternal());
  }

  private async disableInternal(pluginId: string): Promise<void> {
    const activeDependents = this.registry
      .list()
      .filter(
        (plugin) =>
          this.getState(plugin.manifest.id) === "active" &&
          plugin.manifest.dependencies?.includes(pluginId)
      )
      .map((plugin) => plugin.manifest.id);
    if (activeDependents.length > 0) {
      throw new Error(`Plugin "${pluginId}" is required by active plugins: ${activeDependents.join(", ")}.`);
    }
    await this.deactivateInternal(pluginId);
  }

  private async activateEnabledInternal(pluginIds?: Iterable<string>): Promise<PluginActivationReport> {
    const requested = this.resolveRequestedPluginIds(pluginIds);
    const order = this.resolveActivationOrder(requested);
    const report: PluginActivationReport = {
      activated: [],
      failed: [],
      skipped: []
    };

    for (const plugin of order) {
      if (this.states.get(plugin.manifest.id) === "active") {
        continue;
      }

      const dependencyFailure = (plugin.manifest.dependencies || []).find(
        (dependencyId) => this.states.get(dependencyId) !== "active"
      );
      if (dependencyFailure) {
        const reason = `Dependency "${dependencyFailure}" is not active.`;
        this.states.set(plugin.manifest.id, "failed");
        report.skipped.push({ pluginId: plugin.manifest.id, reason });
        this.logger.error(`Plugin "${plugin.manifest.id}" was skipped. ${reason}`);
        continue;
      }

      const failure = await this.activate(plugin);
      if (failure) {
        report.failed.push(failure);
      } else {
        report.activated.push(plugin.manifest.id);
      }
    }

    return report;
  }

  private async deactivateInternal(pluginId: string): Promise<void> {
    const plugin = this.registry.get(pluginId);
    const state = this.states.get(pluginId);
    if (state !== "active" && state !== "failed") {
      return;
    }

    this.states.set(pluginId, "stopping");
    const context = this.contexts.get(pluginId);
    const errors: unknown[] = [];
    try {
      await plugin.deactivate();
    } catch (error) {
      errors.push(error);
    } finally {
      try { await context?.disposables.dispose(); } catch (error) { errors.push(error); }
      this.contexts.delete(pluginId);
      this.states.set(pluginId, "inactive");
      const activationIndex = this.activationOrder.indexOf(pluginId);
      if (activationIndex >= 0) {
        this.activationOrder.splice(activationIndex, 1);
      }
    }
    if (errors.length) throw new AggregateError(errors, `Plugin "${pluginId}" cleanup failed.`);
  }

  private async deactivateAllInternal(): Promise<void> {
    const activePluginIds = [...this.activationOrder].reverse();
    const errors: unknown[] = [];
    for (const pluginId of activePluginIds) {
      try { await this.deactivateInternal(pluginId); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Plugin shutdown failed.");
  }

  getState(pluginId: string): PluginState {
    if (!this.registry.has(pluginId)) {
      throw new Error(`Plugin "${pluginId}" is not registered.`);
    }
    return this.states.get(pluginId) || "inactive";
  }

  hasPlugin(pluginId: string): boolean {
    return this.registry.has(pluginId);
  }

  getActivePluginIds(): string[] {
    return this.activationOrder.filter((pluginId) => this.states.get(pluginId) === "active");
  }

  private async activate(plugin: WorkHubPlugin): Promise<PluginActivationFailure | null> {
    const pluginId = plugin.manifest.id;
    this.states.set(pluginId, "starting");
    const disposables = new DisposableStore();
    const context: PluginContext = {
      pluginId,
      services: this.services,
      messageBus: this.messageBus,
      aiTools: this.aiTools.forPlugin(pluginId, disposables),
      disposables,
      logger: this.logger
    };
    this.contexts.set(pluginId, context);

    try {
      await plugin.activate(context);
      this.states.set(pluginId, "active");
      this.activationOrder.push(pluginId);
      return null;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.states.set(pluginId, "failed");
      try { await context.disposables.dispose(); } catch (cleanupError) {
        this.logger.error(`Plugin "${pluginId}" cleanup failed: ${String(cleanupError)}`);
      }
      this.contexts.delete(pluginId);
      this.logger.error(`Plugin "${pluginId}" failed to activate. ${normalized.message}`);
      return {
        pluginId,
        error: normalized
      };
    }
  }

  private resolveRequestedPluginIds(pluginIds?: Iterable<string>): Set<string> {
    const requested = new Set(
      pluginIds ||
        this.registry
          .list()
          .filter((plugin) => plugin.manifest.defaultEnabled)
          .map((plugin) => plugin.manifest.id)
    );

    for (const pluginId of requested) {
      if (!this.registry.has(pluginId)) {
        throw new Error(`Plugin "${pluginId}" is not registered.`);
      }
    }

    const expanded = new Set(requested);
    const visitDependencies = (pluginId: string): void => {
      const plugin = this.registry.get(pluginId);
      for (const dependencyId of plugin.manifest.dependencies || []) {
        if (!this.registry.has(dependencyId)) {
          throw new Error(`Plugin "${pluginId}" depends on missing plugin "${dependencyId}".`);
        }
        if (!expanded.has(dependencyId)) {
          expanded.add(dependencyId);
          visitDependencies(dependencyId);
        }
      }
    };

    for (const pluginId of [...expanded]) {
      visitDependencies(pluginId);
    }
    return expanded;
  }

  private resolveActivationOrder(pluginIds: Set<string>): WorkHubPlugin[] {
    const order: WorkHubPlugin[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (pluginId: string): void => {
      if (visited.has(pluginId)) {
        return;
      }
      if (visiting.has(pluginId)) {
        throw new Error(`Plugin dependency cycle detected at "${pluginId}".`);
      }

      visiting.add(pluginId);
      const plugin = this.registry.get(pluginId);
      for (const dependencyId of plugin.manifest.dependencies || []) {
        if (pluginIds.has(dependencyId)) {
          visit(dependencyId);
        }
      }
      visiting.delete(pluginId);
      visited.add(pluginId);
      order.push(plugin);
    };

    for (const pluginId of pluginIds) {
      visit(pluginId);
    }
    return order;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.transitionQueue.then(operation, operation);
    this.transitionQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
