import { readdirSync, readFileSync, statSync, lstatSync } from "node:fs";
import { join, relative, resolve, extname, dirname, basename } from "node:path";
import type { Tool, ToolResult } from "../tool-types.js";
import { validatePath } from "../../security/path-validator.js";
import type { CodebaseConfig } from "./read-file.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileInfo {
  relPath: string;
  absPath: string;
  size: number;
  extension: string;
  lineCount: number;
  lines: string[];
}

type Focus = "all" | "structure" | "complexity" | "dependencies" | "quality" | "config";
type Scope = "overview" | "detailed";

interface AnalysisResult {
  structure?: string;
  complexity?: string;
  dependencies?: string;
  quality?: string;
  config?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILES = 2000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Shared: file collector
// ---------------------------------------------------------------------------

function collectFiles(
  rootDir: string,
  codebaseRoot: string,
  ignorePatterns: readonly string[],
  maxFileSize: number,
): { files: FileInfo[]; warnings: string[] } {
  const files: FileInfo[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;
  const seenInodes = new Set<number>();

  function walk(dir: string): void {
    if (files.length >= MAX_FILES) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (totalBytes >= MAX_TOTAL_BYTES) break;

      const fullPath = join(dir, entry.name);

      const validation = validatePath(
        fullPath,
        codebaseRoot,
        [...ignorePatterns],
      );
      if (!validation.valid) continue;

      // Symlink loop detection via inode
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
      } else {
        try {
          const st = statSync(validation.resolved);
          if (st.size > maxFileSize) continue;
          if (st.size === 0) {
            files.push({
              relPath: relative(codebaseRoot, fullPath),
              absPath: validation.resolved,
              size: 0,
              extension: extname(entry.name).toLowerCase(),
              lineCount: 0,
              lines: [],
            });
            continue;
          }

          const buffer = readFileSync(validation.resolved);

          // Skip binary files
          const checkLen = Math.min(buffer.length, 512);
          let isBinary = false;
          for (let i = 0; i < checkLen; i++) {
            if (buffer[i] === 0) { isBinary = true; break; }
          }
          if (isBinary) continue;

          totalBytes += buffer.length;
          const content = buffer.toString("utf-8");
          const lines = content.split("\n");

          files.push({
            relPath: relative(codebaseRoot, fullPath),
            absPath: validation.resolved,
            size: st.size,
            extension: extname(entry.name).toLowerCase(),
            lineCount: lines.length,
            lines,
          });
        } catch {
          continue;
        }
      }
    }
  }

  walk(rootDir);

  if (files.length >= MAX_FILES) {
    warnings.push(`File limit reached (${MAX_FILES}). Some files were not analyzed.`);
  }
  if (totalBytes >= MAX_TOTAL_BYTES) {
    warnings.push("Total bytes cap reached (50 MB). Some file contents were skipped.");
  }

  return { files, warnings };
}

// ---------------------------------------------------------------------------
// Helper: format bytes
// ---------------------------------------------------------------------------

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Analyzer: Structure
// ---------------------------------------------------------------------------

function analyzeStructure(files: FileInfo[], scope: Scope): string {
  const totalFiles = files.length;
  const totalLines = files.reduce((s, f) => s + f.lineCount, 0);
  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  // By extension
  const byExt = new Map<string, { count: number; lines: number; bytes: number }>();
  for (const f of files) {
    const ext = f.extension || "(no ext)";
    const prev = byExt.get(ext) || { count: 0, lines: 0, bytes: 0 };
    prev.count++;
    prev.lines += f.lineCount;
    prev.bytes += f.size;
    byExt.set(ext, prev);
  }
  const extSorted = [...byExt.entries()].sort((a, b) => b[1].count - a[1].count);

  // By top-level directory
  const byDir = new Map<string, number>();
  for (const f of files) {
    const topDir = f.relPath.includes("/") ? f.relPath.split("/")[0] : "(root)";
    byDir.set(topDir, (byDir.get(topDir) || 0) + 1);
  }
  const dirSorted = [...byDir.entries()].sort((a, b) => b[1] - a[1]);

  // Largest files
  const largest = [...files].sort((a, b) => b.lineCount - a.lineCount);

  // Empty files
  const empty = files.filter(f => f.lineCount === 0);

  const limit = scope === "detailed" ? 15 : 10;

  let out = "### Structure\n";
  out += `- ${totalFiles} files, ${totalLines.toLocaleString()} lines, ${fmtBytes(totalBytes)}\n`;
  out += `- Average: ${totalFiles > 0 ? Math.round(totalLines / totalFiles) : 0} lines/file, ${totalFiles > 0 ? fmtBytes(Math.round(totalBytes / totalFiles)) : "0 B"}/file\n`;

  out += `- By extension: ${extSorted.slice(0, limit).map(([e, v]) => `${e} (${v.count})`).join(", ")}\n`;
  out += `- By directory: ${dirSorted.slice(0, limit).map(([d, c]) => `${d} (${c})`).join(", ")}\n`;

  out += `- Largest files:\n`;
  for (const f of largest.slice(0, limit)) {
    out += `  - ${f.relPath} (${f.lineCount} lines, ${fmtBytes(f.size)})\n`;
  }

  if (empty.length > 0) {
    out += `- Empty files (${empty.length}): ${empty.slice(0, 5).map(f => f.relPath).join(", ")}${empty.length > 5 ? "..." : ""}\n`;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Analyzer: Complexity
// ---------------------------------------------------------------------------

const CONTROL_FLOW_KW = /^\s*(?:if|else|for|while|switch|catch|finally)\s*\(/;

const FUNC_PATTERNS = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/,
  /^\s*(?:public|private|protected|static|async)\s+\w+\s*\(/,
  /^\s*\w+\s*\([^)]*\)\s*(?::\s*\w[^{]*)?\s*\{/,
];

function analyzeComplexity(files: FileInfo[], scope: Scope): string {
  const codeFiles = files.filter(f =>
    [".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"].includes(f.extension),
  );

  if (codeFiles.length === 0) return "### Complexity\n- No code files found.\n";

  const totalLines = codeFiles.reduce((s, f) => s + f.lineCount, 0);
  const avgLines = Math.round(totalLines / codeFiles.length);

  // Files over 300 lines
  const bigFiles = codeFiles.filter(f => f.lineCount > 300);

  // Longest files
  const longest = [...codeFiles].sort((a, b) => b.lineCount - a.lineCount);

  // Function detection and long-function detection
  let totalFunctions = 0;
  const longFunctions: { path: string; line: number; name: string; length: number }[] = [];
  const deepNesting: { path: string; line: number; depth: number }[] = [];

  for (const f of codeFiles) {
    let inFunction = false;
    let funcStartLine = 0;
    let funcName = "";
    let braceDepth = 0;
    let funcStartDepth = 0;
    let maxNesting = 0;

    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      const trimmed = line.trimStart();

      // Skip empty lines, comments
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
        continue;
      }

      // Detect nesting depth via leading whitespace (assume 2-space indent)
      const leadingSpaces = line.length - line.trimStart().length;
      const depth = Math.floor(leadingSpaces / 2);
      if (depth > maxNesting) maxNesting = depth;
      if (depth > 4 && deepNesting.length < 50) {
        deepNesting.push({ path: f.relPath, line: i + 1, depth });
      }

      // Count braces for function length tracking
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;

      // Detect function start (exclude control-flow keywords)
      if (!inFunction && !CONTROL_FLOW_KW.test(line)) {
        for (const pat of FUNC_PATTERNS) {
          if (pat.test(line)) {
            totalFunctions++;
            inFunction = true;
            funcStartLine = i + 1;
            funcStartDepth = braceDepth;
            // Extract function name heuristic
            const nameMatch = line.match(/(?:function|const|let|var|async)\s+(\w+)/);
            funcName = nameMatch ? nameMatch[1] : `anonymous:${i + 1}`;
            break;
          }
        }
      }

      braceDepth += opens - closes;

      // Detect function end
      if (inFunction && braceDepth <= funcStartDepth && closes > 0) {
        const funcLength = (i + 1) - funcStartLine + 1;
        if (funcLength > 50) {
          longFunctions.push({
            path: f.relPath,
            line: funcStartLine,
            name: funcName,
            length: funcLength,
          });
        }
        inFunction = false;
      }
    }
  }

  longFunctions.sort((a, b) => b.length - a.length);

  // Deduplicate deep nesting: keep only max per file
  const nestingByFile = new Map<string, { line: number; depth: number }>();
  for (const n of deepNesting) {
    const prev = nestingByFile.get(n.path);
    if (!prev || n.depth > prev.depth) {
      nestingByFile.set(n.path, { line: n.line, depth: n.depth });
    }
  }
  const topNesting = [...nestingByFile.entries()]
    .sort((a, b) => b[1].depth - a[1].depth);

  const limit = scope === "detailed" ? 15 : 10;

  let out = "### Complexity\n";
  out += `- ${codeFiles.length} code files, ${totalLines.toLocaleString()} lines\n`;
  out += `- Average: ${avgLines} lines/file\n`;
  out += `- Files over 300 lines: ${bigFiles.length}\n`;
  out += `- Estimated functions: ${totalFunctions}\n`;

  out += `- Longest files:\n`;
  for (const f of longest.slice(0, limit)) {
    out += `  - ${f.relPath} (${f.lineCount} lines)\n`;
  }

  if (longFunctions.length > 0) {
    out += `- Long functions (>50 lines): ${longFunctions.length} found\n`;
    for (const fn of longFunctions.slice(0, limit)) {
      out += `  - ${fn.path}:${fn.line} — ${fn.name} (~${fn.length} lines)\n`;
    }
  } else {
    out += `- Long functions (>50 lines): none detected\n`;
  }

  if (topNesting.length > 0) {
    out += `- Deep nesting (>4 levels):\n`;
    for (const [path, info] of topNesting.slice(0, limit)) {
      out += `  - ${path}:${info.line} (depth ${info.depth})\n`;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Analyzer: Dependencies
// ---------------------------------------------------------------------------

function analyzeDependencies(files: FileInfo[], scope: Scope): string {
  const codeFiles = files.filter(f =>
    [".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"].includes(f.extension),
  );

  if (codeFiles.length === 0) return "### Dependencies\n- No code files found.\n";

  // Set of known file paths for resolving .js -> .ts rewrites
  const knownPaths = new Set(files.map(f => f.relPath));

  // Build import graph
  const graph = new Map<string, Set<string>>(); // file -> set of imported files
  const importedBy = new Map<string, Set<string>>(); // file -> set of files that import it
  const externalDeps = new Map<string, number>(); // package -> usage count
  let totalImports = 0;

  // Line-level import regex (only match lines that start with import/require/export)
  const LINE_IMPORT_RE = /^\s*(?:import\s+.*?\s+from\s+|import\s+|export\s+.*?\s+from\s+)["']([^"']+)["']/;
  const LINE_REQUIRE_RE = /^\s*(?:const|let|var|import)\s+.*?require\s*\(\s*["']([^"']+)["']\s*\)/;

  for (const f of codeFiles) {
    const imports = new Set<string>();

    // Scan line-by-line to avoid matching imports inside strings/templates
    for (const line of f.lines) {
      const trimmed = line.trimStart();
      // Skip comments and lines inside template literals (indented backtick content)
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      let specifier: string | null = null;
      const importMatch = line.match(LINE_IMPORT_RE);
      if (importMatch) {
        specifier = importMatch[1];
      } else {
        const requireMatch = line.match(LINE_REQUIRE_RE);
        if (requireMatch) specifier = requireMatch[1];
      }

      if (!specifier) continue;
      totalImports++;

      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        // Internal import — resolve relative path
        const dir = dirname(f.relPath);
        let resolved = join(dir, specifier).replace(/\\/g, "/");
        // Normalize .js -> .ts only if the .ts file actually exists in collected files
        if (resolved.endsWith(".js")) {
          const tsVariant = resolved.replace(/\.js$/, ".ts");
          if (knownPaths.has(tsVariant)) resolved = tsVariant;
        }
        // Remove leading ./
        if (resolved.startsWith("./")) resolved = resolved.slice(2);
        imports.add(resolved);

        if (!importedBy.has(resolved)) importedBy.set(resolved, new Set());
        importedBy.get(resolved)!.add(f.relPath);
      } else {
        // External dependency
        const pkgName = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0];
        externalDeps.set(pkgName, (externalDeps.get(pkgName) || 0) + 1);
      }
    }

    graph.set(f.relPath, imports);
  }

  // Hub files (most imported)
  const hubs = [...importedBy.entries()]
    .map(([path, importers]) => ({ path, count: importers.size }))
    .sort((a, b) => b.count - a.count);

  // Heaviest importers
  const heaviest = [...graph.entries()]
    .map(([path, imports]) => ({ path, count: imports.size }))
    .sort((a, b) => b.count - a.count);

  // Leaf files (import nothing internal)
  const leaves = [...graph.entries()]
    .filter(([, imports]) => imports.size === 0)
    .map(([path]) => path);

  // Circular imports (A imports B and B imports A)
  const circulars: { a: string; b: string }[] = [];
  const checked = new Set<string>();
  for (const [fileA, importsA] of graph.entries()) {
    for (const target of importsA) {
      const pairKey = [fileA, target].sort().join("↔");
      if (checked.has(pairKey)) continue;
      checked.add(pairKey);

      const importsB = graph.get(target);
      if (importsB && importsB.has(fileA)) {
        circulars.push({ a: fileA, b: target });
      }
    }
  }

  // External deps sorted
  const extSorted = [...externalDeps.entries()].sort((a, b) => b[1] - a[1]);

  const limit = scope === "detailed" ? 15 : 10;

  let out = "### Dependencies\n";
  out += `- Total import statements: ${totalImports}\n`;
  out += `- Internal modules: ${codeFiles.length}, External packages: ${externalDeps.size}\n`;

  out += `- Hub files (most imported):\n`;
  for (const h of hubs.slice(0, limit)) {
    out += `  - ${h.path} (imported by ${h.count} files)\n`;
  }

  out += `- Heaviest importers:\n`;
  for (const h of heaviest.slice(0, limit)) {
    out += `  - ${h.path} (${h.count} imports)\n`;
  }

  if (circulars.length > 0) {
    out += `- Potential circular imports: ${circulars.length}\n`;
    for (const c of circulars.slice(0, 5)) {
      out += `  - ${c.a} <-> ${c.b}\n`;
    }
  } else {
    out += `- Circular imports: none detected\n`;
  }

  out += `- Leaf files (no internal imports): ${leaves.length}`;
  if (leaves.length > 0 && leaves.length <= 10) {
    out += ` — ${leaves.join(", ")}`;
  }
  out += "\n";

  out += `- Top external dependencies:\n`;
  for (const [pkg, count] of extSorted.slice(0, limit)) {
    out += `  - ${pkg} (${count} files)\n`;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Analyzer: Quality
// ---------------------------------------------------------------------------

const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/;
const CONSOLE_RE = /\bconsole\.(log|warn|error|debug|info)\s*\(/;
const ANY_TYPE_RE = /:\s*any\b|as\s+any\b/;
const MAGIC_NUMBER_RE = /(?<![.\w])(-?\d{2,})\b/g;

function analyzeQuality(files: FileInfo[], scope: Scope): string {
  const codeFiles = files.filter(f =>
    [".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"].includes(f.extension),
  );

  if (codeFiles.length === 0) return "### Quality Signals\n- No code files found.\n";

  // TODO/FIXME/HACK scanning
  const todoByType: Record<string, number> = { TODO: 0, FIXME: 0, HACK: 0, XXX: 0 };
  const todoByFile = new Map<string, number>();
  let totalTodos = 0;

  // Console.log detection (non-test files)
  let consoleLogs = 0;

  // any type detection (TS files)
  let anyTypes = 0;

  // Commented-out code blocks
  const commentedBlocks: { path: string; line: number; preview: string }[] = [];

  // Magic numbers
  let magicNumbers = 0;

  for (const f of codeFiles) {
    const isTest = f.relPath.includes(".test.") || f.relPath.includes(".spec.") || f.relPath.includes("__test");
    const isTs = f.extension === ".ts" || f.extension === ".tsx";
    let consecutiveComments = 0;
    let commentBlockStart = 0;

    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      const trimmed = line.trimStart();

      // TODO/FIXME/HACK
      const todoMatch = trimmed.match(TODO_RE);
      if (todoMatch) {
        totalTodos++;
        todoByType[todoMatch[1]] = (todoByType[todoMatch[1]] || 0) + 1;
        todoByFile.set(f.relPath, (todoByFile.get(f.relPath) || 0) + 1);
      }

      // console.log in non-test files
      if (!isTest && CONSOLE_RE.test(trimmed)) {
        consoleLogs++;
      }

      // any type in TS files
      if (isTs && ANY_TYPE_RE.test(trimmed)) {
        anyTypes++;
      }

      // Commented-out code detection
      if (trimmed.startsWith("//")) {
        const commentContent = trimmed.slice(2).trim();
        const looksLikeCode = /[{};=]|^import\s|^export\s|^const\s|^let\s|^function\s|^return\s/.test(commentContent);
        if (looksLikeCode) {
          if (consecutiveComments === 0) commentBlockStart = i + 1;
          consecutiveComments++;
        } else {
          if (consecutiveComments >= 3 && commentedBlocks.length < 20) {
            commentedBlocks.push({
              path: f.relPath,
              line: commentBlockStart,
              preview: f.lines[commentBlockStart - 1]?.trim().slice(0, 60) || "",
            });
          }
          consecutiveComments = 0;
        }
      } else {
        if (consecutiveComments >= 3 && commentedBlocks.length < 20) {
          commentedBlocks.push({
            path: f.relPath,
            line: commentBlockStart,
            preview: f.lines[commentBlockStart - 1]?.trim().slice(0, 60) || "",
          });
        }
        consecutiveComments = 0;
      }

      // Magic numbers (skip imports, consts, trivial values)
      if (!trimmed.startsWith("import") && !trimmed.startsWith("//")) {
        MAGIC_NUMBER_RE.lastIndex = 0;
        let mm;
        while ((mm = MAGIC_NUMBER_RE.exec(trimmed)) !== null) {
          const num = parseInt(mm[1], 10);
          if (num !== 0 && num !== 1 && num !== -1 && num !== 2 && num !== 10 && num !== 100) {
            magicNumbers++;
          }
        }
      }
    }

    // Flush remaining comment block
    if (consecutiveComments >= 3 && commentedBlocks.length < 20) {
      commentedBlocks.push({
        path: f.relPath,
        line: commentBlockStart,
        preview: f.lines[commentBlockStart - 1]?.trim().slice(0, 60) || "",
      });
    }
  }

  const topTodoFiles = [...todoByFile.entries()]
    .sort((a, b) => b[1] - a[1]);

  const limit = scope === "detailed" ? 15 : 10;

  let out = "### Quality Signals\n";
  out += `- TODO/FIXME/HACK/XXX: ${totalTodos} total`;
  if (totalTodos > 0) {
    const parts = Object.entries(todoByType).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`);
    out += ` (${parts.join(", ")})`;
  }
  out += "\n";

  if (topTodoFiles.length > 0) {
    out += `  Top files: ${topTodoFiles.slice(0, 5).map(([p, c]) => `${p} (${c})`).join(", ")}\n`;
  }

  out += `- Commented-out code blocks (3+ lines): ${commentedBlocks.length}\n`;
  if (commentedBlocks.length > 0) {
    for (const cb of commentedBlocks.slice(0, limit)) {
      out += `  - ${cb.path}:${cb.line} — ${cb.preview}\n`;
    }
  }

  out += `- console.log/warn/error in non-test files: ${consoleLogs}\n`;
  out += `- \`: any\` / \`as any\` in .ts files: ${anyTypes}\n`;
  out += `- Magic numbers (heuristic): ${magicNumbers}\n`;

  return out;
}

// ---------------------------------------------------------------------------
// Analyzer: Config
// ---------------------------------------------------------------------------

const ENV_VAR_RE = /process\.env\.(\w+)/g;
const ENV_DEFAULT_RE = /process\.env\.(\w+)\s*\|\|\s*["']([^"']*)["']/g;

function analyzeConfig(files: FileInfo[], scope: Scope): string {
  const allFiles = files;

  // Env var usage
  const envVars = new Map<string, Set<string>>(); // var name -> files

  // Scattered defaults
  const envDefaults = new Map<string, Map<string, Set<string>>>(); // var -> default -> files

  // Config-looking files
  const configFiles: string[] = [];

  // Hardcoded strings (URLs, IPs, ports)
  const hardcoded: { path: string; line: number; value: string }[] = [];
  const URL_RE = /["'](https?:\/\/[^"'\s]+)["']/g;
  const IP_PORT_RE = /["'](\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?)["']/g;

  for (const f of allFiles) {
    // Detect config files
    const base = basename(f.relPath).toLowerCase();
    if (
      base.includes("config") ||
      base.includes("settings") ||
      [".json", ".yaml", ".yml", ".toml"].includes(f.extension)
    ) {
      configFiles.push(f.relPath);
    }

    const content = f.lines.join("\n");

    // Env vars
    ENV_VAR_RE.lastIndex = 0;
    let m;
    while ((m = ENV_VAR_RE.exec(content)) !== null) {
      const name = m[1];
      if (!envVars.has(name)) envVars.set(name, new Set());
      envVars.get(name)!.add(f.relPath);
    }

    // Env var defaults
    ENV_DEFAULT_RE.lastIndex = 0;
    while ((m = ENV_DEFAULT_RE.exec(content)) !== null) {
      const name = m[1];
      const defaultVal = m[2];
      if (!envDefaults.has(name)) envDefaults.set(name, new Map());
      const defaults = envDefaults.get(name)!;
      if (!defaults.has(defaultVal)) defaults.set(defaultVal, new Set());
      defaults.get(defaultVal)!.add(f.relPath);
    }

    // Hardcoded URLs/IPs (only in code files)
    if ([".ts", ".js", ".tsx", ".jsx"].includes(f.extension)) {
      for (let i = 0; i < f.lines.length; i++) {
        const line = f.lines[i];
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;

        for (const re of [URL_RE, IP_PORT_RE]) {
          re.lastIndex = 0;
          let hm;
          while ((hm = re.exec(line)) !== null) {
            if (hardcoded.length < 20) {
              hardcoded.push({ path: f.relPath, line: i + 1, value: hm[1].slice(0, 80) });
            }
          }
        }
      }
    }
  }

  // Scattered defaults: env vars with multiple different defaults
  const scattered: { name: string; defaults: { value: string; files: string[] }[] }[] = [];
  for (const [name, defaults] of envDefaults.entries()) {
    if (defaults.size > 1) {
      scattered.push({
        name,
        defaults: [...defaults.entries()].map(([v, fs]) => ({ value: v, files: [...fs] })),
      });
    }
  }

  const limit = scope === "detailed" ? 20 : 10;

  let out = "### Config\n";
  out += `- Unique env vars used: ${envVars.size}\n`;

  if (envVars.size > 0) {
    const sorted = [...envVars.entries()].sort((a, b) => b[1].size - a[1].size);
    out += `- Most-used env vars:\n`;
    for (const [name, fileSet] of sorted.slice(0, limit)) {
      out += `  - ${name} (${fileSet.size} files)\n`;
    }
  }

  out += `- Config-related files: ${configFiles.length}\n`;
  if (configFiles.length > 0) {
    out += `  ${configFiles.slice(0, limit).join(", ")}\n`;
  }

  if (scattered.length > 0) {
    out += `- Scattered defaults (same env var, different defaults): ${scattered.length}\n`;
    for (const s of scattered.slice(0, 5)) {
      out += `  - ${s.name}: ${s.defaults.map(d => `"${d.value}" in ${d.files.join(", ")}`).join(" vs ")}\n`;
    }
  } else {
    out += `- Scattered defaults: none detected\n`;
  }

  if (hardcoded.length > 0) {
    out += `- Hardcoded URLs/IPs: ${hardcoded.length}\n`;
    for (const h of hardcoded.slice(0, limit)) {
      out += `  - ${h.path}:${h.line} — ${h.value}\n`;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Report builder with progressive truncation
// ---------------------------------------------------------------------------

function buildReport(
  sections: AnalysisResult,
  focus: Focus,
  scope: Scope,
  path: string,
  fileCount: number,
  maxChars: number,
): { report: string; truncated: boolean } {
  const header = `## Codebase Analysis Report\nScope: ${scope} | Path: ${path} | Focus: ${focus} | Files: ${fileCount}\n\n`;

  // Order of sections (and order of truncation — last gets dropped first)
  const sectionOrder: (keyof AnalysisResult)[] = [
    "structure",
    "dependencies",
    "complexity",
    "quality",
    "config",
  ];

  const available = sectionOrder.filter(k => sections[k]);

  // Try full report first
  let body = available.map(k => sections[k]).join("\n");
  let full = header + body;

  if (full.length <= maxChars) {
    return { report: full, truncated: false };
  }

  // Progressive truncation: drop sections from the end, but never drop the
  // section the user explicitly requested via the focus parameter.
  const dropOrder: (keyof AnalysisResult)[] = ["config", "quality", "complexity", "dependencies", "structure"];
  const truncNote = "\n[Report truncated. Use focus parameter to analyze specific categories in detail.]\n";
  const protectedSection = focus !== "all" ? focus : null;

  for (const toDrop of dropOrder) {
    if (toDrop === protectedSection) continue; // never drop the requested focus
    const idx = available.indexOf(toDrop);
    if (idx !== -1) {
      available.splice(idx, 1);
      body = available.map(k => sections[k]).join("\n");
      full = header + body + truncNote;
      if (full.length <= maxChars) {
        return { report: full, truncated: true };
      }
    }
  }

  // Last resort: hard truncate
  const hardTrunc = header + body;
  return {
    report: hardTrunc.slice(0, maxChars - truncNote.length) + truncNote,
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createAnalyzeCodebaseTool(codebaseConfig: CodebaseConfig): Tool {
  return {
    definition: {
      name: "analyze_codebase",
      description:
        "Run programmatic analysis on the codebase and return structured findings about structure, complexity, dependencies, quality signals, and config patterns. " +
        "Returns metrics and diagnostics useful for identifying improvement opportunities. " +
        "Use 'overview' scope for fast high-level stats or 'detailed' for per-file breakdowns. " +
        "Use 'focus' to target a specific analysis category.",
      parameters: {
        type: "object",
        properties: {
          focus: {
            type: "string",
            description:
              "Analysis category. 'all' runs every analyzer. Pick one for targeted analysis: 'structure', 'complexity', 'dependencies', 'quality', 'config'.",
            enum: ["all", "structure", "complexity", "dependencies", "quality", "config"],
          },
          path: {
            type: "string",
            description:
              "Restrict analysis to this directory (relative to codebase root). Default: entire codebase. E.g. 'src/tools'.",
          },
          scope: {
            type: "string",
            description:
              "Level of detail. 'overview' = aggregated stats (fast, compact output). 'detailed' = more items per list. Default: 'overview'.",
            enum: ["overview", "detailed"],
          },
        },
      },
    },

    async execute(args, _context): Promise<ToolResult> {
      const focus = ((args.focus as string) || "all") as Focus;
      const scope = ((args.scope as string) || "overview") as Scope;
      const pathArg = (args.path as string) || ".";

      // Validate path
      const targetPath = resolve(codebaseConfig.root, pathArg);
      const pathCheck = validatePath(targetPath, codebaseConfig.root, [...codebaseConfig.ignorePatterns]);
      if (!pathCheck.valid) {
        return { success: false, data: null, error: `Invalid path: ${pathCheck.error}` };
      }

      // Collect files
      const { files, warnings } = collectFiles(
        pathCheck.resolved,
        codebaseConfig.root,
        codebaseConfig.ignorePatterns,
        codebaseConfig.maxFileSize,
      );

      if (files.length === 0) {
        return {
          success: true,
          data: {
            scope,
            focus,
            path: pathArg,
            files_scanned: 0,
            report: "No analyzable files found in the specified path.",
            truncated: false,
            warnings,
          },
        };
      }

      // Run analyzers based on focus
      const sections: AnalysisResult = {};

      if (focus === "all" || focus === "structure") {
        sections.structure = analyzeStructure(files, scope);
      }
      if (focus === "all" || focus === "complexity") {
        sections.complexity = analyzeComplexity(files, scope);
      }
      if (focus === "all" || focus === "dependencies") {
        sections.dependencies = analyzeDependencies(files, scope);
      }
      if (focus === "all" || focus === "quality") {
        sections.quality = analyzeQuality(files, scope);
      }
      if (focus === "all" || focus === "config") {
        sections.config = analyzeConfig(files, scope);
      }

      const { report, truncated } = buildReport(
        sections,
        focus,
        scope,
        pathArg,
        files.length,
        codebaseConfig.maxOutputChars,
      );

      return {
        success: true,
        data: {
          scope,
          focus,
          path: pathArg,
          files_scanned: files.length,
          report,
          truncated,
          warnings,
        },
      };
    },
  };
}
