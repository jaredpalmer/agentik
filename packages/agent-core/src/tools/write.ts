import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { jsonSchema } from '@ai-sdk/provider-utils';
import type { AgentToolDefinition } from '../types';
import { resolveToCwd } from './path-utils';

export type WriteToolInput = {
  path: string;
  content: string;
};

const writeSchema = jsonSchema<WriteToolInput>({
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the file to write.' },
    content: { type: 'string', description: 'Content to write.' },
  },
  required: ['path', 'content'],
  additionalProperties: false,
});

export type WriteOperations = {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
};

const defaultWriteOperations: WriteOperations = {
  writeFile: (path, content) => writeFile(path, content, 'utf-8'),
  mkdir: dir => mkdir(dir, { recursive: true }).then(() => undefined),
};

export type WriteToolOptions = {
  operations?: WriteOperations;
};

export function createWriteTool(
  cwd: string,
  options: WriteToolOptions = {},
): AgentToolDefinition<WriteToolInput, string> {
  const ops = options.operations ?? defaultWriteOperations;

  return {
    name: 'write',
    label: 'write',
    description: 'Write content to a file. Creates parent directories as needed.',
    inputSchema: writeSchema,
    execute: async input => {
      const absolutePath = resolveToCwd(input.path, cwd);
      await ops.mkdir(dirname(absolutePath));
      await ops.writeFile(absolutePath, input.content);
      return { output: `Wrote ${input.content.length} bytes to ${input.path}.` };
    },
  };
}

export const writeTool = createWriteTool(process.cwd());
