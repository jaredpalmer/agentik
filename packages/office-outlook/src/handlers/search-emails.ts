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
  const ewsUrl = Office.context.mailbox.restUrl;
  return `${ewsUrl}/v2.0${path}`;
}

export async function handleSearchEmails(params: {
  query: string;
  folder?: string;
  limit?: number;
  fromDate?: string;
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const token = await getGraphToken();
    const limit = params.limit ?? 10;
    let url = getRestUrl(
      `/me/messages?$search="${encodeURIComponent(params.query)}"&$top=${limit}`
    );
    if (params.folder) {
      url = getRestUrl(
        `/me/mailFolders/${params.folder}/messages?$search="${encodeURIComponent(params.query)}"&$top=${limit}`
      );
    }
    if (params.fromDate) {
      url += `&$filter=receivedDateTime ge ${params.fromDate}`;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Search failed: ${response.status}`);

    const data = (await response.json()) as {
      value: Array<{
        subject: string;
        from: { emailAddress: { address: string } };
        receivedDateTime: string;
        bodyPreview: string;
      }>;
    };
    const output = data.value
      .map(
        (m, i) =>
          `${i + 1}. ${m.subject}\n   From: ${m.from?.emailAddress?.address}\n   Date: ${m.receivedDateTime}\n   Preview: ${m.bodyPreview?.slice(0, 100)}`
      )
      .join("\n\n");

    return {
      content: [{ type: "text", text: output || "No results found" }],
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
