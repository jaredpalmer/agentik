import { describe, expect, test } from "bun:test";
import {
  type ClientMessage,
  ErrorCode,
  type ServerMessage,
  parseClientMessage,
  parseServerMessage,
  serializeClientMessage,
  serializeServerMessage,
} from "../src/protocol.js";

describe("protocol", () => {
  describe("serializeClientMessage / parseClientMessage", () => {
    test("round-trips init message", () => {
      const msg: ClientMessage = {
        type: "init",
        apiKey: "sk-test-123",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
      };
      const serialized = serializeClientMessage(msg);
      const parsed = parseClientMessage(serialized);
      expect(parsed).toEqual(msg);
    });

    test("round-trips prompt message", () => {
      const msg: ClientMessage = { type: "prompt", content: "Hello world" };
      const serialized = serializeClientMessage(msg);
      const parsed = parseClientMessage(serialized);
      expect(parsed).toEqual(msg);
    });

    test("round-trips steer message", () => {
      const msg: ClientMessage = { type: "steer", content: "Change approach" };
      const serialized = serializeClientMessage(msg);
      const parsed = parseClientMessage(serialized);
      expect(parsed).toEqual(msg);
    });

    test("round-trips abort message", () => {
      const msg: ClientMessage = { type: "abort" };
      const serialized = serializeClientMessage(msg);
      const parsed = parseClientMessage(serialized);
      expect(parsed).toEqual(msg);
    });

    test("round-trips tool_result message", () => {
      const msg: ClientMessage = {
        type: "tool_result",
        toolCallId: "tc_123",
        content: [{ type: "text", text: "Result data" }],
        isError: false,
      };
      const serialized = serializeClientMessage(msg);
      const parsed = parseClientMessage(serialized);
      expect(parsed).toEqual(msg);
    });

    test("returns null for invalid JSON", () => {
      expect(parseClientMessage("not json")).toBeNull();
    });

    test("returns null for non-object", () => {
      expect(parseClientMessage('"string"')).toBeNull();
    });

    test("returns null for object without type", () => {
      expect(parseClientMessage('{"foo": "bar"}')).toBeNull();
    });
  });

  describe("serializeServerMessage / parseServerMessage", () => {
    test("round-trips session_ready message", () => {
      const msg: ServerMessage = {
        type: "session_ready",
        sessionId: "sess_abc",
      };
      const serialized = serializeServerMessage(msg);
      const parsed = parseServerMessage(serialized);
      expect(parsed).toEqual(msg);
    });

    test("round-trips agent_event message", () => {
      const msg: ServerMessage = {
        type: "agent_event",
        event: { type: "agent_start" },
      };
      const serialized = serializeServerMessage(msg);
      const parsed = parseServerMessage(serialized);
      expect(parsed).toEqual(msg);
    });

    test("round-trips tool_request message", () => {
      const msg: ServerMessage = {
        type: "tool_request",
        toolCallId: "tc_456",
        toolName: "read_range",
        params: { range: "A1:B10", sheet: "Sheet1" },
      };
      const serialized = serializeServerMessage(msg);
      const parsed = parseServerMessage(serialized);
      expect(parsed).toEqual(msg);
    });

    test("round-trips error message", () => {
      const msg: ServerMessage = {
        type: "error",
        code: ErrorCode.INVALID_API_KEY,
        message: "Invalid API key provided",
      };
      const serialized = serializeServerMessage(msg);
      const parsed = parseServerMessage(serialized);
      expect(parsed).toEqual(msg);
    });

    test("returns null for invalid JSON", () => {
      expect(parseServerMessage("{bad")).toBeNull();
    });

    test("returns null for missing type field", () => {
      expect(parseServerMessage('{"data": 123}')).toBeNull();
    });
  });

  describe("ErrorCode", () => {
    test("has expected error codes", () => {
      expect(ErrorCode.INVALID_MESSAGE).toBe("INVALID_MESSAGE");
      expect(ErrorCode.NOT_INITIALIZED).toBe("NOT_INITIALIZED");
      expect(ErrorCode.ALREADY_INITIALIZED).toBe("ALREADY_INITIALIZED");
      expect(ErrorCode.INVALID_API_KEY).toBe("INVALID_API_KEY");
      expect(ErrorCode.TOOL_TIMEOUT).toBe("TOOL_TIMEOUT");
      expect(ErrorCode.TOOL_ERROR).toBe("TOOL_ERROR");
      expect(ErrorCode.AGENT_ERROR).toBe("AGENT_ERROR");
      expect(ErrorCode.SESSION_ERROR).toBe("SESSION_ERROR");
    });
  });
});
