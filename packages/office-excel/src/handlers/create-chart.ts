import type { TextContent } from "@agentik/office-common";

export interface CreateChartParams {
  dataRange: string;
  chartType: string;
  title?: string;
  sheet?: string;
}

export async function handleCreateChart(
  params: CreateChartParams
): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const chartName = await Excel.run(async (context) => {
      const sheet = params.sheet
        ? context.workbook.worksheets.getItem(params.sheet)
        : context.workbook.worksheets.getActiveWorksheet();
      const range = sheet.getRange(params.dataRange);

      const chart = sheet.charts.add(
        params.chartType as Excel.ChartType,
        range,
        Excel.ChartSeriesBy.auto
      );

      if (params.title) {
        chart.title.text = params.title;
      }

      // Position the chart near the data
      chart.left = 0;
      chart.top = 0;
      chart.width = 500;
      chart.height = 300;

      chart.load("name");
      await context.sync();
      return chart.name;
    });

    return {
      content: [
        {
          type: "text",
          text: `Created ${params.chartType} chart "${chartName}"${params.title ? ` with title "${params.title}"` : ""} from range ${params.dataRange}`,
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
