import { z } from "zod";
import type { AgentTool } from "@agentik/agent";
import { readFile, writeFile, access, constants } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";

const parameters = z.object({
  path: z.string().describe("Path to the file to edit (relative or absolute)"),
  oldText: z.string().describe("Exact text to find and replace (must match exactly)"),
  newText: z.string().describe("New text to replace the old text with"),
});

type EditParams = z.infer<typeof parameters>;

interface EditToolDetails {
  diff: string;
  firstChangedLine?: number;
}

// ============================================================================
// Text normalization utilities
// ============================================================================

function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1) return "\n";
  if (crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content };
}

/**
 * Normalize text for fuzzy matching:
 * - Strip trailing whitespace per line
 * - Normalize smart quotes to ASCII
 * - Normalize Unicode dashes to ASCII hyphen
 * - Normalize special Unicode spaces to regular space
 */
function normalizeForFuzzyMatch(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

interface FuzzyMatchResult {
  found: boolean;
  index: number;
  matchLength: number;
  usedFuzzyMatch: boolean;
  contentForReplacement: string;
}

function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  // Try exact match first
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  // Try fuzzy match
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

  if (fuzzyIndex === -1) {
    return {
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
    contentForReplacement: fuzzyContent,
  };
}

// ============================================================================
// Diff generation
// ============================================================================

function generateDiff(
  oldContent: string,
  newContent: string,
  contextLines = 4
): { diff: string; firstChangedLine: number | undefined } {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Find changed regions using simple LCS-based diff
  const changes: Array<{
    type: "equal" | "remove" | "add";
    oldStart: number;
    oldEnd: number;
    newStart: number;
    newEnd: number;
  }> = [];

  // Simple line-by-line diff
  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      // Equal
      const start = oi;
      const nStart = ni;
      while (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
        oi++;
        ni++;
      }
      changes.push({ type: "equal", oldStart: start, oldEnd: oi, newStart: nStart, newEnd: ni });
    } else {
      // Find next common line
      let bestOi = -1;
      let bestNi = -1;
      let bestDist = Infinity;

      const searchWindow = 50;
      for (let so = oi; so < Math.min(oldLines.length, oi + searchWindow); so++) {
        for (let sn = ni; sn < Math.min(newLines.length, ni + searchWindow); sn++) {
          if (oldLines[so] === newLines[sn]) {
            const dist = so - oi + (sn - ni);
            if (dist < bestDist) {
              bestDist = dist;
              bestOi = so;
              bestNi = sn;
            }
            break;
          }
        }
      }

      if (bestOi === -1) {
        // No common line found - rest is all changes
        if (oi < oldLines.length) {
          changes.push({
            type: "remove",
            oldStart: oi,
            oldEnd: oldLines.length,
            newStart: ni,
            newEnd: ni,
          });
        }
        if (ni < newLines.length) {
          changes.push({
            type: "add",
            oldStart: oldLines.length,
            oldEnd: oldLines.length,
            newStart: ni,
            newEnd: newLines.length,
          });
        }
        oi = oldLines.length;
        ni = newLines.length;
      } else {
        if (oi < bestOi) {
          changes.push({ type: "remove", oldStart: oi, oldEnd: bestOi, newStart: ni, newEnd: ni });
        }
        if (ni < bestNi) {
          changes.push({ type: "add", oldStart: oi, oldEnd: oi, newStart: ni, newEnd: bestNi });
        }
        oi = bestOi;
        ni = bestNi;
      }
    }
  }

  // Format output with context
  const maxLineNum = Math.max(oldLines.length, newLines.length);
  const lineNumWidth = String(maxLineNum).length;
  const output: string[] = [];
  let firstChangedLine: number | undefined;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    if (change.type === "remove") {
      if (firstChangedLine === undefined) {
        firstChangedLine = change.newStart + 1;
      }
      for (let l = change.oldStart; l < change.oldEnd; l++) {
        output.push(`-${String(l + 1).padStart(lineNumWidth)} ${oldLines[l]}`);
      }
    } else if (change.type === "add") {
      if (firstChangedLine === undefined) {
        firstChangedLine = change.newStart + 1;
      }
      for (let l = change.newStart; l < change.newEnd; l++) {
        output.push(`+${String(l + 1).padStart(lineNumWidth)} ${newLines[l]}`);
      }
    } else {
      // Equal - show context lines around changes
      const prevIsChange = i > 0 && changes[i - 1].type !== "equal";
      const nextIsChange = i < changes.length - 1 && changes[i + 1].type !== "equal";

      if (prevIsChange || nextIsChange) {
        const totalEqual = change.oldEnd - change.oldStart;
        let start = change.oldStart;
        let end = change.oldEnd;

        if (prevIsChange && nextIsChange) {
          if (totalEqual <= contextLines * 2) {
            // Show all context
          } else {
            // Show trailing context from prev + leading context for next
            for (let l = start; l < Math.min(start + contextLines, end); l++) {
              output.push(` ${String(l + 1).padStart(lineNumWidth)} ${oldLines[l]}`);
            }
            if (end - start > contextLines * 2) {
              output.push(` ${"".padStart(lineNumWidth)} ...`);
            }
            for (let l = Math.max(end - contextLines, start + contextLines); l < end; l++) {
              output.push(` ${String(l + 1).padStart(lineNumWidth)} ${oldLines[l]}`);
            }
            continue;
          }
        } else if (prevIsChange) {
          end = Math.min(start + contextLines, end);
        } else {
          start = Math.max(end - contextLines, start);
        }

        for (let l = start; l < end; l++) {
          output.push(` ${String(l + 1).padStart(lineNumWidth)} ${oldLines[l]}`);
        }
      }
    }
  }

  return { diff: output.join("\n"), firstChangedLine };
}

// ============================================================================
// Tool
// ============================================================================

function resolvePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export const editTool: AgentTool<EditParams, EditToolDetails | undefined> = {
  name: "edit",
  label: "Edit",
  description:
    "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
  parameters,
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) throw new Error("Operation aborted");

    const absolutePath = resolvePath(params.path);

    // Check file exists
    try {
      await access(absolutePath, constants.R_OK | constants.W_OK);
    } catch {
      throw new Error(`File not found: ${params.path}`);
    }

    // Read file
    const rawContent = await readFile(absolutePath, "utf-8");
    const { bom, text: content } = stripBom(rawContent);

    const originalEnding = detectLineEnding(content);
    const normalizedContent = normalizeToLF(content);
    const normalizedOldText = normalizeToLF(params.oldText);
    const normalizedNewText = normalizeToLF(params.newText);

    // Find text with fuzzy matching
    const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);

    if (!matchResult.found) {
      throw new Error(
        `Could not find the exact text in ${params.path}. The old text must match exactly including all whitespace and newlines.`
      );
    }

    // Check uniqueness
    const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
    const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
    const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;

    if (occurrences > 1) {
      throw new Error(
        `Found ${occurrences} occurrences of the text in ${params.path}. The text must be unique. Please provide more context to make it unique.`
      );
    }

    if (signal?.aborted) throw new Error("Operation aborted");

    // Perform replacement
    const baseContent = matchResult.contentForReplacement;
    const newContent =
      baseContent.substring(0, matchResult.index) +
      normalizedNewText +
      baseContent.substring(matchResult.index + matchResult.matchLength);

    if (baseContent === newContent) {
      throw new Error(
        `No changes made to ${params.path}. The replacement produced identical content.`
      );
    }

    const finalContent = bom + restoreLineEndings(newContent, originalEnding);
    await writeFile(absolutePath, finalContent, "utf-8");

    const diffResult = generateDiff(baseContent, newContent);
    return {
      content: [{ type: "text", text: `Successfully replaced text in ${params.path}.` }],
      details: { diff: diffResult.diff, firstChangedLine: diffResult.firstChangedLine },
    };
  },
};
