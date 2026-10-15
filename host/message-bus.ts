// Adapted from the local BehaviorTreeTools Host; Web workspace lifecycle owned by WorkHub.
export type HostMessage = {
  type: string;
  payload?: unknown;
  requestId?: string;
  source?: string;
};

export type MessageHandler = (message: HostMessage) => void | Promise<void>;

export type MessageSubscription = {
  dispose: () => void;
};

export class MessageBus {
  private readonly handlers = new Map<string, Set<MessageHandler>>();

  on(type: string, handler: MessageHandler): MessageSubscription {
    if (!type.trim()) {
      throw new Error("Message type cannot be empty.");
    }

    const handlers = this.handlers.get(type) || new Set<MessageHandler>();
    handlers.add(handler);
    this.handlers.set(type, handlers);

    return {
      dispose: () => {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(type);
        }
      }
    };
  }

  async dispatch(message: HostMessage): Promise<boolean> {
    if (!message.type.trim()) {
      throw new Error("Message type cannot be empty.");
    }

    const handlers = this.handlers.get(message.type);
    if (!handlers || handlers.size === 0) {
      return false;
    }

    for (const handler of [...handlers]) {
      await handler(message);
    }
    return true;
  }

  clear(): void {
    this.handlers.clear();
  }
}
