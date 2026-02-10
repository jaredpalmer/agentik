import type { TextContent } from "@agentik/office-common";

export interface AddFormulaParams {
  cell: string;
  formula: string;
  sheet?: string;
  fillDown?: number;
}

export async function handleAddFormula(
  params: AddFormulaParams
): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    await Excel.run(async (context) => {
      const sheet = params.sheet
        ? context.workbook.worksheets.getItem(params.sheet)
        : context.workbook.worksheets.getActiveWorksheet();

      const cell = sheet.getRange(params.cell);
      cell.formulas = [[params.formula]];

      if (params.fillDown && params.fillDown > 0) {
        // Get the cell's row and column indices to construct a fill range
        cell.load("rowIndex,columnIndex");
        await context.sync();

        const startRow = cell.rowIndex;
        const col = cell.columnIndex;
        const fillRange = sheet.getRangeByIndexes(startRow, col, params.fillDown + 1, 1);
        cell.autoFill(fillRange.getAbsoluteResizedRange(params.fillDown + 1, 1));
      }

      await context.sync();
    });

    const msg = params.fillDown
      ? `Set formula ${params.formula} in ${params.cell} and filled down ${params.fillDown} rows`
      : `Set formula ${params.formula} in ${params.cell}`;

    return { content: [{ type: "text", text: msg }], isError: false };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  }
}
