import type { ModelMessage } from '@ai-sdk/provider-utils';
import type { AgentMessage } from './types';

const MODEL_ROLES = new Set(['system', 'user', 'assistant', 'tool']);

export function isModelMessage(message: AgentMessage): message is ModelMessage {
  if (message == null || typeof message !== 'object') {
    return false;
  }
  const role = (message as { role?: string }).role;
  return role != null && MODEL_ROLES.has(role);
}

export async function defaultConvertToModelMessages(
  messages: AgentMessage[],
): Promise<ModelMessage[]> {
  return messages.filter(isModelMessage);
}
