import { parseClientMessage } from "@agentik/office-common";
import { SessionManager } from "./session-manager.js";

const PORT = Number(process.env.PORT) || 3100;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") ?? ["*"];
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB

const sessionManager = new SessionManager();

function corsHeaders(): Record<string, string> {
  const origin = ALLOWED_ORIGINS.includes("*") ? "*" : ALLOWED_ORIGINS.join(", ");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

const server = Bun.serve({
  port: PORT,

  fetch(req, server) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json(
        { status: "ok", sessions: sessionManager.getSessionCount() },
        { headers: corsHeaders() }
      );
    }

    // OAuth placeholder
    if (url.pathname === "/auth/token" && req.method === "POST") {
      return Response.json({ error: "OAuth coming soon" }, { status: 501, headers: corsHeaders() });
    }

    if (url.pathname === "/auth/callback" && req.method === "POST") {
      return Response.json({ error: "OAuth coming soon" }, { status: 501, headers: corsHeaders() });
    }

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    return new Response("Not found", { status: 404, headers: corsHeaders() });
  },

  websocket: {
    maxPayloadLength: MAX_MESSAGE_SIZE,

    open(ws) {
      sessionManager.create(ws);
    },

    message(ws, message) {
      const session = sessionManager.getByWs(ws);
      if (!session) return;

      const data = typeof message === "string" ? message : new TextDecoder().decode(message);
      const msg = parseClientMessage(data);
      if (!msg) return;

      switch (msg.type) {
        case "init":
          session.init(msg.apiKey, msg.provider, msg.model, msg.appType);
          break;
        case "prompt":
          void session.handlePrompt(msg.content);
          break;
        case "steer":
          session.handleSteer(msg.content);
          break;
        case "abort":
          session.handleAbort();
          break;
        case "tool_result":
          session.handleToolResult(msg.toolCallId, msg.content, msg.isError);
          break;
      }
    },

    close(ws) {
      sessionManager.removeByWs(ws);
    },
  },
});

console.log(`Bridge server listening on http://localhost:${server.port}`);
console.log(`WebSocket endpoint: ws://localhost:${server.port}/ws`);

export { server, sessionManager };
