import { spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import type { Tool, ToolResult } from "../tool-types.js";
import type { ApprovalDeps } from "./approval-deps.js";
import { createLogger } from "../../logger.js";

const log = createLogger("invoke_claude_code");

export interface ClaudeCodeConfig {
  enabled: boolean;
  allowedDirs: readonly string[];
  defaultModel: string;
  timeoutMinutes: number;
  binaryPath: string;
}

export interface ClaudeCodeDeps {
  approvalDeps: ApprovalDeps;
  config: ClaudeCodeConfig;
}

interface ClaudeResult {
  type: string;
  subtype?: string;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
}

const OUTPUT_LIMIT = 3500;

export function createClaudeCodeTool(deps: ClaudeCodeDeps): Tool {
  return {
    definition: {
      name: "invoke_claude_code",
      description:
        "Delegate a development task to Claude Code CLI running locally. Claude Code can read/write files, run commands, and complete multi-step coding tasks autonomously in the target project. The task runs in the background (may take minutes); this call returns immediately with 'awaiting_result' and the final result is delivered to the user via Telegram. Optionally pass a session_id to continue a previous Claude Code session. Use this when the user wants code changes, refactors, bug fixes, or any non-trivial development task in a local repo.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The full instruction for Claude Code (e.g. 'Add a dark-mode toggle to the settings page and write a test').",
          },
          working_directory: {
            type: "string",
            description: "Absolute path to the project directory where Claude Code should run (e.g. '/Users/max/Personal/my-app').",
          },
          session_id: {
            type: "string",
            description: "Optional. Session id from a previous invoke_claude_code result — passes --resume to continue that session with preserved context.",
          },
          model: {
            type: "string",
            description: "Optional. Claude model to use: 'opus', 'sonnet', or 'haiku'. Defaults to the configured default.",
            enum: ["opus", "sonnet", "haiku"],
          },
        },
        required: ["prompt", "working_directory"],
      },
    },

    async execute(args, context): Promise<ToolResult> {
      const prompt = String(args.prompt ?? "").trim();
      const workingDirRaw = String(args.working_directory ?? "").trim();
      const sessionId = args.session_id ? String(args.session_id).trim() : undefined;
      const model = args.model ? String(args.model).trim() : deps.config.defaultModel;

      if (!prompt) {
        return { success: false, data: null, error: "prompt is required and cannot be empty" };
      }

      if (!workingDirRaw) {
        return { success: false, data: null, error: "working_directory is required" };
      }

      const pathValidation = validateWorkingDirectory(workingDirRaw, deps.config.allowedDirs);
      if (!pathValidation.ok) {
        return { success: false, data: null, error: pathValidation.error };
      }
      const workingDir = pathValidation.resolved;

      const userId = context.userId;
      const timeoutMs = deps.config.timeoutMinutes * 60_000;

      log.info(
        { workingDir, sessionId, model, timeoutMs, userId, channelId: context.channelId },
        "Dispatching Claude Code task in background",
      );

      void (async () => {
        try {
          const outcome = await runClaudeCode({
            binaryPath: deps.config.binaryPath,
            prompt,
            workingDir,
            sessionId,
            model,
            timeoutMs,
          });
          await deps.approvalDeps.sendResult(userId, formatOutcome(outcome, workingDir));
        } catch (err) {
          log.error(
            { error: (err as Error).message, workingDir },
            "Background Claude Code execution crashed",
          );
          await deps.approvalDeps.sendResult(
            userId,
            `❌ Claude Code falló en \`${workingDir}\`: ${(err as Error).message}`,
          );
        }
      })();

      const preview = prompt.length > 200 ? prompt.slice(0, 200) + "…" : prompt;
      return {
        success: true,
        data: {
          awaiting_result: true,
          message:
            `Claude Code iniciado en \`${workingDir}\`${sessionId ? ` (resume \`${sessionId}\`)` : ""}. ` +
            `El resultado llegará por Telegram cuando termine. Prompt: "${preview}"`,
        },
      };
    },
  };
}

interface PathValidation {
  ok: true;
  resolved: string;
}
interface PathValidationError {
  ok: false;
  error: string;
}

function validateWorkingDirectory(
  input: string,
  allowedDirs: readonly string[],
): PathValidation | PathValidationError {
  if (!isAbsolute(input)) {
    return { ok: false, error: `working_directory must be an absolute path, got: ${input}` };
  }

  const lexical = resolve(input);

  if (!existsSync(lexical)) {
    return { ok: false, error: `working_directory does not exist: ${lexical}` };
  }

  // Resolve symlinks to the real filesystem target BEFORE validating scope.
  // Without this, a symlink inside an allowed dir (e.g. `~/Personal/link -> /etc`)
  // would pass the lexical check while spawn() runs Claude Code at the symlink target.
  let resolved: string;
  try {
    resolved = realpathSync(lexical);
  } catch (err) {
    return { ok: false, error: `cannot resolve symlinks for working_directory: ${(err as Error).message}` };
  }

  let stat;
  try {
    stat = statSync(resolved);
  } catch (err) {
    return { ok: false, error: `cannot stat working_directory: ${(err as Error).message}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: `working_directory is not a directory: ${resolved}` };
  }

  const scopes = allowedDirs.length > 0 ? allowedDirs : [homedir()];
  const allowed = scopes.some((scope) => {
    let scopeResolved: string;
    try {
      scopeResolved = realpathSync(resolve(scope));
    } catch {
      return false; // scope path doesn't exist — cannot match
    }
    const rel = relative(scopeResolved, resolved);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });

  if (!allowed) {
    return {
      ok: false,
      error: `working_directory ${resolved} is outside allowed scopes: ${scopes.join(", ")}`,
    };
  }

  return { ok: true, resolved };
}

interface RunOptions {
  binaryPath: string;
  prompt: string;
  workingDir: string;
  sessionId?: string;
  model: string;
  timeoutMs: number;
}

interface RunOutcome {
  kind: "success" | "error" | "timeout" | "parse_error";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  parsed?: ClaudeResult;
  durationMs: number;
}

function runClaudeCode(opts: RunOptions): Promise<RunOutcome> {
  return new Promise((resolvePromise) => {
    const cliArgs = [
      "-p",
      opts.prompt,
      "--dangerously-skip-permissions",
      "--output-format",
      "json",
      "--model",
      opts.model,
    ];
    if (opts.sessionId) {
      cliArgs.push("--resume", opts.sessionId);
    }

    const startedAt = Date.now();
    const child = spawn(opts.binaryPath, cliArgs, {
      cwd: opts.workingDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    // `child.killed` flips to true as soon as a signal is *sent*, not when the
    // process actually exits — so we track real exit locally to drive SIGKILL
    // fallback correctly.
    let exited = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      timedOut = true;
      log.warn({ workingDir: opts.workingDir, timeoutMs: opts.timeoutMs }, "Claude Code timeout, killing process");
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!exited) {
          log.warn({ workingDir: opts.workingDir }, "SIGTERM ignored after 5s, sending SIGKILL");
          child.kill("SIGKILL");
        }
      }, 5_000);
    }, opts.timeoutMs);

    child.on("error", (err) => {
      exited = true;
      clearTimeout(timer);
      log.error({ error: err.message, binaryPath: opts.binaryPath }, "spawn failed");
      resolvePromise({
        kind: "error",
        exitCode: null,
        stdout,
        stderr: stderr + `\nspawn error: ${err.message}`,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on("close", (code) => {
      exited = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;

      if (timedOut) {
        resolvePromise({ kind: "timeout", exitCode: code, stdout, stderr, durationMs });
        return;
      }

      if (code !== 0) {
        resolvePromise({ kind: "error", exitCode: code, stdout, stderr, durationMs });
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as ClaudeResult;
        resolvePromise({ kind: "success", exitCode: code, stdout, stderr, parsed, durationMs });
      } catch (err) {
        log.warn(
          { error: (err as Error).message, stdoutLen: stdout.length },
          "Failed to parse Claude Code JSON output",
        );
        resolvePromise({ kind: "parse_error", exitCode: code, stdout, stderr, durationMs });
      }
    });
  });
}

function formatOutcome(outcome: RunOutcome, workingDir: string): string {
  const duration = humanizeDuration(outcome.durationMs);

  if (outcome.kind === "success" && outcome.parsed) {
    const p = outcome.parsed;
    const isError = p.is_error === true;
    const icon = isError ? "⚠️" : "✅";
    const header = `${icon} Claude Code terminó en ${duration} — \`${workingDir}\``;
    const body = truncate(p.result ?? "(sin contenido en el resultado)", OUTPUT_LIMIT);
    const sess = p.session_id ? `\n\n_session_id:_ \`${p.session_id}\`` : "";
    const turns = p.num_turns ? ` · ${p.num_turns} turnos` : "";
    const cost = typeof p.total_cost_usd === "number" ? ` · $${p.total_cost_usd.toFixed(4)}` : "";
    return `${header}${turns}${cost}\n\n${body}${sess}`;
  }

  if (outcome.kind === "timeout") {
    return `⏱️ Claude Code timeout tras ${duration} en \`${workingDir}\`. Proceso terminado.`;
  }

  if (outcome.kind === "parse_error") {
    const body = truncate(outcome.stdout, OUTPUT_LIMIT);
    return `⚠️ Claude Code terminó (${duration}) pero el output no es JSON válido — \`${workingDir}\`\n\n\`\`\`\n${body}\n\`\`\``;
  }

  const errHeader = `❌ Claude Code falló (exit ${outcome.exitCode ?? "n/a"}, ${duration}) — \`${workingDir}\``;
  const stderrBody = outcome.stderr ? `\n\nstderr:\n\`\`\`\n${truncate(outcome.stderr, 1200)}\n\`\`\`` : "";
  const stdoutBody = outcome.stdout ? `\n\nstdout:\n\`\`\`\n${truncate(outcome.stdout, 1200)}\n\`\`\`` : "";
  return `${errHeader}${stderrBody}${stdoutBody}`;
}

function humanizeDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n[Truncado a ${limit} chars, ${text.length - limit} más omitidos]`;
}
