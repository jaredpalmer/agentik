import type { TextContent } from "@agentik/office-common";

export interface FormatCellsParams {
  range: string;
  bold?: boolean;
  italic?: boolean;
  fillColor?: string;
  fontColor?: string;
  numberFormat?: string;
  fontSize?: number;
  sheet?: string;
}

export async function handleFormatCells(
  params: FormatCellsParams
): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    await Excel.run(async (context) => {
      const sheet = params.sheet
        ? context.workbook.worksheets.getItem(params.sheet)
        : context.workbook.worksheets.getActiveWorksheet();
      const range = sheet.getRange(params.range);

      if (params.bold !== undefined) {
        range.format.font.bold = params.bold;
      }
      if (params.italic !== undefined) {
        range.format.font.italic = params.italic;
      }
      if (params.fillColor !== undefined) {
        range.format.fill.color = params.fillColor;
      }
      if (params.fontColor !== undefined) {
        range.format.font.color = params.fontColor;
      }
      if (params.numberFormat !== undefined) {
        range.numberFormat = [[params.numberFormat]];
      }
      if (params.fontSize !== undefined) {
        range.format.font.size = params.fontSize;
      }

      await context.sync();
    });

    const applied: string[] = [];
    if (params.bold !== undefined) applied.push(`bold=${params.bold}`);
    if (params.italic !== undefined) applied.push(`italic=${params.italic}`);
    if (params.fillColor) applied.push(`fillColor=${params.fillColor}`);
    if (params.fontColor) applied.push(`fontColor=${params.fontColor}`);
    if (params.numberFormat) applied.push(`numberFormat=${params.numberFormat}`);
    if (params.fontSize) applied.push(`fontSize=${params.fontSize}`);

    return {
      content: [
        {
          type: "text",
          text: `Applied formatting to ${params.range}: ${applied.join(", ")}`,
        },
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
