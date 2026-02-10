import type { OfficeContextInfo } from "@agentik/office-common";

export type ExcelContextListener = (info: OfficeContextInfo) => void;

/**
 * Listen for Excel selection and sheet changes, emitting context updates.
 * Returns a cleanup function to remove the event listeners.
 */
export function listenExcelContext(listener: ExcelContextListener): () => void {
  let disposed = false;

  async function fetchContext(): Promise<void> {
    if (disposed) return;
    try {
      await Excel.run(async (context) => {
        const activeSheet = context.workbook.worksheets.getActiveWorksheet();
        const selection = context.workbook.getSelectedRange();
        activeSheet.load("name");
        selection.load("address");
        await context.sync();

        if (disposed) return;

        listener({
          appType: "excel",
          activeContext: `Selection: ${selection.address}`,
          documentName: activeSheet.name,
        });
      });
    } catch {
      // Silently ignore context fetch errors (e.g., workbook not ready)
    }
  }

  // Initial fetch
  void fetchContext();

  // Poll for changes since Office.js selection events are limited in add-in taskpanes
  const interval = setInterval(() => {
    void fetchContext();
  }, 2000);

  return () => {
    disposed = true;
    clearInterval(interval);
  };
}
