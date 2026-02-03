import { constants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { jsonSchema } from '@ai-sdk/provider-utils';
import type { AgentToolDefinition } from '../types';
import { resolveToCwd } from './path-utils';

export type UpdateToolInput = {
  path: string;
  content: string;
};

const updateSchema = jsonSchema<UpdateToolInput>({
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the file to update.' },
    content: { type: 'string', description: 'New file content.' },
  },
  required: ['path', 'content'],
  additionalProperties: false,
});

export type UpdateOperations = {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
};

const defaultUpdateOperations: UpdateOperations = {
  readFile: path => readFile(path),
  writeFile: (path, content) => writeFile(path, content, 'utf-8'),
  access: path => access(path, constants.R_OK | constants.W_OK),
};

export type UpdateToolOptions = {
  operations?: UpdateOperations;
};

export function createUpdateTool(
  cwd: string,
  options: UpdateToolOptions = {},
): AgentToolDefinition<UpdateToolInput, string> {
  const ops = options.operations ?? defaultUpdateOperations;

  return {
    name: 'update',
    label: 'update',
    description: 'Replace file contents with new content.',
    inputSchema: updateSchema,
    execute: async input => {
      const absolutePath = resolveToCwd(input.path, cwd);
      await ops.access(absolutePath);

      const current = (await ops.readFile(absolutePath)).toString('utf-8');
      if (current === input.content) {
        return { output: `No changes for ${input.path}.` };
      }

      await ops.writeFile(absolutePath, input.content);
      return { output: `Updated ${input.path}.` };
    },
  };
}

export const updateTool = createUpdateTool(process.cwd());
