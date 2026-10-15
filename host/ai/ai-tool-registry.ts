// Adapted from the local BehaviorTreeTools Host; Web workspace lifecycle owned by WorkHub.
export type AiTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  effect: "read" | "write";
  pluginId?: string;
  validate: (input: unknown) => void;
  execute: (input: any, context: { signal: AbortSignal }) => Promise<unknown>;
};

export type AiToolInfo = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  effect: "read" | "write";
  pluginId?: string;
};

export type AiToolApi = Pick<AiToolRegistry, "register" | "list" | "get">;

export class AiToolRegistry {
  private readonly tools = new Map<string, AiTool>();

  register(tool: AiTool): { dispose: () => void } {
    if (!tool.name.trim()) {
      throw new Error("AI tool name cannot be empty.");
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`AI tool "${tool.name}" is already registered.`);
    }
    if (!["read", "write"].includes(tool.effect) || typeof tool.validate !== "function" || !tool.inputSchema) {
      throw new Error("Tools require a schema, validation and a read/write effect.");
    }

    this.tools.set(tool.name, tool);
    return {
      dispose: () => {
        if (this.tools.get(tool.name) === tool) this.tools.delete(tool.name);
      }
    };
  }

  forPlugin(pluginId: string, resources: { add<T extends { dispose(): void }>(resource: T): T }): AiToolApi {
    return {
      register: (tool) => resources.add(this.register({ ...tool, pluginId })),
      list: () => this.list().filter((tool) => tool.pluginId === pluginId),
      get: (name) => {
        const tool = this.get(name);
        if (tool.pluginId !== pluginId) throw new Error("Tool belongs to another plugin.");
        return tool;
      }
    };
  }

  list(): AiToolInfo[] {
    return [...this.tools.values()].map(({ execute, validate, ...info }) => info);
  }

  get(name: string): AiTool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`AI tool "${name}" is not registered.`);
    }
    return tool;
  }
}
