import type { LanguageModel } from 'ai';
import { createAgentSession } from '@openagent/agent-sdk';
import { TuiApp } from '@openagent/tui';

type CliMode = 'interactive' | 'print' | 'rpc';

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = new Set(argv);
  const mode = parseMode(args);
  const prompt = getArgValue(argv, '--prompt');
  const model = process.env.OPENAGENT_MODEL as LanguageModel | undefined;

  if (!model) {
    throw new Error('OPENAGENT_MODEL is required.');
  }

  const { session } = await createAgentSession({ model });

  if (mode === 'interactive') {
    const app = new TuiApp({ runtime: session.runtime });
    await app.start();
    return;
  }

  if (mode === 'rpc') {
    throw new Error('RPC mode is not implemented yet.');
  }

  if (!prompt) {
    throw new Error('--prompt is required in print mode.');
  }

  session.runtime.subscribe(event => {
    if (event.type === 'message_update') {
      process.stdout.write(event.delta);
    }
  });

  await session.runtime.prompt(prompt);
}

function parseMode(args: Set<string>): CliMode {
  if (args.has('--print')) {
    return 'print';
  }
  if (args.has('--rpc')) {
    return 'rpc';
  }
  return 'interactive';
}

function getArgValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}
