import type { TextContent } from "@agentik/office-common";

export async function handleReadEmail(params: {
  fields?: string[];
  bodyFormat?: "text" | "html";
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const item = Office.context.mailbox.item;
    if (!item) throw new Error("No email item selected");

    const info: Record<string, string> = {};
    info.subject = item.subject;
    info.from = item.from?.emailAddress ?? "unknown";
    info.to = (item.to ?? []).map((r) => r.emailAddress).join(", ");
    info.cc = (item.cc ?? []).map((r) => r.emailAddress).join(", ");
    info.date = item.dateTimeCreated?.toISOString() ?? "unknown";

    const body = await new Promise<string>((resolve, reject) => {
      item.body.getAsync(
        params.bodyFormat === "html" ? Office.CoercionType.Html : Office.CoercionType.Text,
        (result) => {
          if (result.status === Office.AsyncResultStatus.Succeeded) {
            resolve(result.value);
          } else {
            reject(new Error(result.error.message));
          }
        }
      );
    });
    info.body = body;

    const fields = params.fields ?? Object.keys(info);
    const output = fields.map((f) => `${f}: ${info[f] ?? "N/A"}`).join("\n");
    return { content: [{ type: "text", text: output }], isError: false };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  }
}
