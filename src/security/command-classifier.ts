/**
 * Command classification module — three-tier security check.
 *
 * Returns:
 *   "blocked" — lethal/destructive, never executes
 *   "risky"   — requires human approval via Telegram inline keyboard
 *   "safe"    — pure read commands, runs immediately
 *
 * Default (unknown command) → "risky" (fail-closed).
 */

export type CommandClassification = "blocked" | "risky" | "safe";

/**
 * Patterns that match absolutely destructive commands.
 * Tested against the full invocation string: [command, ...args].join(" ")
 */
const BLOCKED_PATTERNS: RegExp[] = [
  // rm -rf / in any arg order
  /^rm\s+.*-rf\s+\/($|\s)/,
  /^rm\s+.*\/($|\s).*-rf/,
  // Any mkfs variant (formats a filesystem)
  /^mkfs/,
  // dd reading from device files (overwrites disk)
  /^dd\s+if=\/dev\/(zero|random)/,
  // Pipe to shell — curl|sh, wget|bash, etc.
  /\|\s*(bash|sh|zsh)/,
  // Privilege escalation
  /^sudo\s+su/,
  // Recursive 777 on root or absolute paths
  /^chmod\s+.*-R.*777.*\//,
  // Fork bomb: :(){:|:&}
  /^:\(\)\{.*\|.*:\&\}/,
];

/** Human-readable explanations paired with each blocked pattern. */
const BLOCKED_REASONS: string[] = [
  "Recursive deletion of root filesystem is not allowed",
  "Recursive deletion of root filesystem is not allowed",
  "Formatting a filesystem is not allowed",
  "Writing from device files (dd) is not allowed",
  "Piping to a shell interpreter is not allowed",
  "Privilege escalation (sudo su) is not allowed",
  "Recursive chmod 777 on root paths is not allowed",
  "Fork bombs are not allowed",
];

/**
 * Pure read commands that are considered safe to run without approval.
 * Only the basename is matched (so /bin/ls → ls).
 */
const SAFE_COMMANDS = new Set([
  // Listing / navigation / identity
  "ls",
  "cat",
  "git",
  "grep",
  "pwd",
  "echo",
  "head",
  "tail",
  "wc",
  "find",
  "which",
  "env",
  "date",
  "ps",
  "df",
  "du",
  "uname",
  "whoami",
  "hostname",
  "uptime",
  "history",
  "type",
  "file",
  "stat",
  "less",
  "more",
  "sort",
  "uniq",
  "cut",
  "tr",
  // Hash / checksum (read-only)
  "shasum",
  "sha256sum",
  "sha1sum",
  "md5",
  "md5sum",
  "cksum",
  // Path utilities (no FS mutation)
  "basename",
  "dirname",
  "realpath",
  "readlink",
  // Env inspection
  "printenv",
  // Read-only comparison
  //   Note: `diff` is excluded because `diff --output=FILE` and `diff -o FILE`
  //   write to disk. `cmp` and `comm` only print to stdout.
  "cmp",
  "comm",
  // Binary / hex read
  //   Note: `xxd` is excluded because `xxd -r hex.txt out.bin` writes a binary
  //   file. `od` and `hexdump` print to stdout.
  "od",
  "hexdump",
  // Pure utilities
  "seq",
  "true",
  "false",
]);

/**
 * Flags that make even safe commands risky.
 * e.g. find -exec, find --delete
 */
const DANGEROUS_FLAGS = new Set(["--exec", "-exec", "--delete", "--write", "-i"]);

/** Script file extensions — always require approval regardless of content. */
const SCRIPT_EXTENSIONS = [".sh", ".py", ".ts"];

/**
 * Classify a command into one of three security tiers.
 *
 * @param command  The executable name or path (e.g. "ls", "/bin/rm", "/home/max/script.sh")
 * @param args     Arguments array for the command
 * @returns        "blocked" | "risky" | "safe"
 */
export function classifyCommand(
  command: string,
  args: string[],
): CommandClassification {
  const fullInvocation = [command, ...args].join(" ");

  // Layer 1: blocked patterns — lethal/irreversible
  if (BLOCKED_PATTERNS.some((p) => p.test(fullInvocation))) {
    return "blocked";
  }

  // Layer 2: script files — always risky (user approval is the validation)
  const isScript = SCRIPT_EXTENSIONS.some((ext) => command.endsWith(ext));
  if (isScript) {
    return "risky";
  }

  // Layer 3: safe commands list
  const basename = command.split("/").pop() ?? command;
  if (SAFE_COMMANDS.has(basename)) {
    // Dangerous flags on safe commands still escalate to risky
    if (args.some((a) => DANGEROUS_FLAGS.has(a))) {
      return "risky";
    }
    return "safe";
  }

  // Layer 4: unknown command — fail-closed default
  return "risky";
}

/**
 * Return a human-readable reason string if the command is blocked,
 * or null if it is not blocked.
 *
 * Used by the execute_command tool to explain WHY a command was blocked.
 */
/**
 * Register additional commands as safe at runtime.
 * Used to extend the hardcoded safe list via config (EXTRA_SAFE_COMMANDS)
 * or auto-derived from WORKFLOW_VALIDATION_COMMANDS.
 */
export function addSafeCommands(commands: string[]): void {
  for (const cmd of commands) {
    if (cmd) SAFE_COMMANDS.add(cmd);
  }
}

export function getBlockReason(command: string, args: string[]): string | null {
  const fullInvocation = [command, ...args].join(" ");

  for (let i = 0; i < BLOCKED_PATTERNS.length; i++) {
    if (BLOCKED_PATTERNS[i].test(fullInvocation)) {
      return BLOCKED_REASONS[i];
    }
  }

  return null;
}
