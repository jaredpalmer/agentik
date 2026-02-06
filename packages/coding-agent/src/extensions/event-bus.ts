/**
 * Event bus — simple pub/sub for inter-extension communication.
 *
 * Extensions can emit and listen on named channels without
 * knowing about each other directly.
 */

/** Read-only event bus interface for extensions. */
export interface EventBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

/** Controllable event bus with cleanup. */
export interface EventBusController extends EventBus {
  clear(): void;
}

export function createEventBus(): EventBusController {
  const handlers = new Map<string, Set<(data: unknown) => void>>();

  return {
    emit(channel: string, data: unknown): void {
      const set = handlers.get(channel);
      if (!set) return;
      for (const handler of set) {
        try {
          handler(data);
        } catch (err) {
          console.error(`Event bus handler error (${channel}):`, err);
        }
      }
    },

    on(channel: string, handler: (data: unknown) => void): () => void {
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
      }
      set.add(handler);

      return () => {
        set.delete(handler);
        if (set.size === 0) {
          handlers.delete(channel);
        }
      };
    },

    clear(): void {
      handlers.clear();
    },
  };
}
