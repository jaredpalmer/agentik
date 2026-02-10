import type { BridgeClient } from "@agentik/office-common";
import { handleComposeEmail } from "./compose-email.js";
import { handleCreateEvent } from "./create-event.js";
import { handleManageAttachments } from "./manage-attachments.js";
import { handleReadCalendar } from "./read-calendar.js";
import { handleReadEmail } from "./read-email.js";
import { handleReplyEmail } from "./reply-email.js";
import { handleSearchEmails } from "./search-emails.js";

type Params = Record<string, unknown>;

export function registerOutlookHandlers(client: BridgeClient): () => void {
  const unsubs = [
    client.registerToolHandler("read_email", (_, __, p: Params) =>
      handleReadEmail(p as Parameters<typeof handleReadEmail>[0])
    ),
    client.registerToolHandler("compose_email", (_, __, p: Params) =>
      handleComposeEmail(p as Parameters<typeof handleComposeEmail>[0])
    ),
    client.registerToolHandler("reply_email", (_, __, p: Params) =>
      handleReplyEmail(p as Parameters<typeof handleReplyEmail>[0])
    ),
    client.registerToolHandler("search_emails", (_, __, p: Params) =>
      handleSearchEmails(p as Parameters<typeof handleSearchEmails>[0])
    ),
    client.registerToolHandler("read_calendar", (_, __, p: Params) =>
      handleReadCalendar(p as Parameters<typeof handleReadCalendar>[0])
    ),
    client.registerToolHandler("create_event", (_, __, p: Params) =>
      handleCreateEvent(p as Parameters<typeof handleCreateEvent>[0])
    ),
    client.registerToolHandler("manage_attachments", (_, __, p: Params) =>
      handleManageAttachments(p as Parameters<typeof handleManageAttachments>[0])
    ),
  ];
  return () => unsubs.forEach((fn) => fn());
}
