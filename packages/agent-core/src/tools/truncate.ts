export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export type TruncationResult = {
  content: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
};

export type TruncationOptions = {
  maxLines?: number;
  maxBytes?: number;
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = content.split("\n");
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
    };
  }

  const outputLines: string[] = [];
  let outputBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";

  for (let index = 0; index < lines.length && index < maxLines; index += 1) {
    const line = lines[index];
    const lineBytes = Buffer.byteLength(line, "utf-8") + (index > 0 ? 1 : 0);
    if (outputBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    outputLines.push(line);
    outputBytes += lineBytes;
  }

  return {
    content: outputLines.join("\n"),
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLines.length,
    outputBytes: Buffer.byteLength(outputLines.join("\n"), "utf-8"),
  };
}

export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = content.split("\n");
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
    };
  }

  const outputLines: string[] = [];
  let outputBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (outputLines.length >= maxLines) {
      truncatedBy = "lines";
      break;
    }
    const line = lines[index];
    const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLines.length > 0 ? 1 : 0);
    if (outputBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    outputLines.unshift(line);
    outputBytes += lineBytes;
  }

  const output = outputLines.join("\n");
  return {
    content: output,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLines.length,
    outputBytes: Buffer.byteLength(output, "utf-8"),
  };
}
