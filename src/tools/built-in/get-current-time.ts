import type { Tool, ToolResult } from "../tool-types.js";

const getCurrentTime: Tool = {
  definition: {
    name: "get_current_time",
    description:
      "Returns the current date and time in the specified timezone",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description:
            "IANA timezone string, e.g. 'America/New_York'. Defaults to system timezone.",
        },
      },
    },
  },

  async execute(args): Promise<ToolResult> {
    const tz =
      (args.timezone as string) ||
      Intl.DateTimeFormat().resolvedOptions().timeZone;

    const now = new Date().toLocaleString("en-US", {
      timeZone: tz,
      dateStyle: "full",
      timeStyle: "long",
    });

    return { success: true, data: { time: now, timezone: tz } };
  },
};

export default getCurrentTime;
