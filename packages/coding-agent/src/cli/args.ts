/**
 * CLI argument parser for coding-agent runtime toggles.
 */

export interface ParsedCliArgs {
  disableExtensions: boolean;
  disableSkills: boolean;
  disablePromptTemplates: boolean;
  passthroughArgs: string[];
  warnings: string[];
}

const DISABLE_EXTENSIONS_FLAGS = new Set(["--no-extensions", "-ne"]);
const DISABLE_SKILLS_FLAGS = new Set(["--no-skills", "-ns"]);
const DISABLE_PROMPT_TEMPLATES_FLAGS = new Set(["--no-prompt-templates", "-np"]);

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  let disableExtensions = false;
  let disableSkills = false;
  let disablePromptTemplates = false;
  const passthroughArgs: string[] = [];

  for (const arg of argv) {
    if (DISABLE_EXTENSIONS_FLAGS.has(arg)) {
      disableExtensions = true;
      continue;
    }

    if (DISABLE_SKILLS_FLAGS.has(arg)) {
      disableSkills = true;
      continue;
    }

    if (DISABLE_PROMPT_TEMPLATES_FLAGS.has(arg)) {
      disablePromptTemplates = true;
      continue;
    }

    passthroughArgs.push(arg);
  }

  const warnings: string[] = [];
  if (disableExtensions) {
    warnings.push(
      "Ignoring --no-extensions/-ne: extension discovery is not configurable in this build yet."
    );
  }
  if (disableSkills) {
    warnings.push("Ignoring --no-skills/-ns: skills are not configurable in this build yet.");
  }
  if (disablePromptTemplates) {
    warnings.push(
      "Ignoring --no-prompt-templates/-np: prompt templates are not configurable in this build yet."
    );
  }

  return {
    disableExtensions,
    disableSkills,
    disablePromptTemplates,
    passthroughArgs,
    warnings,
  };
}
