import type { TextContent } from "@agentik/office-common";

export async function handleReplyEmail(params: {
  body: string;
  replyAll?: boolean;
  bodyType?: "text" | "html";
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const item = Office.context.mailbox.item;
    if (!item) throw new Error("No email item selected");

    const bodyHtml = params.bodyType !== "text" ? params.body : `<pre>${params.body}</pre>`;

    if (params.replyAll) {
      item.displayReplyAllForm(bodyHtml);
    } else {
      item.displayReplyForm(bodyHtml);
    }
    return {
      content: [{ type: "text", text: `Opened ${params.replyAll ? "reply all" : "reply"} form` }],
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
