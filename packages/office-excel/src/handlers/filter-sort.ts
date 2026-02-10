import type { TextContent } from "@agentik/office-common";

export interface FilterSortParams {
  tableName: string;
  sort?: { column: string; ascending?: boolean }[];
  filters?: { column: string; values: string[] }[];
}

export async function handleFilterSort(
  params: FilterSortParams
): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const result = await Excel.run(async (context) => {
      const table = context.workbook.tables.getItem(params.tableName);
      table.columns.load("items/name,items/index");
      await context.sync();

      const actions: string[] = [];

      // Apply sorting
      if (params.sort && params.sort.length > 0) {
        const sortFields: Excel.SortField[] = params.sort.map((s) => {
          const col = table.columns.items.find((c) => c.name === s.column);
          const columnIndex = col ? col.index : parseInt(s.column, 10);
          return {
            key: columnIndex,
            ascending: s.ascending !== false,
          } as Excel.SortField;
        });

        table.sort.apply(sortFields);
        actions.push(
          `Sorted by ${params.sort.map((s) => `${s.column} ${s.ascending !== false ? "asc" : "desc"}`).join(", ")}`
        );
      }

      // Apply filters
      if (params.filters && params.filters.length > 0) {
        for (const filter of params.filters) {
          const col = table.columns.items.find((c) => c.name === filter.column);
          const columnIndex = col ? col.index : parseInt(filter.column, 10);
          const column = table.columns.getItemAt(columnIndex);
          column.filter.applyValuesFilter(filter.values);
          actions.push(`Filtered ${filter.column} by [${filter.values.join(", ")}]`);
        }
      }

      await context.sync();
      return actions.length > 0 ? actions.join("; ") : "No sort or filter criteria provided";
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
