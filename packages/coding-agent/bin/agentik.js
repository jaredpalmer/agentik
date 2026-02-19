#!/usr/bin/env node
import { runCli } from "../dist/cli.js";

runCli().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
