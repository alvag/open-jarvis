import type { Tool, ToolResult } from "../tool-types.js";
import { runGws } from "../gws-executor.js";

const gwsCalendarTool: Tool = {
  definition: {
    name: "google_calendar",
    description:
      "Interact with Google Calendar. Can list upcoming events, get event details, and create new events.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "The action to perform: 'list', 'get', or 'create'",
          enum: ["list", "get", "create"],
        },
        event_id: {
          type: "string",
          description: "The event ID (required for 'get' action)",
        },
        summary: {
          type: "string",
          description: "Event title (required for 'create' action)",
        },
        start: {
          type: "string",
          description: "Start datetime in ISO 8601 format, e.g. '2025-03-15T10:00:00-05:00' (required for 'create')",
        },
        end: {
          type: "string",
          description: "End datetime in ISO 8601 format (required for 'create')",
        },
        description: {
          type: "string",
          description: "Event description (optional for 'create')",
        },
        max_results: {
          type: "string",
          description: "Maximum number of events to return (default: 10)",
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
          const now = new Date().toISOString();
          const data = await runGws([
            "calendar", "events", "list",
            "--params", JSON.stringify({
              calendarId: "primary",
              timeMin: now,
              maxResults: parseInt(maxResults, 10),
              singleEvents: true,
              orderBy: "startTime",
            }),
          ]);
          return { success: true, data };
        }

        case "get": {
          const eventId = args.event_id as string;
          if (!eventId) {
            return { success: false, data: null, error: "event_id is required for 'get' action" };
          }
          const data = await runGws([
            "calendar", "events", "get",
            "--params", JSON.stringify({ calendarId: "primary", eventId }),
          ]);
          return { success: true, data };
        }

        case "create": {
          const summary = args.summary as string;
          const start = args.start as string;
          const end = args.end as string;
          if (!summary || !start || !end) {
            return { success: false, data: null, error: "summary, start, and end are required for 'create' action" };
          }
          const eventBody: Record<string, unknown> = {
            summary,
            start: { dateTime: start },
            end: { dateTime: end },
          };
          if (args.description) {
            eventBody.description = args.description as string;
          }
          const data = await runGws([
            "calendar", "events", "insert",
            "--params", JSON.stringify({ calendarId: "primary" }),
            "--json", JSON.stringify(eventBody),
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

export default gwsCalendarTool;
