import type { TextContent } from "@agentik/office-common";

export async function handleManageAttachments(params: {
  action: "list" | "read" | "add";
  attachmentIndex?: number;
  fileName?: string;
  contentBase64?: string;
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const item = Office.context.mailbox.item;
    if (!item) throw new Error("No email item selected");

    switch (params.action) {
      case "list": {
        const attachments = item.attachments;
        if (!attachments || attachments.length === 0) {
          return { content: [{ type: "text", text: "No attachments" }], isError: false };
        }
        const list = attachments
          .map((a, i) => `${i}. ${a.name} (${a.contentType}, ${a.size} bytes)`)
          .join("\n");
        return { content: [{ type: "text", text: list }], isError: false };
      }

      case "read": {
        if (params.attachmentIndex == null) throw new Error("attachmentIndex required");
        const attachment = item.attachments[params.attachmentIndex];
        if (!attachment) throw new Error(`No attachment at index ${params.attachmentIndex}`);

        const content = await new Promise<string>((resolve, reject) => {
          item.getAttachmentContentAsync(attachment.id, (result) => {
            if (result.status === Office.AsyncResultStatus.Succeeded) {
              resolve(result.value.content);
            } else {
              reject(new Error(result.error.message));
            }
          });
        });
        return {
          content: [
            {
              type: "text",
              text: `Attachment: ${attachment.name}\nContent (truncated): ${content.slice(0, 1000)}`,
            },
          ],
          isError: false,
        };
      }

      case "add": {
        if (!params.fileName || !params.contentBase64) {
          throw new Error("fileName and contentBase64 required for add");
        }
        await new Promise<void>((resolve, reject) => {
          item.addFileAttachmentFromBase64Async(
            params.contentBase64!,
            params.fileName!,
            (result) => {
              if (result.status === Office.AsyncResultStatus.Succeeded) {
                resolve();
              } else {
                reject(new Error(result.error.message));
              }
            }
          );
        });
        return {
          content: [{ type: "text", text: `Added attachment: ${params.fileName}` }],
          isError: false,
        };
      }

      default:
        throw new Error(`Unknown action: ${String(params.action)}`);
    }
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  }
}
