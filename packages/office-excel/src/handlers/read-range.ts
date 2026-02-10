import type { TextContent } from "@agentik/office-common";

export interface ReadRangeParams {
  range: string;
  sheet?: string;
  includeFormulas?: boolean;
}

export async function handleReadRange(
  params: ReadRangeParams
): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const result = await Excel.run(async (context) => {
      const sheet = params.sheet
        ? context.workbook.worksheets.getItem(params.sheet)
        : context.workbook.worksheets.getActiveWorksheet();
      const range = sheet.getRange(params.range);
      range.load("values");
      if (params.includeFormulas) range.load("formulas");
      await context.sync();

      const lines: string[] = [];
      for (const row of range.values) {
        lines.push(row.map(String).join("\t"));
      }

      if (params.includeFormulas) {
        lines.push("");
        lines.push("--- Formulas ---");
        for (const row of range.formulas) {
          lines.push(row.map(String).join("\t"));
        }
      }

      return lines.join("\n");
    });

    return { content: [{ type: "text", text: result }], isError: false };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  }
}
