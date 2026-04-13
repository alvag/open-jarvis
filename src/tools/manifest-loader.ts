/**
 * manifest-loader.ts — Load local script tools from tool_manifest.json.
 *
 * Each entry in the manifest becomes a Tool registered in the ToolRegistry.
 * Handlers receive JSON args on stdin and must write a JSON ToolResult to stdout:
 *   { "success": true, "data": {...} }
 *   { "success": false, "data": null, "error": "message" }
 *
 * Interpreter resolution by file extension:
 *   .py  → python3
 *   .sh  → /bin/bash
 *   .ts  → tsx
 *   other → executed directly as an executable
 *
 * Security: all manifest tools pass through the same 3-layer security gate
 * as execute_command (blocked → risky → safe). Scripts (.py, .sh, .ts) are
 * always classified as risky and require approval.
 *
 * Built-in tools have collision priority: if a manifest entry name matches a
 * registered built-in, the manifest tool is skipped with an error log.
 *
 * Path override: set MANIFEST_PATH env var or pass manifestPath argument.
 * Relative paths are resolved against cwd (project root).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Tool, ToolResult, JsonSchema } from "./tool-types.js";
import type { ToolRegistry } from "./tool-registry.js";
import { classifyCommand, getBlockReason } from "../security/command-classifier.js";
import type { ApprovalDeps } from "./built-in/approval-deps.js";
import { createLogger } from "../logger.js";

const log = createLogger("manifest");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestEntry {
  name: string;
  description: string;
  parameters: object; // JSON Schema — passed through to ToolDefinition
  handler_path: string; // Absolute path recommended; relative resolved against cwd
  enabled?: boolean; // Default true
}

// ---------------------------------------------------------------------------
// Interpreter resolution
// ---------------------------------------------------------------------------

function resolveInterpreter(handlerPath: string): { interpreter: string; interpreterArgs: string[] } {
  if (handlerPath.endsWith(".py")) {
    return { interpreter: "python3", interpreterArgs: [handlerPath] };
  }
  if (handlerPath.endsWith(".sh")) {
    return { interpreter: "/bin/bash", interpreterArgs: [handlerPath] };
  }
  if (handlerPath.endsWith(".ts")) {
    return { interpreter: "tsx", interpreterArgs: [handlerPath] };
  }
  // Execute directly as an executable (chmod +x required)
  return { interpreter: handlerPath, interpreterArgs: [] };
}

// ---------------------------------------------------------------------------
// buildManifestTool
// ---------------------------------------------------------------------------

function buildManifestTool(entry: ManifestEntry, handlerPath: string, deps: ApprovalDeps): Tool {
  const { interpreter, interpreterArgs } = resolveInterpreter(handlerPath);

  return {
    definition: {
      name: entry.name,
      description: entry.description,
      parameters: entry.parameters as JsonSchema,
    },

    async execute(args, context): Promise<ToolResult> {
      // Security gate — classify the handler path
      const classification = classifyCommand(handlerPath, []);

      if (classification === "blocked") {
        const reason = getBlockReason(handlerPath, []) ?? "Handler path is blocked by security policy";
        return { success: false, data: null, error: `Manifest tool blocked: ${reason}` };
      }

      if (classification === "risky") {
        const userId = context.userId;
        const commandDisplay = [interpreter, ...interpreterArgs].join(" ");

        // Fire-and-forget: approval + execution in the background
        // (Grammy processes updates sequentially — same pattern as execute-command.ts)
        void (async () => {
          try {
            const approved = await deps.approvalGate.request({
              command: interpreter,
              args: interpreterArgs,
              cwd: process.cwd(),
              reason: "Script execution always requires approval",
              userId,
              sendApproval: async (text, approvalId) => {
                await deps.sendApproval(userId, text, approvalId);
              },
            });

            if (!approved) {
              await deps.sendResult(userId, `Manifest tool denied or expired: \`${entry.name}\``);
              return;
            }

            // Approved — execute the handler
            const result = await spawnHandler(interpreter, interpreterArgs, args);
            const text = result.success
              ? `Manifest tool \`${entry.name}\` completed:\n\`\`\`\n${JSON.stringify(result.data, null, 2)}\n\`\`\``
              : `Manifest tool \`${entry.name}\` failed: ${result.error}`;
            await deps.sendResult(userId, text);
          } catch (err) {
            log.error({ tool: entry.name, error: (err as Error).message }, "Background manifest tool execution failed");
            await deps.sendResult(userId, `Error running manifest tool \`${entry.name}\`: ${(err as Error).message}`);
          }
        })();

        return {
          success: true,
          data: {
            awaiting_approval: true,
            message: `Approval request sent for manifest tool: \`${commandDisplay}\`. Result will be sent directly once decided.`,
          },
        };
      }

      // Safe classification — execute directly
      return spawnHandler(interpreter, interpreterArgs, args);
    },
  };
}

// ---------------------------------------------------------------------------
// spawnHandler — runs the handler and returns a ToolResult
// ---------------------------------------------------------------------------

function spawnHandler(
  interpreter: string,
  interpreterArgs: string[],
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn(interpreter, interpreterArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env as NodeJS.ProcessEnv,
      timeout: 30_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: Error) => {
      resolve({ success: false, data: null, error: `Failed to spawn handler: ${err.message}` });
    });

    child.on("close", (code: number | null) => {
      if (code !== 0) {
        resolve({
          success: false,
          data: null,
          error: `Handler exited with code ${code}: ${stderr.trim()}`,
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as ToolResult;
        resolve(parsed);
      } catch {
        resolve({
          success: false,
          data: null,
          error: `Handler stdout is not valid JSON: ${stdout.slice(0, 200)}`,
        });
      }
    });

    // Write args as JSON to stdin, then close to signal EOF
    child.stdin.write(JSON.stringify(args));
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// loadToolManifest — public entry point
// ---------------------------------------------------------------------------

export function loadToolManifest(registry: ToolRegistry, deps: ApprovalDeps, manifestPath?: string): void {
  const resolved = resolve(manifestPath ?? process.env.MANIFEST_PATH ?? "./tool_manifest.json");

  if (!existsSync(resolved)) {
    log.info({ path: resolved }, "tool_manifest.json not found — starting without manifest tools");
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf-8"));
  } catch (err) {
    log.error({ path: resolved, error: (err as Error).message }, "Failed to parse tool_manifest.json — starting without manifest tools");
    return;
  }

  if (!Array.isArray(parsed)) {
    log.error({ path: resolved }, "tool_manifest.json must be a JSON array — starting without manifest tools");
    return;
  }

  for (const entry of parsed as unknown[]) {
    const e = entry as Partial<ManifestEntry>;

    // Skip disabled entries
    if (e.enabled === false) {
      continue;
    }

    // Validate required fields
    if (
      typeof e.name !== "string" ||
      typeof e.description !== "string" ||
      typeof e.parameters !== "object" ||
      e.parameters === null ||
      typeof e.handler_path !== "string"
    ) {
      log.error({ entry: typeof e.name === "string" ? e.name : "unknown" }, "Invalid manifest entry — missing required fields, skipping");
      continue;
    }

    const validEntry = e as ManifestEntry;

    // Resolve handler path
    const handlerPath = resolve(validEntry.handler_path);
    if (!existsSync(handlerPath)) {
      log.error({ handlerPath }, `Handler not found for tool "${validEntry.name}" — skipping`);
      continue;
    }

    // Build Tool object
    const tool = buildManifestTool(validEntry, handlerPath, deps);

    // Register — built-ins have collision priority
    try {
      registry.register(tool);
      log.info(`Registered manifest tool: ${validEntry.name}`);
    } catch {
      log.error(`Tool "${validEntry.name}" collides with existing tool — skipping (built-in has priority)`);
    }
  }
}
