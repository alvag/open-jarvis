import { readFileSync, statSync } from "node:fs";
import { resolve, join, dirname, relative, extname } from "node:path";
import type { Tool, ToolResult } from "../tool-types.js";
import { validatePath } from "../../security/path-validator.js";
import type { CodebaseConfig } from "./read-file.js";
import { collectFiles, type FileInfo } from "./codebase-shared.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = "file" | "module" | "flow";
type Focus = "all" | "duplication" | "complexity" | "coupling" | "dead_code" | "error_handling" | "hardcodes";

interface RefactorCandidate {
  type:
    | "long_function"
    | "god_object_hint"
    | "duplication"
    | "high_coupling"
    | "deep_nesting"
    | "dead_export"
    | "empty_catch"
    | "inconsistent_error"
    | "hardcoded_value"
    | "complex_conditional";
  files: string[];
  locations: string[];
  metric: number;
  detail: string;
  snippet?: string;
}

// ---------------------------------------------------------------------------
// Code file extensions
// ---------------------------------------------------------------------------

const CODE_EXTS = [".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"];

function isCodeFile(f: FileInfo): boolean {
  return CODE_EXTS.includes(f.extension);
}

// ---------------------------------------------------------------------------
// Import parsing (shared patterns from analyzeDependencies)
// ---------------------------------------------------------------------------

const LINE_IMPORT_RE = /^\s*(?:import\s+.*?\s+from\s+|import\s+|export\s+.*?\s+from\s+)["']([^"']+)["']/;
const LINE_REQUIRE_RE = /^\s*(?:const|let|var|import)\s+.*?require\s*\(\s*["']([^"']+)["']\s*\)/;

function parseImports(file: FileInfo): string[] {
  const specifiers: string[] = [];
  for (const line of file.lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    const importMatch = line.match(LINE_IMPORT_RE);
    if (importMatch) {
      specifiers.push(importMatch[1]);
      continue;
    }
    const requireMatch = line.match(LINE_REQUIRE_RE);
    if (requireMatch) specifiers.push(requireMatch[1]);
  }
  return specifiers;
}

function resolveInternalImport(
  specifier: string,
  fromFile: FileInfo,
  knownPaths: Set<string>,
): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;

  const dir = dirname(fromFile.relPath);
  let resolved = join(dir, specifier).replace(/\\/g, "/");
  if (resolved.startsWith("./")) resolved = resolved.slice(2);

  // Direct match (specifier already has extension)
  if (knownPaths.has(resolved)) return resolved;

  // .js -> .ts rewrite
  if (resolved.endsWith(".js")) {
    const tsVariant = resolved.replace(/\.js$/, ".ts");
    if (knownPaths.has(tsVariant)) return tsVariant;
  }

  // Extensionless imports: try common extensions
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  for (const ext of extensions) {
    if (knownPaths.has(resolved + ext)) return resolved + ext;
  }

  // Directory imports: try index files
  for (const ext of extensions) {
    const indexPath = resolved + "/index" + ext;
    if (knownPaths.has(indexPath)) return indexPath;
  }

  // No match found — return raw resolved path (may not exist in collected files)
  return resolved;
}

// ---------------------------------------------------------------------------
// Flow mode: transitive import resolution
// ---------------------------------------------------------------------------

function resolveFlowFiles(
  entryFile: FileInfo,
  allFiles: FileInfo[],
  maxDepth: number,
): FileInfo[] {
  const fileMap = new Map<string, FileInfo>();
  for (const f of allFiles) fileMap.set(f.relPath, f);

  const knownPaths = new Set(allFiles.map(f => f.relPath));
  const visited = new Set<string>();
  const result: FileInfo[] = [];

  function walk(file: FileInfo, depth: number): void {
    if (visited.has(file.relPath)) return;
    visited.add(file.relPath);
    result.push(file);

    if (depth >= maxDepth) return;
    if (!isCodeFile(file)) return;

    const specifiers = parseImports(file);
    for (const spec of specifiers) {
      const resolved = resolveInternalImport(spec, file, knownPaths);
      if (resolved && fileMap.has(resolved)) {
        walk(fileMap.get(resolved)!, depth + 1);
      }
    }
  }

  walk(entryFile, 0);
  return result;
}

// ---------------------------------------------------------------------------
// Single file loader (for file mode)
// ---------------------------------------------------------------------------

function loadSingleFile(
  filePath: string,
  codebaseRoot: string,
  ignorePatterns: readonly string[],
  maxFileSize: number,
): { file: FileInfo | null; error?: string } {
  const absPath = resolve(codebaseRoot, filePath);
  const validation = validatePath(absPath, codebaseRoot, [...ignorePatterns]);
  if (!validation.valid) return { file: null, error: `Invalid path: ${validation.error}` };

  try {
    const st = statSync(validation.resolved);
    if (st.isDirectory()) return { file: null, error: "Path is a directory. Use mode 'module' instead." };
    if (st.size > maxFileSize) return { file: null, error: `File too large (${st.size} bytes)` };

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
// Import graph builder (reused by coupling + dead code analyzers)
// ---------------------------------------------------------------------------

interface ImportGraph {
  graph: Map<string, Set<string>>;       // file -> imported files
  importedBy: Map<string, Set<string>>;  // file -> files that import it
}

function buildImportGraph(files: FileInfo[]): ImportGraph {
  const codeFiles = files.filter(isCodeFile);
  const knownPaths = new Set(files.map(f => f.relPath));
  const graph = new Map<string, Set<string>>();
  const importedBy = new Map<string, Set<string>>();

  for (const f of codeFiles) {
    const imports = new Set<string>();
    const specifiers = parseImports(f);

    for (const spec of specifiers) {
      const resolved = resolveInternalImport(spec, f, knownPaths);
      if (resolved) {
        imports.add(resolved);
        if (!importedBy.has(resolved)) importedBy.set(resolved, new Set());
        importedBy.get(resolved)!.add(f.relPath);
      }
    }

    graph.set(f.relPath, imports);
  }

  return { graph, importedBy };
}

// ---------------------------------------------------------------------------
// Analyzer 1: Long Functions + God Object Hints
// ---------------------------------------------------------------------------

const CONTROL_FLOW_KW = /^\s*(?:if|else|for|while|switch|catch|finally)\s*\(/;
const FUNC_PATTERNS = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/,
  /^\s*(?:public|private|protected|static|async)\s+\w+\s*\(/,
  /^\s*\w+\s*\([^)]*\)\s*(?::\s*\w[^{]*)?\s*\{/,
];

function analyzeLongFunctions(files: FileInfo[]): RefactorCandidate[] {
  const candidates: RefactorCandidate[] = [];
  const codeFiles = files.filter(isCodeFile);

  for (const f of codeFiles) {
    let inFunction = false;
    let funcStartLine = 0;
    let funcName = "";
    let braceDepth = 0;
    let funcStartDepth = 0;
    let funcCount = 0;

    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;

      if (!inFunction && !CONTROL_FLOW_KW.test(line)) {
        for (const pat of FUNC_PATTERNS) {
          if (pat.test(line)) {
            funcCount++;
            inFunction = true;
            funcStartLine = i + 1;
            funcStartDepth = braceDepth;
            const nameMatch = line.match(/(?:function|const|let|var|async)\s+(\w+)/);
            funcName = nameMatch ? nameMatch[1] : `anonymous:${i + 1}`;
            break;
          }
        }
      }

      braceDepth += opens - closes;

      if (inFunction && braceDepth <= funcStartDepth && closes > 0) {
        const funcLength = (i + 1) - funcStartLine + 1;
        if (funcLength > 50) {
          const snippetLine = f.lines[funcStartLine - 1]?.trim().slice(0, 80) || "";
          candidates.push({
            type: "long_function",
            files: [f.relPath],
            locations: [`${f.relPath}:${funcStartLine}`],
            metric: funcLength,
            detail: `Function '${funcName}' is ${funcLength} lines long`,
            snippet: snippetLine,
          });
        }
        inFunction = false;
      }
    }

    // God object hint: >10 functions/methods in one file
    if (funcCount > 10) {
      candidates.push({
        type: "god_object_hint",
        files: [f.relPath],
        locations: [`${f.relPath}:1`],
        metric: funcCount,
        detail: `File has ${funcCount} functions/methods — potential god object`,
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Analyzer 2: Duplication (sliding window hash)
// ---------------------------------------------------------------------------

function analyzeDuplication(files: FileInfo[]): RefactorCandidate[] {
  const codeFiles = files.filter(isCodeFile);
  if (codeFiles.length < 2) return [];

  const WINDOW_SIZE = 5;
  const TRIVIAL_RE = /^\s*(?:import\s|export\s.*from|\/\/|\/\*|\*|}\s*$|{\s*$|\s*$)/;

  // Collect normalized lines per file (skip trivial lines)
  type WindowInfo = { file: string; startLine: number };
  const windowMap = new Map<string, WindowInfo[]>();

  for (const f of codeFiles) {
    const normalizedLines: { text: string; lineNum: number }[] = [];
    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      if (TRIVIAL_RE.test(line)) continue;
      const normalized = line.trim().replace(/\s+/g, " ");
      if (normalized.length < 5) continue;
      normalizedLines.push({ text: normalized, lineNum: i + 1 });
    }

    // Build windows
    for (let i = 0; i <= normalizedLines.length - WINDOW_SIZE; i++) {
      const windowText = normalizedLines.slice(i, i + WINDOW_SIZE).map(l => l.text).join("\n");
      if (!windowMap.has(windowText)) windowMap.set(windowText, []);
      windowMap.get(windowText)!.push({ file: f.relPath, startLine: normalizedLines[i].lineNum });
    }
  }

  // Find windows that appear in 2+ different files
  const candidates: RefactorCandidate[] = [];
  const seenPairs = new Set<string>();

  for (const [windowText, occurrences] of windowMap) {
    // Deduplicate by file — only care about cross-file duplication
    const byFile = new Map<string, number>();
    for (const occ of occurrences) {
      if (!byFile.has(occ.file)) byFile.set(occ.file, occ.startLine);
    }
    if (byFile.size < 2) continue;

    const fileList = [...byFile.keys()].sort();
    const pairKey = fileList.join("+");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const locations = [...byFile.entries()].map(([file, line]) => `${file}:${line}`);
    const snippetLines = windowText.split("\n").slice(0, 2).join(" | ");

    candidates.push({
      type: "duplication",
      files: fileList,
      locations,
      metric: WINDOW_SIZE * byFile.size,
      detail: `${WINDOW_SIZE} identical lines found in ${byFile.size} files`,
      snippet: snippetLines.slice(0, 100),
    });

    if (candidates.length >= 15) break;
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Analyzer 3: Coupling Analysis
// ---------------------------------------------------------------------------

function analyzeCoupling(files: FileInfo[]): RefactorCandidate[] {
  const { graph, importedBy } = buildImportGraph(files);
  const candidates: RefactorCandidate[] = [];

  // High coupling: fan-in + fan-out > 12
  for (const f of files.filter(isCodeFile)) {
    const fanOut = graph.get(f.relPath)?.size || 0;
    const fanIn = importedBy.get(f.relPath)?.size || 0;
    const total = fanIn + fanOut;

    if (total > 12) {
      candidates.push({
        type: "high_coupling",
        files: [f.relPath],
        locations: [`${f.relPath}:1`],
        metric: total,
        detail: `High coupling: ${fanIn} importers + ${fanOut} imports = ${total} connections`,
      });
    }
  }

  // Bidirectional dependencies
  const checked = new Set<string>();
  for (const [fileA, importsA] of graph) {
    for (const target of importsA) {
      const pairKey = [fileA, target].sort().join("↔");
      if (checked.has(pairKey)) continue;
      checked.add(pairKey);

      const importsB = graph.get(target);
      if (importsB && importsB.has(fileA)) {
        candidates.push({
          type: "high_coupling",
          files: [fileA, target],
          locations: [`${fileA}:1`, `${target}:1`],
          metric: 20, // High metric to surface bidirectional deps
          detail: `Bidirectional dependency: ${fileA} <-> ${target}`,
        });
      }
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Analyzer 4: Conditional Complexity
// ---------------------------------------------------------------------------

function analyzeConditionalComplexity(files: FileInfo[]): RefactorCandidate[] {
  const candidates: RefactorCandidate[] = [];
  const codeFiles = files.filter(isCodeFile);

  for (const f of codeFiles) {
    let maxDepth = 0;
    let maxDepthLine = 0;
    let inSwitch = false;
    let switchStartLine = 0;
    let caseCount = 0;

    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

      // Nesting depth via indentation (2-space indent)
      const leadingSpaces = line.length - line.trimStart().length;
      const depth = Math.floor(leadingSpaces / 2);
      if (depth > maxDepth) {
        maxDepth = depth;
        maxDepthLine = i + 1;
      }

      // Switch case counting
      if (/^\s*switch\s*\(/.test(line)) {
        inSwitch = true;
        switchStartLine = i + 1;
        caseCount = 0;
      }
      if (inSwitch && /^\s*case\s+/.test(trimmed)) {
        caseCount++;
      }
      if (inSwitch && /^\s*}\s*$/.test(line) && depth <= 1) {
        if (caseCount > 8) {
          candidates.push({
            type: "complex_conditional",
            files: [f.relPath],
            locations: [`${f.relPath}:${switchStartLine}`],
            metric: caseCount,
            detail: `Switch statement with ${caseCount} cases`,
            snippet: f.lines[switchStartLine - 1]?.trim().slice(0, 80),
          });
        }
        inSwitch = false;
      }

      // Chained ternaries
      const ternaryCount = (trimmed.match(/\?/g) || []).length;
      if (ternaryCount >= 2 && trimmed.includes(":")) {
        candidates.push({
          type: "complex_conditional",
          files: [f.relPath],
          locations: [`${f.relPath}:${i + 1}`],
          metric: ternaryCount,
          detail: `Chained ternary with ${ternaryCount} branches`,
          snippet: trimmed.slice(0, 80),
        });
      }
    }

    // Deep nesting for the file overall
    if (maxDepth > 3) {
      candidates.push({
        type: "deep_nesting",
        files: [f.relPath],
        locations: [`${f.relPath}:${maxDepthLine}`],
        metric: maxDepth,
        detail: `Maximum nesting depth of ${maxDepth} levels`,
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Analyzer 5: Dead Code
// ---------------------------------------------------------------------------

const EXPORT_RE = /^\s*export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/;

function analyzeDeadCode(files: FileInfo[]): RefactorCandidate[] {
  const { importedBy } = buildImportGraph(files);
  const candidates: RefactorCandidate[] = [];
  const codeFiles = files.filter(isCodeFile);

  // Entry point heuristics: index files, main files
  const entryPatterns = /(?:^|\/)(?:index|main|app|server)\./;

  for (const f of codeFiles) {
    const isEntry = entryPatterns.test(f.relPath);
    const importers = importedBy.get(f.relPath)?.size || 0;

    // File-level dead code: no importers and not an entry point
    if (!isEntry && importers === 0 && codeFiles.length > 1) {
      // Check if the file has any exports (if no exports, it might be a script)
      const hasExports = f.lines.some(l => /^\s*export\s/.test(l));
      if (hasExports) {
        candidates.push({
          type: "dead_export",
          files: [f.relPath],
          locations: [`${f.relPath}:1`],
          metric: f.lineCount,
          detail: `File exports symbols but is not imported by any analyzed file (${f.lineCount} lines)`,
        });
      }
    }

    // Individual exported symbols not imported anywhere
    // Build a set of all imported symbol names (heuristic: check import specifiers)
    const deadExports: { name: string; line: number }[] = [];
    for (let i = 0; i < f.lines.length; i++) {
      const match = f.lines[i].match(EXPORT_RE);
      if (match) {
        const symbolName = match[1];
        // Check if this symbol name appears in any other file's imports
        let imported = false;
        for (const other of codeFiles) {
          if (other.relPath === f.relPath) continue;
          for (const line of other.lines) {
            if (line.includes(symbolName) && LINE_IMPORT_RE.test(line.trimStart())) {
              imported = true;
              break;
            }
          }
          if (imported) break;
        }
        if (!imported) {
          deadExports.push({ name: symbolName, line: i + 1 });
        }
      }
    }

    if (deadExports.length > 0 && !isEntry) {
      candidates.push({
        type: "dead_export",
        files: [f.relPath],
        locations: deadExports.slice(0, 5).map(e => `${f.relPath}:${e.line}`),
        metric: deadExports.length,
        detail: `${deadExports.length} exported symbol(s) not imported: ${deadExports.slice(0, 3).map(e => e.name).join(", ")}${deadExports.length > 3 ? "..." : ""}`,
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Analyzer 6: Error Handling
// ---------------------------------------------------------------------------

function analyzeErrorHandling(files: FileInfo[]): RefactorCandidate[] {
  const candidates: RefactorCandidate[] = [];
  const codeFiles = files.filter(isCodeFile);

  for (const f of codeFiles) {
    let emptyCatches = 0;
    let throwCount = 0;
    let returnErrorCount = 0;
    let returnNullOnError = 0;

    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      const trimmed = line.trimStart();

      // Empty catch detection
      if (/^\s*}\s*catch\s*/.test(line) || /^\s*catch\s*\(/.test(line)) {
        // Check next non-empty lines for empty/comment-only body
        let bodyEmpty = true;
        for (let j = i + 1; j < Math.min(i + 4, f.lines.length); j++) {
          const nextTrimmed = f.lines[j].trimStart();
          if (nextTrimmed === "}" || nextTrimmed === "") continue;
          if (nextTrimmed.startsWith("//")) continue;
          bodyEmpty = false;
          break;
        }
        if (bodyEmpty) emptyCatches++;
      }

      // Error pattern counting
      if (/\bthrow\s+/.test(trimmed)) throwCount++;
      if (/return\s*\{[^}]*error/i.test(trimmed)) returnErrorCount++;
      if (/catch.*\{/.test(trimmed) || /\bcatch\b/.test(trimmed)) {
        // Check if following lines return null/undefined
        for (let j = i + 1; j < Math.min(i + 5, f.lines.length); j++) {
          if (/return\s+null\b|return\s+undefined\b/.test(f.lines[j])) {
            returnNullOnError++;
            break;
          }
        }
      }
    }

    if (emptyCatches > 0) {
      candidates.push({
        type: "empty_catch",
        files: [f.relPath],
        locations: [`${f.relPath}:1`],
        metric: emptyCatches,
        detail: `${emptyCatches} empty or comment-only catch block(s)`,
      });
    }

    // Inconsistent error handling: mix of throw + return {error} + return null
    const patterns = [throwCount > 0, returnErrorCount > 0, returnNullOnError > 0];
    const distinctPatterns = patterns.filter(Boolean).length;
    if (distinctPatterns >= 2) {
      const parts: string[] = [];
      if (throwCount > 0) parts.push(`throw (${throwCount})`);
      if (returnErrorCount > 0) parts.push(`return {error} (${returnErrorCount})`);
      if (returnNullOnError > 0) parts.push(`return null (${returnNullOnError})`);

      candidates.push({
        type: "inconsistent_error",
        files: [f.relPath],
        locations: [`${f.relPath}:1`],
        metric: distinctPatterns,
        detail: `Mixed error patterns: ${parts.join(", ")}`,
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Analyzer 7: Hardcodes
// ---------------------------------------------------------------------------

const URL_RE = /["'](https?:\/\/[^"'\s]+)["']/g;
const IP_PORT_RE = /["'](\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?)["']/g;

function analyzeHardcodes(files: FileInfo[]): RefactorCandidate[] {
  const candidates: RefactorCandidate[] = [];
  const codeFiles = files.filter(isCodeFile);

  // Hardcoded URLs/IPs
  const hardcodedUrls: { path: string; line: number; value: string }[] = [];

  // String literal frequency tracking
  const stringFreq = new Map<string, { count: number; files: Set<string>; firstLoc: string }>();

  for (const f of codeFiles) {
    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i];
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      // URLs and IPs
      for (const re of [URL_RE, IP_PORT_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          if (hardcodedUrls.length < 20) {
            hardcodedUrls.push({ path: f.relPath, line: i + 1, value: m[1].slice(0, 60) });
          }
        }
      }

      // Repeated string literals (>= 6 chars to avoid trivial strings)
      const STRING_LIT_RE = /["']([^"']{6,60})["']/g;
      STRING_LIT_RE.lastIndex = 0;
      let sm;
      while ((sm = STRING_LIT_RE.exec(line)) !== null) {
        const val = sm[1];
        // Skip import paths and common patterns
        if (val.startsWith(".") || val.startsWith("/") || val.startsWith("http")) continue;
        if (!stringFreq.has(val)) {
          stringFreq.set(val, { count: 0, files: new Set(), firstLoc: `${f.relPath}:${i + 1}` });
        }
        const entry = stringFreq.get(val)!;
        entry.count++;
        entry.files.add(f.relPath);
      }
    }
  }

  // Hardcoded URLs
  if (hardcodedUrls.length > 0) {
    // Group by value
    const urlsByValue = new Map<string, typeof hardcodedUrls>();
    for (const h of hardcodedUrls) {
      if (!urlsByValue.has(h.value)) urlsByValue.set(h.value, []);
      urlsByValue.get(h.value)!.push(h);
    }

    for (const [value, occurrences] of urlsByValue) {
      const files = [...new Set(occurrences.map(o => o.path))];
      candidates.push({
        type: "hardcoded_value",
        files,
        locations: occurrences.slice(0, 3).map(o => `${o.path}:${o.line}`),
        metric: occurrences.length,
        detail: `Hardcoded URL/IP: "${value}" appears ${occurrences.length} time(s)`,
        snippet: value,
      });
    }
  }

  // Repeated magic strings (3+ occurrences across 2+ files)
  for (const [val, info] of stringFreq) {
    if (info.count >= 3 && info.files.size >= 2) {
      candidates.push({
        type: "hardcoded_value",
        files: [...info.files],
        locations: [info.firstLoc],
        metric: info.count,
        detail: `Magic string "${val.slice(0, 40)}" repeated ${info.count} times across ${info.files.size} files`,
        snippet: val.slice(0, 60),
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Report builder with progressive truncation
// ---------------------------------------------------------------------------

function buildOutput(
  mode: Mode,
  path: string,
  filesAnalyzed: number,
  allCandidates: RefactorCandidate[],
  maxChars: number,
  warnings: string[],
): { output: Record<string, unknown>; truncated: boolean } {
  // Sort by metric descending
  allCandidates.sort((a, b) => b.metric - a.metric);

  // Count by type
  const byType: Record<string, number> = {};
  for (const c of allCandidates) {
    byType[c.type] = (byType[c.type] || 0) + 1;
  }

  const base = {
    mode,
    path,
    files_analyzed: filesAnalyzed,
    total_candidates: allCandidates.length,
    by_type: byType,
    warnings,
  };

  // Try full output
  let candidates = allCandidates;
  let output = { ...base, candidates, truncated: false };
  let serialized = JSON.stringify(output);

  if (serialized.length <= maxChars) {
    return { output, truncated: false };
  }

  // Progressive truncation: remove lowest-metric candidates until we fit
  while (candidates.length > 0 && serialized.length > maxChars) {
    candidates = candidates.slice(0, -1);
    output = {
      ...base,
      candidates,
      truncated: true,
      truncation_note: `Showing top ${candidates.length} of ${allCandidates.length} candidates. Use 'focus' parameter to narrow analysis.`,
    } as typeof output;
    serialized = JSON.stringify(output);
  }

  return { output, truncated: candidates.length < allCandidates.length };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createFindRefactorCandidatesTool(codebaseConfig: CodebaseConfig): Tool {
  return {
    definition: {
      name: "find_refactor_candidates",
      description:
        "Scan code files for refactoring opportunities using programmatic heuristics. " +
        "Detects: long functions, god objects, code duplication, high coupling, deep nesting, " +
        "dead exports, empty catches, inconsistent error handling, and hardcoded values. " +
        "Returns structured candidates for the agent to reason about and prioritize. " +
        "Three modes: 'file' (single file), 'module' (directory), 'flow' (file + transitive imports).",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            description:
              "Analysis mode. 'file' = analyze a single file. 'module' = analyze all files in a directory. " +
              "'flow' = analyze a file and all its transitive imports.",
            enum: ["file", "module", "flow"],
          },
          path: {
            type: "string",
            description:
              "Target path relative to codebase root. For 'file': a file path. " +
              "For 'module': a directory path. For 'flow': the entry file path.",
          },
          focus: {
            type: "string",
            description:
              "Restrict analysis to a specific category. Default: 'all'.",
            enum: ["all", "duplication", "complexity", "coupling", "dead_code", "error_handling", "hardcodes"],
          },
          depth: {
            type: "number",
            description:
              "For 'flow' mode only: how many levels of transitive imports to follow. Default: 3. Max: 5.",
          },
        },
        required: ["mode", "path"],
      },
    },

    async execute(args, _context): Promise<ToolResult> {
      const mode = args.mode as Mode;
      const pathArg = args.path as string;
      const focus = (args.focus as Focus) || "all";
      const depth = Math.min(Math.max((args.depth as number) || 3, 1), 5);

      // Collect files based on mode
      let files: FileInfo[];
      const warnings: string[] = [];

      if (mode === "file") {
        const { file, error } = loadSingleFile(
          pathArg,
          codebaseConfig.root,
          codebaseConfig.ignorePatterns,
          codebaseConfig.maxFileSize,
        );
        if (!file) {
          return { success: false, data: null, error: error || "Could not load file" };
        }

        // Load full codebase for graph-based analysis (coupling, dead code)
        const needsGraph = focus === "all" || focus === "coupling" || focus === "dead_code";
        let graphFiles: FileInfo[] = [file];
        if (needsGraph) {
          const { files: allFiles, warnings: w } = collectFiles(
            codebaseConfig.root,
            codebaseConfig.root,
            codebaseConfig.ignorePatterns,
            codebaseConfig.maxFileSize,
          );
          warnings.push(...w);
          graphFiles = allFiles;
        }

        const focusStr = focus as string;
        const candidates: RefactorCandidate[] = [];

        if (focusStr === "all" || focusStr === "complexity") {
          candidates.push(...analyzeLongFunctions([file]));
          candidates.push(...analyzeConditionalComplexity([file]));
        }
        if (focusStr === "all" || focusStr === "error_handling") {
          candidates.push(...analyzeErrorHandling([file]));
        }
        if (focusStr === "all" || focusStr === "hardcodes") {
          candidates.push(...analyzeHardcodes([file]));
        }
        if (focusStr === "all" || focusStr === "coupling") {
          const { graph, importedBy } = buildImportGraph(graphFiles);
          const fanOut = graph.get(file.relPath)?.size || 0;
          const fanIn = importedBy.get(file.relPath)?.size || 0;
          if (fanIn + fanOut > 12) {
            candidates.push({
              type: "high_coupling",
              files: [file.relPath],
              locations: [`${file.relPath}:1`],
              metric: fanIn + fanOut,
              detail: `High coupling: ${fanIn} importers + ${fanOut} imports = ${fanIn + fanOut} connections`,
            });
          }
        }
        if (focusStr === "all" || focusStr === "dead_code") {
          const deadCandidates = analyzeDeadCode(graphFiles);
          candidates.push(...deadCandidates.filter(c => c.files.includes(file.relPath)));
        }
        if (focusStr === "duplication") {
          warnings.push("Duplication analysis requires multiple files. Use 'module' or 'flow' mode.");
        }

        const { output } = buildOutput(
          mode, pathArg, 1, candidates, codebaseConfig.maxOutputChars, warnings,
        );
        return { success: true, data: output };
      }

      if (mode === "module") {
        const targetPath = resolve(codebaseConfig.root, pathArg);
        const pathCheck = validatePath(targetPath, codebaseConfig.root, [...codebaseConfig.ignorePatterns]);
        if (!pathCheck.valid) {
          return { success: false, data: null, error: `Invalid path: ${pathCheck.error}` };
        }

        // Verify target is a directory
        try {
          const st = statSync(pathCheck.resolved);
          if (!st.isDirectory()) {
            return { success: false, data: null, error: `Path is a file, not a directory. Use mode 'file' for single files.` };
          }
        } catch {
          return { success: false, data: null, error: `Path not found: ${pathArg}` };
        }

        const { files: collected, warnings: w } = collectFiles(
          pathCheck.resolved,
          codebaseConfig.root,
          codebaseConfig.ignorePatterns,
          codebaseConfig.maxFileSize,
        );
        warnings.push(...w);
        files = collected;
      } else {
        // flow mode
        // First load all files for import resolution, then resolve the flow
        const { file: entryFile, error } = loadSingleFile(
          pathArg,
          codebaseConfig.root,
          codebaseConfig.ignorePatterns,
          codebaseConfig.maxFileSize,
        );
        if (!entryFile) {
          return { success: false, data: null, error: error || "Could not load entry file" };
        }

        const { files: allFiles, warnings: w } = collectFiles(
          codebaseConfig.root,
          codebaseConfig.root,
          codebaseConfig.ignorePatterns,
          codebaseConfig.maxFileSize,
        );
        warnings.push(...w);
        files = resolveFlowFiles(entryFile, allFiles, depth);
      }

      if (files.length === 0) {
        return {
          success: true,
          data: { mode, path: pathArg, files_analyzed: 0, total_candidates: 0, by_type: {}, candidates: [], truncated: false, warnings },
        };
      }

      // Run all applicable analyzers
      const candidates: RefactorCandidate[] = [];

      if (focus === "all" || focus === "complexity") {
        candidates.push(...analyzeLongFunctions(files));
        candidates.push(...analyzeConditionalComplexity(files));
      }
      if (focus === "all" || focus === "duplication") {
        candidates.push(...analyzeDuplication(files));
      }
      if (focus === "all" || focus === "coupling") {
        candidates.push(...analyzeCoupling(files));
      }
      if (focus === "all" || focus === "dead_code") {
        candidates.push(...analyzeDeadCode(files));
      }
      if (focus === "all" || focus === "error_handling") {
        candidates.push(...analyzeErrorHandling(files));
      }
      if (focus === "all" || focus === "hardcodes") {
        candidates.push(...analyzeHardcodes(files));
      }

      const { output, truncated } = buildOutput(
        mode, pathArg, files.length, candidates, codebaseConfig.maxOutputChars, warnings,
      );
      return { success: true, data: output };
    },
  };
}
