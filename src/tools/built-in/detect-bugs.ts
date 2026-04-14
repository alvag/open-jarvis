import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, extname } from "node:path";
import { execFileSync } from "node:child_process";
import type { Tool, ToolResult } from "../tool-types.js";
import { validatePath } from "../../security/path-validator.js";
import type { CodebaseConfig } from "./read-file.js";
import { collectFiles, type FileInfo } from "./codebase-shared.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Focus = "all" | "patterns" | "git" | "logs";

type FindingStatus =
  | "bug_confirmed"
  | "bug_probable"
  | "risk_potential"
  | "needs_info";

type Severity = "critical" | "high" | "medium" | "low";
type Confidence = "high" | "medium" | "low";

interface BugFinding {
  id: string;
  title: string;
  status: FindingStatus;
  severity: Severity;
  confidence: Confidence;
  evidence: string[];
  file: string;
  line?: number;
  pattern_type: string;
  context: string;
  git_related?: boolean;
}

interface BugSummary {
  total: number;
  by_status: Record<string, number>;
  by_severity: Record<string, number>;
  files_analyzed: number;
  git_commits_analyzed: number;
  scan_scope: string;
}

interface BugReport {
  findings: BugFinding[];
  summary: BugSummary;
  truncated?: boolean;
  truncation_note?: string;
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_EXTS = [".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"];

function isCodeFile(f: FileInfo): boolean {
  return CODE_EXTS.includes(f.extension);
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const STATUS_ORDER: Record<FindingStatus, number> = {
  bug_confirmed: 0,
  bug_probable: 1,
  risk_potential: 2,
  needs_info: 3,
};

// ---------------------------------------------------------------------------
// Helper: safe git execution
// ---------------------------------------------------------------------------

function gitExec(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helper: file context classification
// ---------------------------------------------------------------------------

type FileContext =
  | "auth"
  | "payment"
  | "persistence"
  | "api"
  | "core"
  | "test"
  | "display"
  | "config"
  | "generic";

function classifyFileContext(relPath: string): FileContext {
  const lower = relPath.toLowerCase();
  if (
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    lower.includes("__test")
  )
    return "test";
  if (
    lower.includes("auth") ||
    lower.includes("login") ||
    lower.includes("token") ||
    lower.includes("session")
  )
    return "auth";
  if (
    lower.includes("pay") ||
    lower.includes("billing") ||
    lower.includes("invoice") ||
    lower.includes("stripe")
  )
    return "payment";
  if (
    lower.includes("db") ||
    lower.includes("database") ||
    lower.includes("migration") ||
    lower.includes("memory-manager")
  )
    return "persistence";
  if (
    lower.includes("api") ||
    lower.includes("route") ||
    lower.includes("handler") ||
    lower.includes("controller")
  )
    return "api";
  if (lower.includes("config") || lower.includes("setting")) return "config";
  if (
    lower.includes("index.") ||
    lower.includes("main.") ||
    lower.includes("app.") ||
    lower.includes("agent")
  )
    return "core";
  if (
    lower.includes("ui") ||
    lower.includes("render") ||
    lower.includes("display") ||
    lower.includes("format")
  )
    return "display";
  return "generic";
}

// ---------------------------------------------------------------------------
// Helper: heuristic classification
// ---------------------------------------------------------------------------

function classifyFinding(
  patternType: string,
  fileCtx: FileContext,
  gitRelated: boolean,
): { status: FindingStatus; severity: Severity; confidence: Confidence } {
  let severity: Severity = "medium";
  let confidence: Confidence = "medium";
  let status: FindingStatus = "risk_potential";

  switch (patternType) {
    case "null_deref":
    case "unhandled_async":
      severity = "high";
      confidence = "medium";
      status = "bug_probable";
      break;
    case "empty_catch":
    case "error_swallow":
      severity = "medium";
      confidence = "high";
      status = "bug_probable";
      break;
    case "type_coercion":
    case "race_condition":
      severity = "medium";
      confidence = "low";
      status = "risk_potential";
      break;
    case "unreachable_code":
      severity = "low";
      confidence = "high";
      status = "bug_confirmed";
      break;
    case "off_by_one":
    case "resource_leak":
      severity = "medium";
      confidence = "low";
      status = "needs_info";
      break;
    case "removed_null_check":
    case "removed_error_handling":
    case "new_empty_catch":
      severity = "high";
      confidence = "high";
      status = "bug_probable";
      break;
    case "log_error":
    case "log_exception":
      severity = "high";
      confidence = "medium";
      status = "bug_probable";
      break;
  }

  // Context adjustments
  if (fileCtx === "test") {
    severity = "low";
    confidence = "low";
    status = "risk_potential";
  } else if (
    fileCtx === "auth" ||
    fileCtx === "payment" ||
    fileCtx === "persistence"
  ) {
    if (severity === "medium") severity = "high";
    if (severity === "low") severity = "medium";
  } else if (fileCtx === "display") {
    if (severity === "high") severity = "medium";
    if (severity === "medium") severity = "low";
  }

  // Git recency bump
  if (gitRelated) {
    if (confidence === "low") confidence = "medium";
    else if (confidence === "medium") confidence = "high";
  }

  return { status, severity, confidence };
}

// ---------------------------------------------------------------------------
// Helper: extract context lines around a match
// ---------------------------------------------------------------------------

function extractContext(
  lines: string[],
  lineIdx: number,
  contextRadius: number = 2,
): string {
  const start = Math.max(0, lineIdx - contextRadius);
  const end = Math.min(lines.length - 1, lineIdx + contextRadius);
  const numWidth = String(end + 1).length;
  const result: string[] = [];
  for (let j = start; j <= end; j++) {
    const prefix = j === lineIdx ? ">" : " ";
    const num = String(j + 1).padStart(numWidth, " ");
    let line = lines[j];
    if (line.length > 200) line = line.slice(0, 200) + "...";
    result.push(`${prefix} ${num} | ${line}`);
  }
  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Detector: Empty catch / Error swallow
// ---------------------------------------------------------------------------

function detectEmptyCatchAndErrorSwallow(
  files: FileInfo[],
  gitChanged: Set<string>,
): BugFinding[] {
  const findings: BugFinding[] = [];
  const codeFiles = files.filter(isCodeFile);

  for (const f of codeFiles) {
    const fileCtx = classifyFileContext(f.relPath);
    const isGitChanged = gitChanged.has(f.relPath);

    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];

      if (
        !/^\s*}\s*catch\s*/.test(line) &&
        !/^\s*catch\s*\(/.test(line)
      )
        continue;

      // Look ahead at the catch body (next 5 lines)
      let bodyEmpty = true;
      let hasConsoleOnly = false;
      let hasReturnDefault = false;

      for (let j = i + 1; j < Math.min(i + 6, f.lines.length); j++) {
        const nextTrimmed = f.lines[j].trimStart();
        if (nextTrimmed === "}" || nextTrimmed === "") continue;
        if (nextTrimmed.startsWith("//")) continue;

        bodyEmpty = false;

        if (
          /^\s*(console\.(log|error|warn))\s*\(/.test(f.lines[j]) &&
          !hasReturnDefault
        ) {
          hasConsoleOnly = true;
        } else {
          hasConsoleOnly = false;
        }

        if (
          /return\s+(null|undefined|{}|\[\]|false|0|"")\s*;?\s*$/.test(
            f.lines[j],
          )
        ) {
          hasReturnDefault = true;
        }
      }

      if (bodyEmpty) {
        const cls = classifyFinding("empty_catch", fileCtx, isGitChanged);
        findings.push({
          id: "",
          title: `Empty catch block in ${f.relPath}`,
          ...cls,
          evidence: [`${f.relPath}:${i + 1} — catch block with empty body`],
          file: f.relPath,
          line: i + 1,
          pattern_type: "empty_catch",
          context: extractContext(f.lines, i),
          git_related: isGitChanged,
        });
      } else if (hasReturnDefault || hasConsoleOnly) {
        const cls = classifyFinding("error_swallow", fileCtx, isGitChanged);
        const detail = hasReturnDefault
          ? "returns default value"
          : "only logs to console";
        findings.push({
          id: "",
          title: `Error swallowed (${detail}) in ${f.relPath}`,
          ...cls,
          evidence: [
            `${f.relPath}:${i + 1} — catch ${detail} without propagating`,
          ],
          file: f.relPath,
          line: i + 1,
          pattern_type: "error_swallow",
          context: extractContext(f.lines, i, 3),
          git_related: isGitChanged,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Detector: Null dereference risk
// ---------------------------------------------------------------------------

function detectNullDeref(
  files: FileInfo[],
  gitChanged: Set<string>,
): BugFinding[] {
  const findings: BugFinding[] = [];
  const codeFiles = files.filter(isCodeFile);

  // Pattern: .find(...).property (no optional chaining)
  const FIND_DEREF_RE = /(\w+)\.find\([^)]+\)\.(\w+)/;
  // Pattern: (await expr).property (no optional chaining)
  const AWAIT_DEREF_RE = /\(await\s+[^)]+\)\.(\w+)/;

  for (const f of codeFiles) {
    const fileCtx = classifyFileContext(f.relPath);
    const isGitChanged = gitChanged.has(f.relPath);

    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      // Check .find() without optional chaining
      const findMatch = line.match(FIND_DEREF_RE);
      if (findMatch) {
        // Exclude if using optional chaining already
        if (line.includes(".find(") && !line.includes("?.")) {
          // Check if result is guarded in the next 5 lines
          let guarded = false;
          for (
            let j = i + 1;
            j < Math.min(i + 5, f.lines.length);
            j++
          ) {
            if (
              /if\s*\(/.test(f.lines[j]) ||
              /\?\?/.test(f.lines[j]) ||
              /\?\.\s*/.test(f.lines[j])
            ) {
              guarded = true;
              break;
            }
          }
          if (!guarded) {
            const cls = classifyFinding("null_deref", fileCtx, isGitChanged);
            findings.push({
              id: "",
              title: `Unguarded .find() result in ${f.relPath}`,
              ...cls,
              evidence: [
                `${f.relPath}:${i + 1} — .find() result accessed without null check`,
              ],
              file: f.relPath,
              line: i + 1,
              pattern_type: "null_deref",
              context: extractContext(f.lines, i),
              git_related: isGitChanged,
            });
          }
        }
      }

      // Check (await ...).property without optional chaining
      if (AWAIT_DEREF_RE.test(line) && !line.includes("?.")) {
        const cls = classifyFinding("null_deref", fileCtx, isGitChanged);
        findings.push({
          id: "",
          title: `Unguarded await result dereference in ${f.relPath}`,
          ...cls,
          evidence: [
            `${f.relPath}:${i + 1} — await result accessed without null check`,
          ],
          file: f.relPath,
          line: i + 1,
          pattern_type: "null_deref",
          context: extractContext(f.lines, i),
          git_related: isGitChanged,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Detector: Unhandled async / promise
// ---------------------------------------------------------------------------

function detectUnhandledAsync(
  files: FileInfo[],
  gitChanged: Set<string>,
): BugFinding[] {
  const findings: BugFinding[] = [];
  const codeFiles = files.filter(isCodeFile);

  // Pattern: .then( without .catch( in the same statement
  const THEN_NO_CATCH_RE = /\.then\s*\(/;
  const CATCH_RE = /\.catch\s*\(/;

  for (const f of codeFiles) {
    const fileCtx = classifyFileContext(f.relPath);
    const isGitChanged = gitChanged.has(f.relPath);

    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      // Check .then() without .catch()
      if (THEN_NO_CATCH_RE.test(line)) {
        // Look at current line and next 3 lines for a .catch
        let hasCatch = false;
        for (
          let j = i;
          j < Math.min(i + 4, f.lines.length);
          j++
        ) {
          if (CATCH_RE.test(f.lines[j])) {
            hasCatch = true;
            break;
          }
        }
        if (!hasCatch) {
          const cls = classifyFinding(
            "unhandled_async",
            fileCtx,
            isGitChanged,
          );
          findings.push({
            id: "",
            title: `.then() without .catch() in ${f.relPath}`,
            ...cls,
            evidence: [
              `${f.relPath}:${i + 1} — promise chain missing .catch() handler`,
            ],
            file: f.relPath,
            line: i + 1,
            pattern_type: "unhandled_async",
            context: extractContext(f.lines, i),
            git_related: isGitChanged,
          });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Detector: Type coercion risks
// ---------------------------------------------------------------------------

function detectTypeCoercion(
  files: FileInfo[],
  gitChanged: Set<string>,
): BugFinding[] {
  const findings: BugFinding[] = [];
  const codeFiles = files.filter(isCodeFile);

  // Match == or != but NOT === or !== and NOT == null/undefined (valid pattern)
  const LOOSE_EQ_RE = /[^!=]==[^=]/;
  const LOOSE_NEQ_RE = /[^!]!=[^=]/;
  const NULL_CHECK_RE = /[!=]+=?\s*(null|undefined)\b/;

  for (const f of codeFiles) {
    const fileCtx = classifyFileContext(f.relPath);
    const isGitChanged = gitChanged.has(f.relPath);

    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      // Skip string literals
      if (trimmed.startsWith('"') || trimmed.startsWith("'") || trimmed.startsWith("`")) continue;

      if (
        (LOOSE_EQ_RE.test(line) || LOOSE_NEQ_RE.test(line)) &&
        !NULL_CHECK_RE.test(line)
      ) {
        const cls = classifyFinding("type_coercion", fileCtx, isGitChanged);
        findings.push({
          id: "",
          title: `Loose equality operator in ${f.relPath}`,
          ...cls,
          evidence: [
            `${f.relPath}:${i + 1} — uses == or != instead of ===/!==`,
          ],
          file: f.relPath,
          line: i + 1,
          pattern_type: "type_coercion",
          context: extractContext(f.lines, i),
          git_related: isGitChanged,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Detector: Race conditions (module-level mutable state in async)
// ---------------------------------------------------------------------------

function detectRaceConditions(
  files: FileInfo[],
  gitChanged: Set<string>,
): BugFinding[] {
  const findings: BugFinding[] = [];
  const codeFiles = files.filter(isCodeFile);

  const MODULE_LET_RE = /^(?:export\s+)?let\s+(\w+)/;

  for (const f of codeFiles) {
    const fileCtx = classifyFileContext(f.relPath);
    const isGitChanged = gitChanged.has(f.relPath);

    // Collect module-level let declarations (indent 0)
    const moduleLets: { name: string; line: number }[] = [];
    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      if (line.startsWith(" ") || line.startsWith("\t")) continue;
      const match = line.match(MODULE_LET_RE);
      if (match) {
        moduleLets.push({ name: match[1], line: i });
      }
    }

    if (moduleLets.length === 0) continue;

    // Check if any module-level let is mutated inside an async function
    let inAsync = false;
    let asyncDepth = 0;
    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      if (/\basync\s+(function|\()/.test(line) || /\basync\s+\w+\s*\(/.test(line)) {
        inAsync = true;
        asyncDepth = 0;
      }
      if (inAsync) {
        asyncDepth += (line.match(/{/g) || []).length;
        asyncDepth -= (line.match(/}/g) || []).length;
        if (asyncDepth <= 0) {
          inAsync = false;
          asyncDepth = 0;
        }

        for (const mlet of moduleLets) {
          const assignRe = new RegExp(`\\b${mlet.name}\\s*=[^=]`);
          if (assignRe.test(line) && i !== mlet.line) {
            const cls = classifyFinding(
              "race_condition",
              fileCtx,
              isGitChanged,
            );
            findings.push({
              id: "",
              title: `Module-level let '${mlet.name}' mutated in async context in ${f.relPath}`,
              ...cls,
              evidence: [
                `${f.relPath}:${mlet.line + 1} — module-level let declaration`,
                `${f.relPath}:${i + 1} — mutation inside async function`,
              ],
              file: f.relPath,
              line: i + 1,
              pattern_type: "race_condition",
              context: extractContext(f.lines, i),
              git_related: isGitChanged,
            });
            break; // One finding per variable per file
          }
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Detector: Unreachable code
// ---------------------------------------------------------------------------

function detectUnreachableCode(
  files: FileInfo[],
  gitChanged: Set<string>,
): BugFinding[] {
  const findings: BugFinding[] = [];
  const codeFiles = files.filter(isCodeFile);

  const TERMINATOR_RE =
    /^\s*(return\b|throw\b|break\s*;|continue\s*;)/;
  const SAFE_AFTER_RE =
    /^\s*(}|\)|else\b|catch\b|finally\b|case\b|default\s*:|\*|\/\/|\/\*|$)/;

  for (const f of codeFiles) {
    const fileCtx = classifyFileContext(f.relPath);
    const isGitChanged = gitChanged.has(f.relPath);

    for (let i = 0; i < f.lines.length - 1; i++) {
      if (!TERMINATOR_RE.test(f.lines[i])) continue;

      // Find the next non-empty line
      let nextIdx = i + 1;
      while (nextIdx < f.lines.length && f.lines[nextIdx].trim() === "") {
        nextIdx++;
      }
      if (nextIdx >= f.lines.length) continue;

      if (!SAFE_AFTER_RE.test(f.lines[nextIdx])) {
        const cls = classifyFinding(
          "unreachable_code",
          fileCtx,
          isGitChanged,
        );
        findings.push({
          id: "",
          title: `Unreachable code after ${f.lines[i].trim().split(/\s/)[0]} in ${f.relPath}`,
          ...cls,
          evidence: [
            `${f.relPath}:${i + 1} — terminator statement`,
            `${f.relPath}:${nextIdx + 1} — code after terminator`,
          ],
          file: f.relPath,
          line: nextIdx + 1,
          pattern_type: "unreachable_code",
          context: extractContext(f.lines, i, 3),
          git_related: isGitChanged,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Detector: Off-by-one indicators
// ---------------------------------------------------------------------------

function detectOffByOne(
  files: FileInfo[],
  gitChanged: Set<string>,
): BugFinding[] {
  const findings: BugFinding[] = [];
  const codeFiles = files.filter(isCodeFile);

  // array[array.length] — missing -1
  const LENGTH_INDEX_RE = /(\w+)\[(\1)\.length\s*\]/;
  // for (...; i <= array.length; ...)
  const LOOP_LE_LENGTH_RE = /;\s*\w+\s*<=\s*\w+\.length\s*[;)]/;

  for (const f of codeFiles) {
    const fileCtx = classifyFileContext(f.relPath);
    const isGitChanged = gitChanged.has(f.relPath);

    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      if (LENGTH_INDEX_RE.test(line)) {
        const cls = classifyFinding("off_by_one", fileCtx, isGitChanged);
        findings.push({
          id: "",
          title: `Possible off-by-one: array[array.length] in ${f.relPath}`,
          ...cls,
          evidence: [
            `${f.relPath}:${i + 1} — indexing at .length (last valid index is .length - 1)`,
          ],
          file: f.relPath,
          line: i + 1,
          pattern_type: "off_by_one",
          context: extractContext(f.lines, i),
          git_related: isGitChanged,
        });
      }

      if (LOOP_LE_LENGTH_RE.test(line)) {
        const cls = classifyFinding("off_by_one", fileCtx, isGitChanged);
        findings.push({
          id: "",
          title: `Possible off-by-one: loop with <= .length in ${f.relPath}`,
          ...cls,
          evidence: [
            `${f.relPath}:${i + 1} — loop condition uses <= .length instead of <`,
          ],
          file: f.relPath,
          line: i + 1,
          pattern_type: "off_by_one",
          context: extractContext(f.lines, i),
          git_related: isGitChanged,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Detector: Resource leaks
// ---------------------------------------------------------------------------

function detectResourceLeaks(
  files: FileInfo[],
  gitChanged: Set<string>,
): BugFinding[] {
  const findings: BugFinding[] = [];
  const codeFiles = files.filter(isCodeFile);

  const OPEN_PATTERNS = [
    { open: "createReadStream", close: ["destroy", "close", "pipe"], label: "ReadStream" },
    { open: "createWriteStream", close: ["destroy", "close", "end"], label: "WriteStream" },
    { open: "setInterval", close: ["clearInterval"], label: "Interval" },
  ];

  for (const f of codeFiles) {
    const fileCtx = classifyFileContext(f.relPath);
    const isGitChanged = gitChanged.has(f.relPath);
    const fullContent = f.lines.join("\n");

    for (const pattern of OPEN_PATTERNS) {
      const openCount = (fullContent.match(new RegExp(pattern.open, "g")) || []).length;
      if (openCount === 0) continue;

      const closeCount = pattern.close.reduce((sum, closer) => {
        return sum + (fullContent.match(new RegExp(closer, "g")) || []).length;
      }, 0);

      if (openCount > closeCount) {
        // Find the first occurrence line
        let openLine = 0;
        for (let i = 0; i < f.lines.length; i++) {
          if (f.lines[i].includes(pattern.open)) {
            openLine = i;
            break;
          }
        }

        const cls = classifyFinding("resource_leak", fileCtx, isGitChanged);
        findings.push({
          id: "",
          title: `Potential ${pattern.label} leak in ${f.relPath}`,
          ...cls,
          evidence: [
            `${f.relPath} — ${openCount} ${pattern.open}() vs ${closeCount} close/destroy calls`,
          ],
          file: f.relPath,
          line: openLine + 1,
          pattern_type: "resource_leak",
          context: extractContext(f.lines, openLine),
          git_related: isGitChanged,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Git diff analysis
// ---------------------------------------------------------------------------

interface GitAnalysisResult {
  findings: BugFinding[];
  changedFiles: Set<string>;
  commitsAnalyzed: number;
}

function analyzeGitDiffs(
  codebaseRoot: string,
  gitDepth: number,
  existingChanged: Set<string>,
  scopePath?: string,
): GitAnalysisResult {
  const findings: BugFinding[] = [];
  const changedFiles = new Set(existingChanged);

  // Helper: check if a file path falls within the requested scope
  function inScope(filePath: string): boolean {
    if (!scopePath) return true;
    return filePath === scopePath || filePath.startsWith(scopePath + "/") || filePath.startsWith(scopePath);
  }

  // Collect changed file names
  const diffNames = gitExec(["diff", "--name-only"], codebaseRoot);
  const stagedNames = gitExec(
    ["diff", "--cached", "--name-only"],
    codebaseRoot,
  );
  const logNames = gitExec(
    [
      "log",
      `--max-count=${gitDepth}`,
      "--pretty=format:",
      "--name-only",
      "--diff-filter=ACMR",
    ],
    codebaseRoot,
  );

  for (const output of [diffNames, stagedNames, logNames]) {
    if (!output) continue;
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && CODE_EXTS.some((ext) => trimmed.endsWith(ext))) {
        changedFiles.add(trimmed);
      }
    }
  }

  // Count commits analyzed
  const logCount = gitExec(
    ["log", `--max-count=${gitDepth}`, "--pretty=format:%h"],
    codebaseRoot,
  );
  const commitsAnalyzed = logCount
    ? logCount.split("\n").filter((l) => l.trim()).length
    : 0;

  // Get unified diff for pattern analysis
  const diffOutput = gitExec(
    [
      "diff",
      `HEAD~${Math.min(gitDepth, commitsAnalyzed || 1)}`,
      "--unified=3",
      "--diff-filter=M",
      "--",
      ...CODE_EXTS.map((e) => `*${e}`),
    ],
    codebaseRoot,
  );

  if (!diffOutput) {
    return { findings, changedFiles, commitsAnalyzed };
  }

  // Parse diff for dangerous patterns
  let currentFile = "";
  let currentLine = 0;

  for (const diffLine of diffOutput.split("\n")) {
    // Track file context
    if (diffLine.startsWith("+++ b/")) {
      currentFile = diffLine.slice(6);
      continue;
    }
    if (diffLine.startsWith("@@ ")) {
      const hunkMatch = diffLine.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      // Subtract 1 because currentLine is incremented before detection logic
      if (hunkMatch) currentLine = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }
    if (diffLine.startsWith("+") && !diffLine.startsWith("+++")) {
      currentLine++;
    } else if (
      !diffLine.startsWith("-") &&
      !diffLine.startsWith("\\")
    ) {
      currentLine++;
    }

    // Detect: new empty catch introduced
    if (
      diffLine.startsWith("+") &&
      /catch\s*\(/.test(diffLine)
    ) {
      // Check a few more + lines
      const remaining = diffOutput
        .split("\n")
        .slice(
          diffOutput.split("\n").indexOf(diffLine) + 1,
          diffOutput.split("\n").indexOf(diffLine) + 5,
        );
      let bodyEmpty = true;
      for (const rLine of remaining) {
        if (!rLine.startsWith("+")) break;
        const content = rLine.slice(1).trim();
        if (content === "}" || content === "") continue;
        if (content.startsWith("//")) continue;
        bodyEmpty = false;
        break;
      }
      if (bodyEmpty && currentFile && inScope(currentFile)) {
        const fileCtx = classifyFileContext(currentFile);
        const cls = classifyFinding("new_empty_catch", fileCtx, true);
        findings.push({
          id: "",
          title: `New empty catch introduced in ${currentFile}`,
          ...cls,
          evidence: [
            `${currentFile}:~${currentLine} — empty catch added in recent diff`,
          ],
          file: currentFile,
          line: currentLine,
          pattern_type: "new_empty_catch",
          context: diffLine.slice(1),
          git_related: true,
        });
      }
    }

    // Detect: removed null/undefined check
    if (
      diffLine.startsWith("-") &&
      (
        /if\s*\(\s*\w+\s*!=\s*null/.test(diffLine) ||
        /if\s*\(\s*\w+\s*!==\s*(null|undefined)/.test(diffLine) ||
        /if\s*\(\s*!\w+\s*\)/.test(diffLine) ||
        /\?\.\s*/.test(diffLine)
      )
    ) {
      if (currentFile && inScope(currentFile)) {
        const fileCtx = classifyFileContext(currentFile);
        const cls = classifyFinding("removed_null_check", fileCtx, true);
        findings.push({
          id: "",
          title: `Null check removed in ${currentFile}`,
          ...cls,
          evidence: [
            `${currentFile}:~${currentLine} — null guard removed in recent diff`,
            `Removed: ${diffLine.slice(1).trim()}`,
          ],
          file: currentFile,
          line: currentLine,
          pattern_type: "removed_null_check",
          context: diffLine.slice(1),
          git_related: true,
        });
      }
    }

    // Detect: removed error handling (try/catch removed)
    if (
      diffLine.startsWith("-") &&
      (/\btry\s*{/.test(diffLine) || /\bcatch\s*\(/.test(diffLine))
    ) {
      if (currentFile && inScope(currentFile)) {
        const fileCtx = classifyFileContext(currentFile);
        const cls = classifyFinding(
          "removed_error_handling",
          fileCtx,
          true,
        );
        findings.push({
          id: "",
          title: `Error handling removed in ${currentFile}`,
          ...cls,
          evidence: [
            `${currentFile}:~${currentLine} — try/catch removed in recent diff`,
            `Removed: ${diffLine.slice(1).trim()}`,
          ],
          file: currentFile,
          line: currentLine,
          pattern_type: "removed_error_handling",
          context: diffLine.slice(1),
          git_related: true,
        });
      }
    }
  }

  return { findings, changedFiles, commitsAnalyzed };
}

// ---------------------------------------------------------------------------
// Log analysis
// ---------------------------------------------------------------------------

function analyzeLogs(codebaseRoot: string): BugFinding[] {
  const findings: BugFinding[] = [];
  const logDirs = ["data", "logs"];
  const logFiles: string[] = [];

  for (const dir of logDirs) {
    const absDir = join(codebaseRoot, dir);
    try {
      const entries = readdirSync(absDir);
      for (const entry of entries) {
        if (entry.endsWith(".log")) {
          logFiles.push(join(absDir, entry));
        }
      }
    } catch {
      // Directory does not exist
    }
  }

  if (logFiles.length === 0) return findings;

  const MAX_LOG_LINES = 500;
  const MAX_FINDINGS_FROM_LOGS = 10;

  // Group errors by message for deduplication
  const errorGroups = new Map<
    string,
    { count: number; lastLine: string; level: number; component: string }
  >();

  for (const logPath of logFiles) {
    let content: string;
    try {
      content = readFileSync(logPath, "utf-8");
    } catch {
      continue;
    }

    const allLines = content.split("\n");
    const recentLines = allLines.slice(-MAX_LOG_LINES);

    for (const line of recentLines) {
      if (!line.trim()) continue;

      // Try pino JSON format
      try {
        const entry = JSON.parse(line);
        if (
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.level === "number" &&
          entry.level >= 40
        ) {
          const key = entry.msg || entry.error || "unknown_error";
          const existing = errorGroups.get(key);
          if (existing) {
            existing.count++;
          } else {
            errorGroups.set(key, {
              count: 1,
              lastLine: line.length > 300 ? line.slice(0, 300) + "..." : line,
              level: entry.level,
              component: entry.component || entry.name || "unknown",
            });
          }
        }
      } catch {
        // Not JSON — try plain text error detection
        if (
          /\b(ERROR|FATAL|Exception|Error:)\b/i.test(line) &&
          !/^\s*(\/\/|#)/.test(line)
        ) {
          const key = line.slice(0, 100);
          const existing = errorGroups.get(key);
          if (existing) {
            existing.count++;
          } else {
            errorGroups.set(key, {
              count: 1,
              lastLine: line.length > 300 ? line.slice(0, 300) + "..." : line,
              level: 50,
              component: "unknown",
            });
          }
        }
      }
    }
  }

  // Convert groups to findings (sorted by level desc, then count desc)
  const sorted = Array.from(errorGroups.entries()).sort((a, b) => {
    if (b[1].level !== a[1].level) return b[1].level - a[1].level;
    return b[1].count - a[1].count;
  });

  for (const [msg, group] of sorted.slice(0, MAX_FINDINGS_FROM_LOGS)) {
    const patternType =
      group.lastLine.includes("Stack") || group.lastLine.includes("stack")
        ? "log_exception"
        : "log_error";
    const severity: Severity = group.level >= 50 ? "high" : "medium";
    const confidence: Confidence = "medium";
    const status: FindingStatus = "bug_probable";

    findings.push({
      id: "",
      title: `${group.level >= 60 ? "FATAL" : group.level >= 50 ? "Error" : "Warning"}: ${msg.slice(0, 80)}`,
      status,
      severity,
      confidence,
      evidence: [
        `Log level ${group.level} — ${group.count} occurrence(s)`,
        `Component: ${group.component}`,
        `Sample: ${group.lastLine.slice(0, 200)}`,
      ],
      file: `[log] ${group.component}`,
      pattern_type: patternType,
      context: group.lastLine,
      git_related: false,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Report builder with progressive truncation
// ---------------------------------------------------------------------------

function buildReport(
  findings: BugFinding[],
  summary: BugSummary,
  maxChars: number,
): { report: BugReport; truncated: boolean } {
  let report: BugReport = { findings, summary };
  let serialized = JSON.stringify(report);

  if (serialized.length <= maxChars) {
    return { report, truncated: false };
  }

  // Progressive truncation: remove lowest-priority findings
  let trimmed = [...findings];
  while (trimmed.length > 0 && serialized.length > maxChars) {
    trimmed = trimmed.slice(0, -1);
    report = {
      findings: trimmed,
      summary: { ...summary, total: findings.length },
      truncated: true,
      truncation_note: `Showing top ${trimmed.length} of ${findings.length} findings. Use 'focus' parameter to narrow analysis.`,
    };
    serialized = JSON.stringify(report);
  }

  return { report, truncated: trimmed.length < findings.length };
}

// ---------------------------------------------------------------------------
// Single file loader
// ---------------------------------------------------------------------------

function loadSingleFile(
  filePath: string,
  codebaseRoot: string,
  ignorePatterns: readonly string[],
  maxFileSize: number,
): { file: FileInfo | null; error?: string } {
  const absPath = resolve(codebaseRoot, filePath);
  const validation = validatePath(absPath, codebaseRoot, [...ignorePatterns]);
  if (!validation.valid)
    return { file: null, error: `Invalid path: ${validation.error}` };

  try {
    const st = statSync(validation.resolved);
    if (st.isDirectory())
      return { file: null, error: "Path is a directory. Omit 'path' to scan via git diff, or provide a directory path." };
    if (st.size > maxFileSize)
      return { file: null, error: `File too large (${st.size} bytes)` };

    const buffer = readFileSync(validation.resolved);
    const checkLen = Math.min(buffer.length, 512);
    for (let i = 0; i < checkLen; i++) {
      if (buffer[i] === 0) return { file: null, error: "Binary file, cannot analyze" };
    }

    const content = buffer.toString("utf-8");
    const lines = content.split("\n");

    return {
      file: {
        relPath: relative(codebaseRoot, validation.resolved),
        absPath: validation.resolved,
        size: st.size,
        extension: extname(filePath).toLowerCase(),
        lineCount: lines.length,
        lines,
      },
    };
  } catch {
    return { file: null, error: "File not found or not readable" };
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createDetectBugsTool(codebaseConfig: CodebaseConfig): Tool {
  return {
    definition: {
      name: "detect_bugs",
      description:
        "Scan code for potential bugs using evidence from code patterns, git history, and application logs. " +
        "Detects: null dereference risks, empty catches, unhandled async/promises, type coercion issues, " +
        "race conditions, error swallowing, unreachable code, off-by-one indicators, resource leaks, " +
        "and regressions introduced in recent git commits. " +
        "Returns structured findings with severity, confidence, and evidence for each potential bug. " +
        "Does NOT execute tests or modify code.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "File or directory to analyze (relative to codebase root). " +
              "If omitted, analyzes files with changes in git (staged + unstaged + recent commits).",
          },
          git_depth: {
            type: "string",
            description:
              "Number of recent commits to analyze for regressions. Default: '5'. Range: 1-20.",
          },
          focus: {
            type: "string",
            description:
              "Filter analysis type. 'all' runs every detector. " +
              "'patterns' = code pattern analysis only. 'git' = git diff analysis only. 'logs' = log analysis only.",
            enum: ["all", "patterns", "git", "logs"],
          },
        },
      },
    },

    async execute(args, _context): Promise<ToolResult> {
      const pathArg = args.path as string | undefined;
      const gitDepthStr = (args.git_depth as string) ?? "5";
      const gitDepth = Math.min(
        Math.max(parseInt(gitDepthStr, 10) || 5, 1),
        20,
      );
      const focus = ((args.focus as string) || "all") as Focus;

      let scanScope: string;
      let files: FileInfo[];
      const warnings: string[] = [];
      const gitChangedFiles = new Set<string>();

      // Step 1: Determine files to analyze
      if (pathArg) {
        const targetPath = resolve(codebaseConfig.root, pathArg);
        const pathCheck = validatePath(targetPath, codebaseConfig.root, [
          ...codebaseConfig.ignorePatterns,
        ]);
        if (!pathCheck.valid) {
          return {
            success: false,
            data: null,
            error: `Invalid path: ${pathCheck.error}`,
          };
        }

        try {
          const st = statSync(pathCheck.resolved);
          if (st.isDirectory()) {
            const { files: collected, warnings: w } = collectFiles(
              pathCheck.resolved,
              codebaseConfig.root,
              codebaseConfig.ignorePatterns,
              codebaseConfig.maxFileSize,
            );
            warnings.push(...w);
            files = collected;
            scanScope = `path:${pathArg}`;
          } else {
            // Single file
            const result = loadSingleFile(
              pathArg,
              codebaseConfig.root,
              codebaseConfig.ignorePatterns,
              codebaseConfig.maxFileSize,
            );
            if (!result.file) {
              return {
                success: false,
                data: null,
                error: result.error || "Could not load file",
              };
            }
            files = [result.file];
            scanScope = `file:${pathArg}`;
          }
        } catch {
          return {
            success: false,
            data: null,
            error: `Path not found: ${pathArg}`,
          };
        }
      } else {
        // No path: analyze git-changed files
        const changedOutput = gitExec(["diff", "--name-only"], codebaseConfig.root);
        const stagedOutput = gitExec(
          ["diff", "--cached", "--name-only"],
          codebaseConfig.root,
        );
        const recentOutput = gitExec(
          [
            "log",
            `--max-count=${gitDepth}`,
            "--pretty=format:",
            "--name-only",
            "--diff-filter=ACMR",
          ],
          codebaseConfig.root,
        );

        const changedPaths = new Set<string>();
        for (const output of [changedOutput, stagedOutput, recentOutput]) {
          if (!output) continue;
          for (const line of output.split("\n")) {
            const trimmed = line.trim();
            if (
              trimmed &&
              CODE_EXTS.some((ext) => trimmed.endsWith(ext))
            ) {
              changedPaths.add(trimmed);
            }
          }
        }

        if (changedPaths.size === 0) {
          // Fallback: analyze entire codebase
          const { files: collected, warnings: w } = collectFiles(
            codebaseConfig.root,
            codebaseConfig.root,
            codebaseConfig.ignorePatterns,
            codebaseConfig.maxFileSize,
          );
          warnings.push(...w);
          files = collected;
          scanScope = "full_codebase";
        } else {
          // Load only the changed files
          files = [];
          for (const relPath of changedPaths) {
            const result = loadSingleFile(
              relPath,
              codebaseConfig.root,
              codebaseConfig.ignorePatterns,
              codebaseConfig.maxFileSize,
            );
            if (result.file) {
              files.push(result.file);
              gitChangedFiles.add(relPath);
            }
          }
          scanScope = `git_diff (${changedPaths.size} files)`;
        }
      }

      if (files.length === 0) {
        return {
          success: true,
          data: {
            findings: [],
            summary: {
              total: 0,
              by_status: {},
              by_severity: {},
              files_analyzed: 0,
              git_commits_analyzed: 0,
              scan_scope: scanScope,
            },
          },
        };
      }

      // Step 2: Run detectors based on focus
      const allFindings: BugFinding[] = [];
      let commitsAnalyzed = 0;

      if (focus === "all" || focus === "git") {
        const gitResult = analyzeGitDiffs(
          codebaseConfig.root,
          gitDepth,
          gitChangedFiles,
          pathArg,
        );
        allFindings.push(...gitResult.findings);
        commitsAnalyzed = gitResult.commitsAnalyzed;
        for (const f of gitResult.changedFiles) gitChangedFiles.add(f);
      }

      if (focus === "all" || focus === "patterns") {
        allFindings.push(
          ...detectEmptyCatchAndErrorSwallow(files, gitChangedFiles),
        );
        allFindings.push(...detectNullDeref(files, gitChangedFiles));
        allFindings.push(...detectUnhandledAsync(files, gitChangedFiles));
        allFindings.push(...detectTypeCoercion(files, gitChangedFiles));
        allFindings.push(...detectRaceConditions(files, gitChangedFiles));
        allFindings.push(...detectUnreachableCode(files, gitChangedFiles));
        allFindings.push(...detectOffByOne(files, gitChangedFiles));
        allFindings.push(...detectResourceLeaks(files, gitChangedFiles));
      }

      if (focus === "all" || focus === "logs") {
        allFindings.push(...analyzeLogs(codebaseConfig.root));
      }

      // Step 3: Assign IDs
      allFindings.forEach((f, i) => {
        f.id = `finding-${String(i + 1).padStart(3, "0")}`;
      });

      // Step 4: Sort by priority (status first, then severity)
      allFindings.sort((a, b) => {
        const statusDiff =
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (statusDiff !== 0) return statusDiff;
        return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      });

      // Step 5: Build summary
      const summary: BugSummary = {
        total: allFindings.length,
        by_status: {},
        by_severity: {},
        files_analyzed: files.length,
        git_commits_analyzed: commitsAnalyzed,
        scan_scope: scanScope,
      };
      for (const f of allFindings) {
        summary.by_status[f.status] =
          (summary.by_status[f.status] || 0) + 1;
        summary.by_severity[f.severity] =
          (summary.by_severity[f.severity] || 0) + 1;
      }

      // Step 6: Build report with truncation
      const { report, truncated } = buildReport(
        allFindings,
        summary,
        codebaseConfig.maxOutputChars,
      );

      if (truncated) {
        warnings.push(
          "Output truncated. Use 'focus' parameter to narrow analysis.",
        );
      }

      return {
        success: true,
        data: { ...report, warnings: warnings.length > 0 ? warnings : undefined },
      };
    },
  };
}
