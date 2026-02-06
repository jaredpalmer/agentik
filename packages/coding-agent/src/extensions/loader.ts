/**
 * Extension loader — discovers and loads TypeScript extension files.
 *
 * Extensions are loaded from:
 * 1. Global: ~/.agentik/extensions/
 * 2. Project-local: .agentik/extensions/
 * 3. Explicitly configured paths
 *
 * Each extension file must default-export an ExtensionFactory function.
 */

import { existsSync, readdirSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Async extension factory — supports both sync and async init. */
export type ExtensionFactory = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any
) => void | Promise<void>;

export interface LoadedExtension {
  path: string;
  factory: ExtensionFactory;
}

export interface LoadExtensionsResult {
  extensions: LoadedExtension[];
  errors: Array<{ path: string; error: string }>;
}

function isExtensionFile(name: string): boolean {
  return name.endsWith(".ts") || name.endsWith(".js");
}

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Discover extension file paths in a directory (one level deep).
 *
 * - Direct files: dir/*.ts or *.js -> load
 * - Subdirectories with index: dir/{subdir}/index.ts or index.js -> load
 */
function discoverInDir(dir: string): string[] {
  const expanded = expandPath(dir);
  if (!existsSync(expanded)) return [];

  const discovered: string[] = [];

  try {
    const entries: Dirent[] = readdirSync(expanded, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(expanded, entry.name);

      if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
        discovered.push(entryPath);
        continue;
      }

      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const indexTs = join(entryPath, "index.ts");
        const indexJs = join(entryPath, "index.js");
        if (existsSync(indexTs)) {
          discovered.push(indexTs);
        } else if (existsSync(indexJs)) {
          discovered.push(indexJs);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to read extensions directory ${expanded}: ${message}`);
  }

  return discovered;
}

/**
 * Discover extension paths from standard locations.
 */
export function discoverExtensions(cwd: string): string[] {
  const allPaths: string[] = [];
  const seen = new Set<string>();

  const addPaths = (paths: string[]) => {
    for (const p of paths) {
      const resolved = resolve(p);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        allPaths.push(resolved);
      }
    }
  };

  // 1. Global extensions
  const globalDir = join(homedir(), ".agentik", "extensions");
  addPaths(discoverInDir(globalDir));

  // 2. Project-local extensions
  const localDir = join(cwd, ".agentik", "extensions");
  addPaths(discoverInDir(localDir));

  return allPaths;
}

/**
 * Load a single extension from a file path.
 * Returns the factory function or an error.
 */
async function loadSingleExtension(
  extensionPath: string
): Promise<{ factory: ExtensionFactory | null; error: string | null }> {
  try {
    const resolvedPath = resolve(extensionPath);

    if (!existsSync(resolvedPath)) {
      return { factory: null, error: `Extension file not found: ${extensionPath}` };
    }

    const module = await import(resolvedPath);
    const factory = module.default as ExtensionFactory | undefined;

    if (typeof factory !== "function") {
      return {
        factory: null,
        error: `Extension does not export a valid default factory function: ${extensionPath}`,
      };
    }

    return { factory, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      factory: null,
      error: `Failed to load extension ${extensionPath}: ${message}`,
    };
  }
}

/**
 * Load extensions from file paths.
 * Each file must default-export an ExtensionFactory.
 * Errors are isolated per-extension — a failing extension does not crash others.
 */
export async function loadExtensions(paths: string[]): Promise<LoadExtensionsResult> {
  const extensions: LoadedExtension[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const extPath of paths) {
    const { factory, error } = await loadSingleExtension(extPath);

    if (error || !factory) {
      errors.push({ path: extPath, error: error ?? "Unknown error" });
      continue;
    }

    extensions.push({ path: extPath, factory });
  }

  return { extensions, errors };
}

/**
 * Discover and load extensions from standard locations + explicit paths.
 */
export async function discoverAndLoadExtensions(
  cwd: string,
  extraPaths: string[] = []
): Promise<LoadExtensionsResult> {
  const discovered = discoverExtensions(cwd);

  const allPaths = [...discovered];
  const seen = new Set(discovered.map((p) => resolve(p)));

  for (const p of extraPaths) {
    const resolved = resolve(cwd, expandPath(p));
    if (!seen.has(resolved)) {
      seen.add(resolved);
      allPaths.push(resolved);
    }
  }

  return loadExtensions(allPaths);
}
