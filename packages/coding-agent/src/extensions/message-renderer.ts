/**
 * Message renderer registry — extensions can register custom renderers
 * for custom message types.
 *
 * Custom messages are stored in the session but not sent to the LLM.
 * Extensions use `appendEntry()` to add them and renderers to display them.
 */

/** A custom message data payload. */
export interface CustomMessageData<T = unknown> {
  customType: string;
  content?: string;
  details?: T;
}

/** Render options passed to message renderers. */
export interface MessageRenderOptions {
  expanded: boolean;
}

/** A renderer function for a custom message type. */
export type MessageRendererFn<T = unknown> = (
  message: CustomMessageData<T>,
  options: MessageRenderOptions
) => string[] | undefined;

export class MessageRendererRegistry {
  private renderers = new Map<string, MessageRendererFn>();

  /** Register a renderer for a custom message type. Throws if already registered. */
  register<T = unknown>(customType: string, renderer: MessageRendererFn<T>): () => void {
    if (this.renderers.has(customType)) {
      throw new Error(`Message renderer for "${customType}" is already registered`);
    }

    this.renderers.set(customType, renderer as MessageRendererFn);

    return () => {
      this.renderers.delete(customType);
    };
  }

  /** Get a renderer for a custom message type. */
  get(customType: string): MessageRendererFn | undefined {
    return this.renderers.get(customType);
  }

  /** Check if a renderer is registered for a custom message type. */
  has(customType: string): boolean {
    return this.renderers.has(customType);
  }

  /** Render a custom message. Returns string lines or undefined. */
  render(message: CustomMessageData, options: MessageRenderOptions): string[] | undefined {
    const renderer = this.renderers.get(message.customType);
    if (!renderer) return undefined;
    return renderer(message, options);
  }

  /** Number of registered renderers. */
  get size(): number {
    return this.renderers.size;
  }
}
