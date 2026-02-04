import { SessionManager, compact } from "@agentik/runtime";

const sessions = new SessionManager({
  cwd: process.cwd(),
  sessionDir: ".agentik-example/sessions",
  persist: false,
});

sessions.appendMessage({ role: "user", content: "Summarize this conversation." });
sessions.appendMessage({ role: "assistant", content: "Got it." });
sessions.appendMessage({ role: "user", content: "Add a short plan." });

const result = await compact({
  entries: sessions.getEntries(),
  leafId: sessions.getLeafId(),
  contextWindow: 2000,
  settings: { reserveTokens: 0, keepRecentTokens: 1 },
  summarize: async (messages) =>
    `Summary of ${messages.length} messages: ${messages
      .map((m) => (typeof m.content === "string" ? m.content : "[content]"))
      .join(" | ")}`,
});

if (result) {
  sessions.appendCompaction(result.summary, result.firstKeptEntryId, result.tokensBefore);
  console.log("Compaction entry appended.");
} else {
  console.log("Compaction skipped.");
}
