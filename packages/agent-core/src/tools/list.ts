import { readdir, stat } from 'node:fs/promises';
import { jsonSchema } from '@ai-sdk/provider-utils';
import type { AgentToolDefinition } from '../types';
import { resolveToCwd } from './path-utils';
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from './truncate';

export type ListToolInput = {
  path?: string;
  limit?: number;
};

const listSchema = jsonSchema<ListToolInput>({
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Directory to list.' },
    limit: {
      type: 'number',
      description: 'Maximum number of entries to return.',
    },
  },
  additionalProperties: false,
});

const DEFAULT_LIMIT = 500;

export type ListOperations = {
  readdir: (absolutePath: string) => Promise<string[]>;
  stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean }>;
};

const defaultListOperations: ListOperations = {
  readdir: path => readdir(path),
  stat: path => stat(path),
};

export type ListToolOptions = {
  operations?: ListOperations;
};

export function createListTool(
  cwd: string,
  options: ListToolOptions = {},
): AgentToolDefinition<ListToolInput, string> {
  const ops = options.operations ?? defaultListOperations;

  return {
    name: 'list',
    label: 'list',
    description: `List directory entries. Output is truncated to ${formatSize(DEFAULT_MAX_BYTES)} or ${DEFAULT_LIMIT} entries.`,
    inputSchema: listSchema,
    execute: async input => {
      const basePath = resolveToCwd(input.path ?? '.', cwd);
      const limit = input.limit ?? DEFAULT_LIMIT;
      const entries = await ops.readdir(basePath);
      entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

      const results: string[] = [];
      for (const entry of entries) {
        if (results.length >= limit) {
          break;
        }
        try {
          const entryStat = await ops.stat(`${basePath}/${entry}`);
          results.push(entryStat.isDirectory() ? `${entry}/` : entry);
        } catch {
          results.push(entry);
        }
      }

      if (results.length === 0) {
        return { output: '(empty directory)' };
      }

      const outputText = results.join('\n');
      const truncation = truncateHead(outputText, {
        maxLines: Number.MAX_SAFE_INTEGER,
      });
      let output = truncation.content;

      if (results.length >= limit) {
        output += `\n\n[${limit} entries limit reached. Use limit=${limit * 2} for more.]`;
      }
      if (truncation.truncated) {
        output += `\n\n[Output truncated at ${formatSize(DEFAULT_MAX_BYTES)}.]`;
      }

      return { output };
    },
  };
}

export const listTool = createListTool(process.cwd());
