import type { TextContent } from "@agentik/office-common";

export interface CreateTableParams {
  range: string;
  hasHeaders?: boolean;
  name?: string;
  style?: string;
  sheet?: string;
}

export async function handleCreateTable(
  params: CreateTableParams
): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const tableName = await Excel.run(async (context) => {
      const sheet = params.sheet
        ? context.workbook.worksheets.getItem(params.sheet)
        : context.workbook.worksheets.getActiveWorksheet();
      const range = sheet.getRange(params.range);

      const hasHeaders = params.hasHeaders !== false; // default true
      const table = sheet.tables.add(range, hasHeaders);

      if (params.name) {
        table.name = params.name;
      }
      if (params.style) {
        table.style = params.style;
      }

      table.load("name");
      await context.sync();
      return table.name;
    });

    return {
      content: [
        {
          type: "text",
          text: `Created table "${tableName}" from range ${params.range}${params.style ? ` with style ${params.style}` : ""}`,
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
