import { z } from "zod";
import type { RemoteToolDefinition } from "../remote-tool.js";

export const excelToolDefinitions: RemoteToolDefinition[] = [
  {
    name: "read_range",
    label: "Read Range",
    description:
      "Read cell values from a range in the workbook. Returns tab-separated values with headers.",
    parameters: z.object({
      range: z.string().describe("Cell range like A1:C10 or a named range"),
      sheet: z.string().optional().describe("Sheet name (defaults to active sheet)"),
      includeFormulas: z.boolean().optional().describe("Include formulas alongside values"),
    }),
  },
  {
    name: "write_range",
    label: "Write Range",
    description: "Write values to a range of cells in the workbook.",
    parameters: z.object({
      range: z.string().describe("Starting cell range like A1 or A1:C5"),
      values: z.array(z.array(z.unknown())).describe("2D array of values to write"),
      sheet: z.string().optional().describe("Sheet name (defaults to active sheet)"),
    }),
  },
  {
    name: "add_formula",
    label: "Add Formula",
    description: "Set a formula in a cell, optionally filling down to adjacent cells.",
    parameters: z.object({
      cell: z.string().describe("Target cell like B2"),
      formula: z.string().describe("Excel formula like =SUM(A1:A10)"),
      sheet: z.string().optional().describe("Sheet name (defaults to active sheet)"),
      fillDown: z.number().optional().describe("Number of rows to fill the formula down"),
    }),
  },
  {
    name: "format_cells",
    label: "Format Cells",
    description: "Apply formatting to a range of cells.",
    parameters: z.object({
      range: z.string().describe("Cell range to format"),
      bold: z.boolean().optional().describe("Set bold"),
      italic: z.boolean().optional().describe("Set italic"),
      fillColor: z.string().optional().describe("Background color hex like #FF0000"),
      fontColor: z.string().optional().describe("Font color hex"),
      numberFormat: z.string().optional().describe("Number format like #,##0.00 or 0%"),
      fontSize: z.number().optional().describe("Font size in points"),
      sheet: z.string().optional().describe("Sheet name"),
    }),
  },
  {
    name: "create_chart",
    label: "Create Chart",
    description: "Create a chart from a data range.",
    parameters: z.object({
      dataRange: z.string().describe("Data range for the chart like A1:D10"),
      chartType: z
        .string()
        .describe("Chart type: ColumnClustered, Line, Pie, Bar, Area, XYScatter"),
      title: z.string().optional().describe("Chart title"),
      sheet: z.string().optional().describe("Sheet name"),
    }),
  },
  {
    name: "manage_sheets",
    label: "Manage Sheets",
    description: "List, create, rename, delete, or activate worksheets.",
    parameters: z.object({
      action: z.enum(["list", "create", "rename", "delete", "activate"]),
      name: z.string().optional().describe("Sheet name (for create/rename/delete/activate)"),
      newName: z.string().optional().describe("New name (for rename action)"),
    }),
  },
  {
    name: "create_table",
    label: "Create Table",
    description: "Create an Excel table from a range of data.",
    parameters: z.object({
      range: z.string().describe("Data range for the table"),
      hasHeaders: z
        .boolean()
        .optional()
        .describe("Whether the first row contains headers (default: true)"),
      name: z.string().optional().describe("Table name"),
      style: z.string().optional().describe("Table style like TableStyleMedium2"),
      sheet: z.string().optional().describe("Sheet name"),
    }),
  },
  {
    name: "filter_sort",
    label: "Filter & Sort",
    description: "Apply sorting and filtering to a table.",
    parameters: z.object({
      tableName: z.string().describe("Name of the table"),
      sort: z
        .array(
          z.object({
            column: z.string().describe("Column name or index"),
            ascending: z.boolean().optional().describe("Sort ascending (default: true)"),
          })
        )
        .optional()
        .describe("Sort criteria"),
      filters: z
        .array(
          z.object({
            column: z.string().describe("Column name or index"),
            values: z.array(z.string()).describe("Values to filter by"),
          })
        )
        .optional()
        .describe("Filter criteria"),
    }),
  },
  {
    name: "get_workbook_info",
    label: "Get Workbook Info",
    description:
      "Get an overview of the workbook structure including sheets, tables, named ranges, and charts.",
    parameters: z.object({
      includeTables: z.boolean().optional().describe("Include table information"),
      includeNamedRanges: z.boolean().optional().describe("Include named ranges"),
      includeCharts: z.boolean().optional().describe("Include chart information"),
    }),
  },
];
