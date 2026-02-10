import type { TextContent } from "@agentik/office-common";

export interface ManageSheetsParams {
  action: "list" | "create" | "rename" | "delete" | "activate";
  name?: string;
  newName?: string;
}

export async function handleManageSheets(
  params: ManageSheetsParams
): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const result = await Excel.run(async (context) => {
      const sheets = context.workbook.worksheets;

      switch (params.action) {
        case "list": {
          sheets.load("items/name,items/position,items/visibility");
          await context.sync();
          const info = sheets.items.map((s) => ({
            name: s.name,
            position: s.position,
            visibility: s.visibility,
          }));
          return `Worksheets:\n${info.map((s) => `  ${s.position}: ${s.name} (${s.visibility})`).join("\n")}`;
        }

        case "create": {
          if (!params.name) return "Error: name is required for create action";
          const newSheet = sheets.add(params.name);
          newSheet.load("name");
          await context.sync();
          return `Created worksheet "${newSheet.name}"`;
        }

        case "rename": {
          if (!params.name) return "Error: name is required for rename action";
          if (!params.newName) return "Error: newName is required for rename action";
          const sheet = sheets.getItem(params.name);
          sheet.name = params.newName;
          await context.sync();
          return `Renamed worksheet "${params.name}" to "${params.newName}"`;
        }

        case "delete": {
          if (!params.name) return "Error: name is required for delete action";
          const sheet = sheets.getItem(params.name);
          sheet.delete();
          await context.sync();
          return `Deleted worksheet "${params.name}"`;
        }

        case "activate": {
          if (!params.name) return "Error: name is required for activate action";
          const sheet = sheets.getItem(params.name);
          sheet.activate();
          await context.sync();
          return `Activated worksheet "${params.name}"`;
        }

        default:
          return `Unknown action: ${String(params.action)}`;
      }
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
