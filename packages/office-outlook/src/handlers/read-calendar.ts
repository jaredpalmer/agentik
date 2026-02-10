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

export async function handleReadCalendar(params: {
  startDate: string;
  endDate: string;
  limit?: number;
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const token = await getGraphToken();
    const limit = params.limit ?? 20;
    const url = getRestUrl(
      `/me/calendarView?startDateTime=${params.startDate}&endDateTime=${params.endDate}&$top=${limit}&$orderby=start/dateTime`
    );

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
    });
    if (!response.ok) throw new Error(`Calendar read failed: ${response.status}`);

    const data = (await response.json()) as {
      value: Array<{
        subject: string;
        start: { dateTime: string };
        end: { dateTime: string };
        location?: { displayName: string };
        organizer?: { emailAddress: { name: string } };
      }>;
    };
    const output = data.value
      .map(
        (e, i) =>
          `${i + 1}. ${e.subject}\n   ${e.start.dateTime} - ${e.end.dateTime}\n   Location: ${e.location?.displayName ?? "N/A"}\n   Organizer: ${e.organizer?.emailAddress?.name ?? "N/A"}`
      )
      .join("\n\n");

    return {
      content: [{ type: "text", text: output || "No events found" }],
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
