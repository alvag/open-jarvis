import type Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, existsSync, lstatSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { validatePath } from "../security/path-validator.js";
import { createLogger } from "../logger.js";

const log = createLogger("code-review");

const MAX_GIT_FILES = 5;
const MAX_PROMPT_CHARS = 30_000;
const CODE_EXTENSIONS = new Set([".ts", ".js", ".tsx", ".jsx"]);
const GIT_CHECKPOINT_KEY = "__git_checkpoint__";

// ---------------------------------------------------------------------------
// Lightweight path collector (no file content read)
// ---------------------------------------------------------------------------

function collectCodePaths(
  rootDir: string,
  codebaseRoot: string,
  ignorePatterns: readonly string[],
): string[] {
  const paths: string[] = [];
  const seenInodes = new Set<number>();

  function walk(dir: string): void {
    if (paths.length >= 2000) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (paths.length >= 2000) break;

      const fullPath = join(dir, entry.name);
      const validation = validatePath(fullPath, codebaseRoot, [...ignorePatterns]);
      if (!validation.valid) continue;

      try {
        const lst = lstatSync(fullPath);
        if (lst.isSymbolicLink()) {
          const ino = statSync(fullPath).ino;
          if (seenInodes.has(ino)) continue;
          seenInodes.add(ino);
        }
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (CODE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        paths.push(relative(codebaseRoot, fullPath));
      }
    }
  }

  walk(rootDir);
  return paths;
}

// ---------------------------------------------------------------------------
// Git changed files since timestamp
// ---------------------------------------------------------------------------

function getGitChangedFiles(codebaseRoot: string, since: string | null): string[] {
  try {
    const args = since
      ? ["log", `--since=${since}`, "--name-only", "--pretty=format:", "--diff-filter=ACMR"]
      : ["log", "-20", "--name-only", "--pretty=format:", "--diff-filter=ACMR"];

    const output = execFileSync("git", args, {
      cwd: codebaseRoot,
      encoding: "utf-8",
      timeout: 10_000,
    });

    const files = [...new Set(
      output.split("\n").map(l => l.trim()).filter(Boolean),
    )];

    return files.filter(f =>
      CODE_EXTENSIONS.has(extname(f).toLowerCase()) &&
      existsSync(join(codebaseRoot, f)),
    );
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, "Failed to get git changed files, falling back to empty list");
    return [];
  }
}

// ---------------------------------------------------------------------------
// File size helper for sorting
// ---------------------------------------------------------------------------

function getFileSize(codebaseRoot: string, relPath: string): number {
  try {
    return statSync(join(codebaseRoot, relPath)).size;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Main prompt builder
// ---------------------------------------------------------------------------

export interface CodeReviewPromptResult {
  prompt: string;
  hasDeferredFiles: boolean;
}

export function buildCodeReviewPrompt(
  db: Database.Database,
  userId: string,
  codebaseRoot: string,
  ignorePatterns: readonly string[],
  maxBacklogFiles: number,
): CodeReviewPromptResult {
  // 1. Get git checkpoint (only advances when all git-changed files are processed)
  const checkpoint = db.prepare(
    "SELECT last_reviewed_at as ts FROM code_review_log WHERE file_path = ?",
  ).get(GIT_CHECKPOINT_KEY) as { ts: string } | undefined;

  const lastReviewTime = checkpoint?.ts ?? null;

  // 2. Get git-changed files
  let gitFiles = getGitChangedFiles(codebaseRoot, lastReviewTime);

  // Filter against ignore patterns
  gitFiles = gitFiles.filter(f => {
    const validation = validatePath(join(codebaseRoot, f), codebaseRoot, [...ignorePatterns]);
    return validation.valid;
  });

  const deferredGitFiles = gitFiles.length > MAX_GIT_FILES
    ? gitFiles.slice(MAX_GIT_FILES)
    : [];
  gitFiles = gitFiles.slice(0, MAX_GIT_FILES);

  // 3. Fill backlog budget
  let budget = maxBacklogFiles;
  const backlogFiles: string[] = [];

  if (budget > 0) {
    const reviewedPaths = new Set(
      (db.prepare("SELECT file_path FROM code_review_log WHERE file_path != ?").all(GIT_CHECKPOINT_KEY) as { file_path: string }[])
        .map(r => r.file_path),
    );

    const allCodeFiles = collectCodePaths(codebaseRoot, codebaseRoot, ignorePatterns);
    const gitFileSet = new Set(gitFiles);

    // Unreviewed files sorted by size desc (larger = more likely to have issues)
    const unreviewed = allCodeFiles
      .filter(f => !reviewedPaths.has(f) && !gitFileSet.has(f))
      .sort((a, b) => getFileSize(codebaseRoot, b) - getFileSize(codebaseRoot, a));

    const fromUnreviewed = unreviewed.slice(0, budget);
    backlogFiles.push(...fromUnreviewed);
    budget -= fromUnreviewed.length;
  }

  if (budget > 0) {
    const gitFileSet = new Set(gitFiles);
    const backlogFileSet = new Set(backlogFiles);

    const placeholders = [...gitFileSet, ...backlogFileSet];
    const placeholderStr = placeholders.length > 0
      ? placeholders.map(() => "?").join(",")
      : "'__none__'";

    const oldestReviewed = db.prepare(
      `SELECT file_path FROM code_review_log WHERE file_path != ? AND file_path NOT IN (${placeholderStr}) ORDER BY last_reviewed_at ASC LIMIT ?`,
    ).all(GIT_CHECKPOINT_KEY, ...placeholders, budget) as { file_path: string }[];

    for (const row of oldestReviewed) {
      if (existsSync(join(codebaseRoot, row.file_path))) {
        backlogFiles.push(row.file_path);
      }
    }
  }

  // 4. Handle empty case
  if (gitFiles.length === 0 && backlogFiles.length === 0) {
    return {
      prompt: `You are performing a proactive code review. This is an automated scheduled task.

No files need review right now. The codebase has no recently modified files since the last review, and all tracked files have been reviewed recently.

Send a brief message to the user: "Proactive code review: no hay archivos pendientes de revision en este momento."`,
      hasDeferredFiles: false,
    };
  }

  // 5. Build prompt
  let prompt = `You are performing an automated proactive code review. This is a scheduled task — analyze code systematically and report findings.

## Files to Review
`;

  if (gitFiles.length > 0) {
    prompt += `\n### Priority files (recently modified since last review${lastReviewTime ? ` on ${lastReviewTime}` : ""}):\n`;
    for (const f of gitFiles) {
      prompt += `- ${f}\n`;
    }
    if (deferredGitFiles.length > 0) {
      prompt += `\n> Note: ${deferredGitFiles.length} additional changed files were deferred to the next review.\n`;
    }
  }

  if (backlogFiles.length > 0) {
    prompt += `\n### Backlog files (coverage expansion):\n`;
    for (const f of backlogFiles) {
      prompt += `- ${f}\n`;
    }
  }

  prompt += `
## Analysis Instructions

For EACH file listed above, run these 4 analysis tools in order:

1. **read_file** — Read the file to understand its purpose and structure
2. **detect_bugs** — Scan for potential bugs (path=<file_path>, focus="all")
3. **find_refactor_candidates** — Find refactoring opportunities (mode="file", path=<file_path>)
4. **analyze_codebase** — Broader improvement analysis (path=<file_path>, focus="all", scope="detailed")

## Saving Findings

For each finding with severity >= medium AND confidence >= medium, save to the backlog:
- Call **manage_backlog** action=add_item with:
  - title: concise finding title
  - category: "bug" | "refactor" | "improvement" (based on source)
  - severity and confidence from the finding
  - source_tool: "proactive-review"
  - source_finding_id: "<tool_name>:<unique_id>" (for deduplication — e.g. "detect_bugs:null-check-config-42")
  - files: JSON array with the file path
  - evidence: JSON array of evidence strings with file:line references

## Updating Review Log

After analyzing each file, call **manage_code_review_log** action=upsert with:
- file_path: the file reviewed
- findings_count: number of findings saved for this file
- skills_run: '["detect_bugs","find_refactor_candidates","analyze_codebase","code_analysis"]'

## Notification

After ALL analyses complete, compose a summary message for the user with:
- Total files reviewed (X priority + Y backlog)
- Findings by severity (critical: N, high: N, medium: N)
- Top 3 most critical findings with file, title, and severity
- New backlog items added

Send this as your response — it will be delivered via Telegram.

## Auto-fix Decision

After saving all findings, check if any **quick-win** exists:
A quick-win is: (severity = "high" OR severity = "critical") AND confidence = "high" AND (category = "bug" OR category = "refactor")

If quick-wins exist:
1. Call **github_prs** action=list_prs state=open
2. Check if any PR has a branch starting with "jarvis/"
3. **If an open Jarvis PR exists**: include in your notification: "Hay un PR abierto de Jarvis (branch: <name>), no se puede iniciar auto-fix hasta que se cierre o mergee."
4. **If NO open Jarvis PR**:
   - Pick the most critical quick-win (highest severity first, then highest confidence)
   - Include in notification: "Auto-fix iniciado para: <title>"
   - Execute the development workflow:
     a. Call manage_backlog action=update_item to set status=in_progress
     b. Create a git worktree with git_worktree for the fix
     c. Read affected files and implement the minimal focused change
     d. Validate with the project's validation commands
     e. Commit, push, and create a PR via github_prs
     f. Update the backlog item with the PR URL
   - Add to notification: "PR creado: <url> — pendiente de revision."

If multiple quick-wins exist, only fix the single most critical one per review run.

## Rules
- Every finding MUST originate from tool output — do NOT fabricate issues
- Be conservative: only save findings you are confident about
- Do NOT send any message other than the final summary notification
- If a tool returns no findings for a file, that's fine — move on to the next`;

  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS) + "\n\n[Prompt truncated due to size]";
  }

  log.info({
    gitFiles: gitFiles.length,
    backlogFiles: backlogFiles.length,
    deferred: deferredGitFiles.length,
    lastReviewTime,
  }, "Built proactive code review prompt");

  return { prompt, hasDeferredFiles: deferredGitFiles.length > 0 };
}

// ---------------------------------------------------------------------------
// Advance checkpoint (call AFTER successful review run)
// ---------------------------------------------------------------------------

export function advanceCodeReviewCheckpoint(db: Database.Database): void {
  db.prepare(`
    INSERT INTO code_review_log (file_path, last_reviewed_at, findings_count, skills_run)
    VALUES (?, datetime('now'), 0, '[]')
    ON CONFLICT(file_path) DO UPDATE SET
      last_reviewed_at = datetime('now'),
      updated_at = datetime('now')
  `).run(GIT_CHECKPOINT_KEY);
}
