import type { AgentTool } from "@agentik/agent";
import { bashTool } from "./bash.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { lsTool } from "./ls.js";

export { bashTool, readFileTool, writeFileTool, editTool, globTool, grepTool, lsTool };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const codingTools: AgentTool<any, any>[] = [
  bashTool,
  readFileTool,
  writeFileTool,
  editTool,
  globTool,
  grepTool,
  lsTool,
];
