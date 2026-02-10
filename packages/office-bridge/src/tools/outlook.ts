import { z } from "zod";
import type { RemoteToolDefinition } from "../remote-tool.js";

export const outlookToolDefinitions: RemoteToolDefinition[] = [
  {
    name: "read_email",
    label: "Read Email",
    description: "Read the currently open email's subject, sender, body, and other fields.",
    parameters: z.object({
      fields: z
        .array(z.string())
        .optional()
        .describe("Specific fields to read: subject, from, to, cc, body, date, attachments"),
      bodyFormat: z.enum(["text", "html"]).optional().describe("Body format (default: text)"),
    }),
  },
  {
    name: "compose_email",
    label: "Compose Email",
    description: "Open a new email compose form with pre-filled fields.",
    parameters: z.object({
      to: z.array(z.string()).describe("Recipient email addresses"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body content"),
      cc: z.array(z.string()).optional().describe("CC recipients"),
      bcc: z.array(z.string()).optional().describe("BCC recipients"),
      bodyType: z.enum(["text", "html"]).optional().describe("Body type (default: html)"),
    }),
  },
  {
    name: "reply_email",
    label: "Reply to Email",
    description: "Open a reply form for the current email.",
    parameters: z.object({
      body: z.string().describe("Reply body content"),
      replyAll: z.boolean().optional().describe("Reply to all recipients"),
      bodyType: z.enum(["text", "html"]).optional().describe("Body type (default: html)"),
    }),
  },
  {
    name: "search_emails",
    label: "Search Emails",
    description: "Search for emails using Microsoft Graph API.",
    parameters: z.object({
      query: z.string().describe("Search query string"),
      folder: z.string().optional().describe("Folder to search in (default: inbox)"),
      limit: z.number().optional().describe("Max results to return (default: 10)"),
      fromDate: z.string().optional().describe("Filter emails from this date (ISO 8601)"),
    }),
  },
  {
    name: "read_calendar",
    label: "Read Calendar",
    description: "Read calendar events in a date range using Microsoft Graph API.",
    parameters: z.object({
      startDate: z.string().describe("Start date (ISO 8601)"),
      endDate: z.string().describe("End date (ISO 8601)"),
      limit: z.number().optional().describe("Max events to return (default: 20)"),
    }),
  },
  {
    name: "create_event",
    label: "Create Calendar Event",
    description: "Create a new calendar event using Microsoft Graph API.",
    parameters: z.object({
      subject: z.string().describe("Event subject/title"),
      start: z.string().describe("Start time (ISO 8601)"),
      end: z.string().describe("End time (ISO 8601)"),
      location: z.string().optional().describe("Event location"),
      attendees: z.array(z.string()).optional().describe("Attendee email addresses"),
      body: z.string().optional().describe("Event description/body"),
    }),
  },
  {
    name: "manage_attachments",
    label: "Manage Attachments",
    description: "List, read, or add attachments to the current email.",
    parameters: z.object({
      action: z.enum(["list", "read", "add"]),
      attachmentIndex: z.number().optional().describe("Attachment index for read action"),
      fileName: z.string().optional().describe("File name for add action"),
      contentBase64: z.string().optional().describe("Base64 content for add action"),
    }),
  },
];
