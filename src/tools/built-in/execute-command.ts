import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import type { Tool, ToolResult } from "../tool-types.js";
import { classifyCommand, getBlockReason } from "../../security/command-classifier.js";
import type { ApprovalGate } from "../../security/approval-gate.js";
import { createLogger } from "../../logger.js";

const log = createLogger("execute_command");

const execFileAsync = promisify(execFile);

const OUTPUT_LIMIT = 4096;

let approvalGateRef: ApprovalGate | null = null;

export function setApprovalGate(gate: ApprovalGate): void {
  approvalGateRef = gate;
}

let sendApprovalFn: ((userId: string, text: string, approvalId: string) => Promise<void>) | null = null;

export function setSendApproval(
  fn: (userId: string, text: string, approvalId: string) => Promise<void>,
): void {
  sendApprovalFn = fn;
}

let sendResultFn: ((userId: string, text: string) => Promise<void>) | null = null;

export function setSendResult(
  fn: (userId: string, text: string) => Promise<void>,
): void {
  sendResultFn = fn;
}

const executeCommandTool: Tool = {
  definition: {
    name: "execute_command",
    description:
      "Execute a shell command or local script on the user's Mac. Commands are classified as safe (runs immediately), risky (requires user approval), or blocked (never runs). Pipes, &&, and ; are NOT supported — use multiple tool calls for chaining. Scripts (.sh, .py, .ts) are always risky and require approval. Default working directory is the user's home directory.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The executable or script path to run (e.g. 'ls', 'git', '/Users/max/scripts/backup.sh')",
        },
        args: {
          type: "string",
          description:
            "Space-separated arguments for the command (e.g. '-la /tmp'). Pipes, &&, ; are not allowed.",
        },
        cwd: {
          type: "string",
          description:
            "Working directory for the command. Defaults to user home directory.",
        },
      },
      required: ["command"],
    },
  },

  async execute(args, context): Promise<ToolResult> {
    let command = (args.command as string).trim();
    let rawArgs = (args.args as string | undefined) ?? "";

    // Handle LLM putting args in the command field (e.g. "ls -la" instead of command:"ls" args:"-la")
    if (!command.startsWith("/") && command.includes(" ")) {
      const parts = command.split(/\s+/);
      command = parts[0];
      rawArgs = [...parts.slice(1), ...rawArgs.split(/\s+/).filter(Boolean)].join(" ");
    }

    const argList = rawArgs.trim() ? rawArgs.split(/\s+/) : [];
    const cwd = (args.cwd as string | undefined) ?? homedir();

    // Shell metacharacter check
    const SHELL_META = /[|;&`$(){}[\]<>]/;
    if (SHELL_META.test(rawArgs) || SHELL_META.test(command)) {
      return {
        success: false,
        data: null,
        error:
          "Shell metacharacters (|, ;, &, $, etc.) are not allowed. Use separate tool calls for chaining.",
      };
    }

    // Script path validation
    const isScript =
      command.endsWith(".sh") || command.endsWith(".py") || command.endsWith(".ts");
    if (isScript && !isAbsolute(command)) {
      return {
        success: false,
        data: null,
        error: "Script paths must be absolute",
      };
    }

    // Classify command
    const classification = classifyCommand(command, argList);
    log.info({ command, args: argList, classification }, "Command classified");

    // Handle blocked commands
    if (classification === "blocked") {
      const reason = getBlockReason(command, argList) ?? "Command is in the blocked list";
      return {
        success: false,
        data: null,
        error: `Command blocked: ${reason}`,
      };
    }

    // Handle risky commands — non-blocking approval
    // Grammy processes updates sequentially, so we can't block the handler
    // waiting for the callback_query (approve/deny button). Instead, we send
    // the approval message, fire the execution in the background, and return
    // immediately. The result is sent directly to the user via Telegram.
    if (classification === "risky") {
      if (!approvalGateRef) {
        return {
          success: false,
          data: null,
          error: "Approval gate not initialized. Cannot execute risky commands.",
        };
      }

      const reason = isScript
        ? "Script execution always requires approval"
        : "Command classified as risky (modifies system state)";

      const commandDisplay = [command, ...argList].join(" ");
      const userId = context.userId;

      // Fire-and-forget: approval + execution happen in the background
      void (async () => {
        try {
          const approved = await approvalGateRef!.request({
            command,
            args: argList,
            cwd,
            reason,
            userId,
            sendApproval: async (text, approvalId) => {
              if (sendApprovalFn) {
                await sendApprovalFn(userId, text, approvalId);
              }
            },
          });

          if (!approved) {
            if (sendResultFn) {
              await sendResultFn(userId, `Command denied or expired: \`${commandDisplay}\``);
            }
            return;
          }

          // Approved — execute the command
          const result = await runCommand(command, argList, cwd);
          if (sendResultFn) {
            await sendResultFn(userId, result);
          }
        } catch (err) {
          log.error({ command: commandDisplay, error: (err as Error).message }, "Background execution failed");
          if (sendResultFn) {
            await sendResultFn(userId, `Error executing \`${commandDisplay}\`: ${(err as Error).message}`);
          }
        }
      })();

      return {
        success: true,
        data: {
          awaiting_approval: true,
          message: `Approval request sent for: \`${commandDisplay}\`. The user will see an inline keyboard in Telegram to approve or deny. The result will be sent directly once decided.`,
        },
      };
    }

    // Safe commands — execute directly
    return executeAndFormat(command, argList, cwd);
  },
};

/**
 * Resolve interpreter and execute a command, returning a formatted ToolResult.
 */
async function executeAndFormat(command: string, argList: string[], cwd: string): Promise<ToolResult> {
  let resolvedCommand = command;
  let resolvedArgs = argList;

  if (command.endsWith(".sh")) {
    resolvedCommand = "/bin/bash";
    resolvedArgs = [command, ...argList];
  } else if (command.endsWith(".py")) {
    resolvedCommand = "python3";
    resolvedArgs = [command, ...argList];
  } else if (command.endsWith(".ts")) {
    resolvedCommand = "tsx";
    resolvedArgs = [command, ...argList];
  }

  try {
    const { stdout, stderr } = await execFileAsync(resolvedCommand, resolvedArgs, {
      shell: false,
      timeout: 30_000,
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });

    const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
    const truncated = combined.length > OUTPUT_LIMIT;
    const output = truncated
      ? combined.slice(0, OUTPUT_LIMIT) +
        `\n\n[Output truncated at ${OUTPUT_LIMIT} chars. ${combined.length - OUTPUT_LIMIT} chars omitted.]`
      : combined;

    return {
      success: true,
      data: { output, truncated, exit_code: 0 },
    };
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException & {
      killed?: boolean;
      code?: string | number;
      stdout?: string;
      stderr?: string;
    };

    if (error.killed || error.code === "ETIMEDOUT") {
      return {
        success: false,
        data: null,
        error: `Command timed out after 30 seconds and was killed.`,
      };
    }

    const combined = [error.stdout ?? "", error.stderr ?? ""]
      .filter(Boolean)
      .join("\n")
      .trim();
    const exitCode = typeof error.code === "number" ? error.code : 1;

    return {
      success: false,
      data: { output: combined, exit_code: exitCode },
      error: `Command exited with code ${exitCode}`,
    };
  }
}

/**
 * Execute a command and return a formatted string for direct Telegram delivery.
 * Used by the background approval flow.
 */
async function runCommand(command: string, argList: string[], cwd: string): Promise<string> {
  const result = await executeAndFormat(command, argList, cwd);
  const commandDisplay = [command, ...argList].join(" ");

  if (result.success) {
    const data = result.data as { output: string; truncated: boolean };
    return `Command approved and executed: \`${commandDisplay}\`\n\`\`\`\n${data.output}\n\`\`\``;
  } else {
    const data = result.data as { output?: string; exit_code?: number } | null;
    const output = data?.output ? `\n\`\`\`\n${data.output}\n\`\`\`` : "";
    return `Command \`${commandDisplay}\` failed: ${result.error}${output}`;
  }
}

export default executeCommandTool;
