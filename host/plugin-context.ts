// Adapted from the local BehaviorTreeTools Host; Web workspace lifecycle owned by WorkHub.
import type { MessageBus } from "./message-bus.js";
import type { AiToolApi } from "./ai/ai-tool-registry.js";

export type Disposable = {
  dispose: () => void | Promise<void>;
};

export class DisposableStore implements Disposable {
  private readonly disposables: Disposable[] = [];

  add<T extends Disposable>(disposable: T): T {
    this.disposables.push(disposable);
    return disposable;
  }

  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const disposable of this.disposables.splice(0).reverse()) {
      try { await disposable.dispose(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Resource cleanup failed.");
  }
}

export class ServiceRegistry {
  private readonly services = new Map<string, unknown>();

  set<T>(id: string, service: T): void {
    if (!id.trim()) {
      throw new Error("Service ID cannot be empty.");
    }
    if (this.services.has(id)) {
      throw new Error(`Service "${id}" is already registered.`);
    }
    this.services.set(id, service);
  }

  get<T>(id: string): T {
    const service = this.services.get(id);
    if (!service) {
      throw new Error(`Service "${id}" is not registered.`);
    }
    return service as T;
  }

  has(id: string): boolean {
    return this.services.has(id);
  }
}

export type PluginLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type PluginContext = {
  pluginId: string;
  services: ServiceRegistry;
  messageBus: MessageBus;
  aiTools: AiToolApi;
  disposables: DisposableStore;
  logger: PluginLogger;
};
