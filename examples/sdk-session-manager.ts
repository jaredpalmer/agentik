import { SessionManager } from "@agentik/runtime";

const sessions = new SessionManager({
  cwd: process.cwd(),
  sessionDir: ".agentik-example/sessions",
  persist: true,
});

const rootId = sessions.appendMessage({ role: "user", content: "Hello from JSONL." });
sessions.appendMessage({ role: "assistant", content: "Stored in the session file." });

sessions.branch(rootId);
sessions.appendMessage({ role: "user", content: "Branching from the first message." });

const tree = sessions.getTree();
console.log(`Tree roots: ${tree.length}`);
console.log("Session file:", sessions.getSessionFile());
