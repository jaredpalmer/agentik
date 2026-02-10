import type { TextContent } from "@agentik/office-common";

async function getGraphToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    Office.context.mailbox.getCallbackTokenAsync({ isRest: true }, (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        resolve(result.value);
      } else {
        reject(new Error(result.error.message));
      }
    });
  });
}

function getRestUrl(path: string): string {
  return `${Office.context.mailbox.restUrl}/v2.0${path}`;
}

export async function handleCreateEvent(params: {
  subject: string;
  start: string;
  end: string;
  location?: string;
  attendees?: string[];
  body?: string;
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const token = await getGraphToken();
    const event: Record<string, unknown> = {
      Subject: params.subject,
      Start: { DateTime: params.start, TimeZone: "UTC" },
      End: { DateTime: params.end, TimeZone: "UTC" },
    };
    if (params.location) event.Location = { DisplayName: params.location };
    if (params.attendees) {
      event.Attendees = params.attendees.map((email) => ({
        EmailAddress: { Address: email },
        Type: "Required",
      }));
    }
    if (params.body) {
      event.Body = { ContentType: "HTML", Content: params.body };
    }

    const response = await fetch(getRestUrl("/me/events"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
    if (!response.ok) throw new Error(`Event creation failed: ${response.status}`);

    return {
      content: [{ type: "text", text: `Created event: ${params.subject}` }],
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
