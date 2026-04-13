import type { Tool, ToolResult } from "../tool-types.js";
import { EXIT_RESTART, EXIT_UPDATE } from "../../exit-codes.js";
import { scheduleRestart } from "../../restart-signal.js";

export function createRestartServerTool(): Tool {
  return {
    definition: {
      name: "restart_server",
      description:
        "Restart the Jarvis server process. Use mode 'restart' for a simple restart, or 'update' to pull the latest code from git before restarting.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            description: "Restart mode: 'restart' for simple restart, 'update' to git pull first",
            enum: ["restart", "update"],
          },
        },
        required: ["mode"],
      },
    },

    async execute(args): Promise<ToolResult> {
      const mode = args.mode as string;
      const exitCode = mode === "update" ? EXIT_UPDATE : EXIT_RESTART;

      scheduleRestart(exitCode);

      return {
        success: true,
        data: {
          message: mode === "update"
            ? "Update scheduled. The server will pull the latest code and restart after this response is sent."
            : "Restart scheduled. The server will restart after this response is sent.",
        },
      };
    },
  };
}
