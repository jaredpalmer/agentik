export interface OfficeContextInfo {
  appType: "excel" | "powerpoint" | "outlook";
  /** e.g., current selection in Excel, active slide in PowerPoint */
  activeContext?: string;
  /** Workbook/presentation/mailbox name */
  documentName?: string;
}
