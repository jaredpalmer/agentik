import { describe, expect, it, mock } from "bun:test";
import { handleReadRange } from "../../src/handlers/read-range.js";

// Mock Excel.run
function mockExcelRun(values: unknown[][], formulas?: unknown[][]) {
  const mockRange = {
    values,
    formulas: formulas ?? [],
    load: mock(() => {}),
  };
  const mockSheet = {
    getRange: mock(() => mockRange),
  };
  const mockContext = {
    workbook: {
      worksheets: {
        getActiveWorksheet: mock(() => mockSheet),
        getItem: mock(() => mockSheet),
      },
    },
    sync: mock(async () => {}),
  };

  (globalThis as Record<string, unknown>).Excel = {
    run: mock(async (callback: (context: typeof mockContext) => Promise<unknown>) => {
      return callback(mockContext);
    }),
  };

  return { mockContext, mockSheet, mockRange };
}

describe("handleReadRange", () => {
  it("should read values from a range", async () => {
    mockExcelRun([
      ["Name", "Age"],
      ["Alice", 30],
      ["Bob", 25],
    ]);

    const result = await handleReadRange({ range: "A1:B3" });

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Name\tAge");
    expect(result.content[0].text).toContain("Alice\t30");
    expect(result.content[0].text).toContain("Bob\t25");
  });

  it("should include formulas when requested", async () => {
    mockExcelRun([["Total", 100]], [["Total", "=SUM(B1:B10)"]]);

    const result = await handleReadRange({
      range: "A1:B1",
      includeFormulas: true,
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("--- Formulas ---");
    expect(result.content[0].text).toContain("=SUM(B1:B10)");
  });

  it("should use specified sheet name", async () => {
    const { mockContext } = mockExcelRun([["data"]]);

    await handleReadRange({ range: "A1", sheet: "Sheet2" });

    expect(mockContext.workbook.worksheets.getItem).toHaveBeenCalledWith("Sheet2");
  });

  it("should use active worksheet when no sheet specified", async () => {
    const { mockContext } = mockExcelRun([["data"]]);

    await handleReadRange({ range: "A1" });

    expect(mockContext.workbook.worksheets.getActiveWorksheet).toHaveBeenCalled();
  });

  it("should return error on failure", async () => {
    (globalThis as Record<string, unknown>).Excel = {
      run: mock(async () => {
        throw new Error("Range not found");
      }),
    };

    const result = await handleReadRange({ range: "INVALID" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error: Range not found");
  });
});
