import type { TextContent } from "@agentik/office-common";

export interface WriteRangeParams {
  range: string;
  values: unknown[][];
  sheet?: string;
}

export async function handleWriteRange(
  params: WriteRangeParams
): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    await Excel.run(async (context) => {
      const sheet = params.sheet
        ? context.workbook.worksheets.getItem(params.sheet)
        : context.workbook.worksheets.getActiveWorksheet();
      const range = sheet.getRange(params.range);

      range.values = params.values;
      await context.sync();
    });

    const rows = params.values.length;
    const cols = params.values[0]?.length ?? 0;
    return {
      content: [
        { type: "text", text: `Successfully wrote ${rows}x${cols} values to ${params.range}` },
      ],
      isError: false,
    };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  }
}
