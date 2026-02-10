import { describe, expect, it, mock } from "bun:test";
import { handleWriteRange } from "../../src/handlers/write-range.js";

// Mock Excel.run
function mockExcelRun() {
  let writtenValues: unknown[][] | null = null;
  const mockRange = {
    get values() {
      return writtenValues;
    },
    set values(v: unknown[][]) {
      writtenValues = v;
    },
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

  return { mockContext, mockSheet, mockRange, getWrittenValues: () => writtenValues };
}

describe("handleWriteRange", () => {
  it("should write values to a range", async () => {
    const { getWrittenValues } = mockExcelRun();

    const values = [
      ["Name", "Age"],
      ["Alice", 30],
    ];

    const result = await handleWriteRange({ range: "A1:B2", values });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Successfully wrote 2x2 values to A1:B2");
    expect(getWrittenValues()).toEqual(values);
  });

  it("should use specified sheet name", async () => {
    const { mockContext } = mockExcelRun();

    await handleWriteRange({
      range: "A1:B1",
      values: [["x", "y"]],
      sheet: "Data",
    });

    expect(mockContext.workbook.worksheets.getItem).toHaveBeenCalledWith("Data");
  });

  it("should use active worksheet when no sheet specified", async () => {
    const { mockContext } = mockExcelRun();

    await handleWriteRange({
      range: "A1",
      values: [["hello"]],
    });

    expect(mockContext.workbook.worksheets.getActiveWorksheet).toHaveBeenCalled();
  });

  it("should return error on failure", async () => {
    (globalThis as Record<string, unknown>).Excel = {
      run: mock(async () => {
        throw new Error("Write failed");
      }),
    };

    const result = await handleWriteRange({
      range: "A1",
      values: [["test"]],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error: Write failed");
  });

  it("should handle empty values array", async () => {
    mockExcelRun();

    const result = await handleWriteRange({
      range: "A1",
      values: [],
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("0x0");
  });
});
