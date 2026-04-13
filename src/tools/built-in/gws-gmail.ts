import type { Tool, ToolResult } from "../tool-types.js";
import { runGws } from "../gws-executor.js";

export function createGwsGmailTool(): Tool {
  return {
    definition: {
    name: "google_gmail",
    description:
      "Interact with Gmail. Can list recent messages, read a specific message, search messages, and send emails.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "The action to perform: 'list', 'read', 'search', or 'send'",
          enum: ["list", "read", "search", "send"],
        },
        message_id: {
          type: "string",
          description: "The message ID to read (required for 'read' action)",
        },
        query: {
          type: "string",
          description: "Gmail search query for 'search' action (e.g. 'from:user@example.com subject:invoice')",
        },
        to: {
          type: "string",
          description: "Recipient email address (required for 'send' action)",
        },
        subject: {
          type: "string",
          description: "Email subject (required for 'send' action)",
        },
        body: {
          type: "string",
          description: "Email body text (required for 'send' action)",
        },
        max_results: {
          type: "string",
          description: "Maximum number of results to return (default: 10)",
        },
      },
      required: ["action"],
    },
  },

  async execute(args): Promise<ToolResult> {
    const action = args.action as string;
    const maxResults = (args.max_results as string) || "10";

    try {
      switch (action) {
        case "list": {
          const data = await runGws([
            "gmail", "users", "messages", "list",
            "--params", JSON.stringify({ userId: "me", maxResults: parseInt(maxResults, 10) }),
          ]);
          return { success: true, data };
        }

        case "read": {
          const messageId = args.message_id as string;
          if (!messageId) {
            return { success: false, data: null, error: "message_id is required for 'read' action" };
          }
          const data = await runGws([
            "gmail", "users", "messages", "get",
            "--params", JSON.stringify({ userId: "me", id: messageId, format: "full" }),
          ]);
          return { success: true, data };
        }

        case "search": {
          const query = args.query as string;
          if (!query) {
            return { success: false, data: null, error: "query is required for 'search' action" };
          }
          const data = await runGws([
            "gmail", "users", "messages", "list",
            "--params", JSON.stringify({ userId: "me", q: query, maxResults: parseInt(maxResults, 10) }),
          ]);
          return { success: true, data };
        }

        case "send": {
          const to = args.to as string;
          const subject = args.subject as string;
          const body = args.body as string;
          if (!to || !subject || !body) {
            return { success: false, data: null, error: "to, subject, and body are required for 'send' action" };
          }
          const raw = Buffer.from(
            `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
          ).toString("base64url");
          const data = await runGws([
            "gmail", "users", "messages", "send",
            "--params", JSON.stringify({ userId: "me" }),
            "--json", JSON.stringify({ raw }),
          ]);
          return { success: true, data };
        }

        default:
          return { success: false, data: null, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return { success: false, data: null, error: (err as Error).message };
    }
  },
  };
}
