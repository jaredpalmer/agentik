import type { TextContent } from "@agentik/office-common";

export async function handleComposeEmail(params: {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  bodyType?: "text" | "html";
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    Office.context.mailbox.displayNewMessageForm({
      toRecipients: params.to,
      ccRecipients: params.cc,
      subject: params.subject,
      htmlBody: params.bodyType !== "text" ? params.body : undefined,
    });
    return {
      content: [{ type: "text", text: `Opened compose form to: ${params.to.join(", ")}` }],
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
