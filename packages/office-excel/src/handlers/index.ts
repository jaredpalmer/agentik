import type { BridgeClient } from "@agentik/office-common";
import { handleAddFormula } from "./add-formula.js";
import { handleCreateChart } from "./create-chart.js";
import { handleCreateTable } from "./create-table.js";
import { handleFilterSort } from "./filter-sort.js";
import { handleFormatCells } from "./format-cells.js";
import { handleGetWorkbookInfo } from "./get-workbook-info.js";
import { handleManageSheets } from "./manage-sheets.js";
import { handleReadRange } from "./read-range.js";
import { handleWriteRange } from "./write-range.js";

import type { AddFormulaParams } from "./add-formula.js";
import type { CreateChartParams } from "./create-chart.js";
import type { CreateTableParams } from "./create-table.js";
import type { FilterSortParams } from "./filter-sort.js";
import type { FormatCellsParams } from "./format-cells.js";
import type { GetWorkbookInfoParams } from "./get-workbook-info.js";
import type { ManageSheetsParams } from "./manage-sheets.js";
import type { ReadRangeParams } from "./read-range.js";
import type { WriteRangeParams } from "./write-range.js";

/**
 * Register all Excel tool handlers with the bridge client.
 * Returns a cleanup function to unregister all handlers.
 */
export function registerExcelHandlers(client: BridgeClient): () => void {
  const unsubs = [
    client.registerToolHandler("read_range", (_id, _name, params) =>
      handleReadRange(params as unknown as ReadRangeParams)
    ),
    client.registerToolHandler("write_range", (_id, _name, params) =>
      handleWriteRange(params as unknown as WriteRangeParams)
    ),
    client.registerToolHandler("add_formula", (_id, _name, params) =>
      handleAddFormula(params as unknown as AddFormulaParams)
    ),
    client.registerToolHandler("format_cells", (_id, _name, params) =>
      handleFormatCells(params as unknown as FormatCellsParams)
    ),
    client.registerToolHandler("create_chart", (_id, _name, params) =>
      handleCreateChart(params as unknown as CreateChartParams)
    ),
    client.registerToolHandler("manage_sheets", (_id, _name, params) =>
      handleManageSheets(params as unknown as ManageSheetsParams)
    ),
    client.registerToolHandler("create_table", (_id, _name, params) =>
      handleCreateTable(params as unknown as CreateTableParams)
    ),
    client.registerToolHandler("filter_sort", (_id, _name, params) =>
      handleFilterSort(params as unknown as FilterSortParams)
    ),
    client.registerToolHandler("get_workbook_info", (_id, _name, params) =>
      handleGetWorkbookInfo(params as unknown as GetWorkbookInfoParams)
    ),
  ];

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
