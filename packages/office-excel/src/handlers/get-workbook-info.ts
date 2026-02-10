import type { TextContent } from "@agentik/office-common";

export interface GetWorkbookInfoParams {
  includeTables?: boolean;
  includeNamedRanges?: boolean;
  includeCharts?: boolean;
}

export async function handleGetWorkbookInfo(
  params: GetWorkbookInfoParams
): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const result = await Excel.run(async (context) => {
      const wb = context.workbook;
      const sheets = wb.worksheets;
      sheets.load("items/name,items/position");

      if (params.includeTables) {
        wb.tables.load("items/name,items/columns/items/name");
      }
      if (params.includeNamedRanges) {
        wb.names.load("items/name,items/value,items/type");
      }

      await context.sync();

      // Load row counts for tables (requires second sync)
      if (params.includeTables && wb.tables.items.length > 0) {
        for (const table of wb.tables.items) {
          table.rows.load("count");
        }
        await context.sync();
      }

      const lines: string[] = [];

      // Sheets
      lines.push("## Worksheets");
      for (const sheet of sheets.items) {
        lines.push(`  ${sheet.position}: ${sheet.name}`);
      }

      // Tables
      if (params.includeTables) {
        lines.push("");
        lines.push("## Tables");
        if (wb.tables.items.length === 0) {
          lines.push("  (none)");
        } else {
          for (const table of wb.tables.items) {
            const colNames = table.columns.items.map((c) => c.name).join(", ");
            lines.push(`  ${table.name}: ${table.rows.count} rows [${colNames}]`);
          }
        }
      }

      // Named ranges
      if (params.includeNamedRanges) {
        lines.push("");
        lines.push("## Named Ranges");
        if (wb.names.items.length === 0) {
          lines.push("  (none)");
        } else {
          for (const name of wb.names.items) {
            lines.push(`  ${name.name}: ${name.value} (${name.type})`);
          }
        }
      }

      // Charts (per-sheet)
      if (params.includeCharts) {
        lines.push("");
        lines.push("## Charts");
        let hasCharts = false;
        for (const sheet of sheets.items) {
          const ws = context.workbook.worksheets.getItem(sheet.name);
          ws.charts.load("items/name,items/chartType,items/title/text");
        }
        await context.sync();

        for (const sheet of sheets.items) {
          const ws = context.workbook.worksheets.getItem(sheet.name);
          for (const chart of ws.charts.items) {
            hasCharts = true;
            lines.push(
              `  ${sheet.name}/${chart.name}: ${chart.chartType}${chart.title.text ? ` "${chart.title.text}"` : ""}`
            );
          }
        }
        if (!hasCharts) {
          lines.push("  (none)");
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
