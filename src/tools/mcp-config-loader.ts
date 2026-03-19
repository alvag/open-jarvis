/**
 * mcp-config-loader.ts — Load MCP server declarations from mcp_config.json.
 *
 * Parses the mcp_config.json file into McpServerConfig objects for use in
 * Phase 6-7 MCP client connection. This module only reads and validates the
 * config — actual server connections happen later.
 *
 * Schema (superset of Claude Desktop claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "server-name": {
 *       "type": "stdio" | "streamable-http",  // default: "stdio"
 *       "command": "npx",                     // stdio only
 *       "args": ["-y", "@scope/package"],     // stdio only
 *       "url": "https://...",                 // streamable-http only
 *       "headers": { "Authorization": "Bearer ${TOKEN}" },  // streamable-http only
 *       "env": { "API_KEY": "${MY_VAR}" },   // both types
 *       "enabled": true                       // default: true
 *     }
 *   }
 * }
 *
 * ${VAR} substitution applies ONLY to env and headers values.
 * If a referenced env var is undefined, the entire server is skipped.
 *
 * Path override: set MCP_CONFIG_PATH env var or pass mcpConfigPath argument.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "../logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpServerConfig {
  name: string;
  type: "stdio" | "streamable-http";
  // stdio fields
  command?: string;
  args?: string[];
  // http fields
  url?: string;
  headers?: Record<string, string>;
  // common
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// ${VAR} substitution
// ---------------------------------------------------------------------------

const VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Substitute ${VAR} tokens in a string with values from process.env.
 * Returns the substituted string, or null if any variable is undefined
 * (signals that the entire server should be skipped).
 */
function substituteEnvVars(value: string, serverName: string): string | null {
  let ok = true;
  const result = value.replace(VAR_PATTERN, (_, varName: string) => {
    const val = process.env[varName];
    if (val === undefined) {
      log(
        "error",
        "mcp-config-loader",
        `Undefined env var "\${${varName}}" in server "${serverName}" — skipping server`,
      );
      ok = false;
      return "";
    }
    return val;
  });
  return ok ? result : null;
}

// ---------------------------------------------------------------------------
// Raw config shape (internal, not exported)
// ---------------------------------------------------------------------------

interface RawServerEntry {
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled?: boolean;
}

interface RawMcpConfig {
  mcpServers?: Record<string, RawServerEntry>;
}

// ---------------------------------------------------------------------------
// loadMcpConfig — public entry point
// ---------------------------------------------------------------------------

export function loadMcpConfig(mcpConfigPath?: string): McpServerConfig[] {
  const resolved = resolve(mcpConfigPath ?? process.env.MCP_CONFIG_PATH ?? "./mcp_config.json");

  if (!existsSync(resolved)) {
    log("info", "mcp-config-loader", "mcp_config.json not found — no MCP servers configured", {
      path: resolved,
    });
    return [];
  }

  let raw: RawMcpConfig;
  try {
    raw = JSON.parse(readFileSync(resolved, "utf-8")) as RawMcpConfig;
  } catch (err) {
    log("error", "mcp-config-loader", "Failed to parse mcp_config.json — no MCP servers configured", {
      path: resolved,
      error: (err as Error).message,
    });
    return [];
  }

  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof raw.mcpServers !== "object" ||
    raw.mcpServers === null
  ) {
    log("info", "mcp-config-loader", "No mcpServers key found in mcp_config.json");
    return [];
  }

  const servers: McpServerConfig[] = [];

  for (const [name, entry] of Object.entries(raw.mcpServers)) {
    // Skip disabled servers
    if (entry.enabled === false) {
      log("info", "mcp-config-loader", `MCP server "${name}" is disabled — skipping`);
      continue;
    }

    // Resolve type — default to "stdio" for Claude Desktop compatibility
    const type = ((entry.type as string) ?? "stdio") as "stdio" | "streamable-http";

    // Validate type
    if (type !== "stdio" && type !== "streamable-http") {
      log("error", "mcp-config-loader", `Unknown server type "${type}" for "${name}" — skipping`);
      continue;
    }

    // Type-specific field validation
    if (type === "stdio") {
      if (typeof entry.command !== "string" || entry.command.trim() === "") {
        log("error", "mcp-config-loader", `stdio server "${name}" missing command field — skipping`);
        continue;
      }
    }

    if (type === "streamable-http") {
      if (typeof entry.url !== "string" || entry.url.trim() === "") {
        log("error", "mcp-config-loader", `streamable-http server "${name}" missing url field — skipping`);
        continue;
      }
    }

    // Substitute ${VAR} in env values
    let resolvedEnv: Record<string, string> | undefined;
    if (entry.env) {
      let failed = false;
      resolvedEnv = {};
      for (const [k, v] of Object.entries(entry.env)) {
        const substituted = substituteEnvVars(v, name);
        if (substituted === null) {
          failed = true;
          break;
        }
        resolvedEnv[k] = substituted;
      }
      if (failed) {
        continue;
      }
    }

    // Substitute ${VAR} in headers values (streamable-http only)
    let resolvedHeaders: Record<string, string> | undefined;
    if (entry.headers) {
      let failed = false;
      resolvedHeaders = {};
      for (const [k, v] of Object.entries(entry.headers)) {
        const substituted = substituteEnvVars(v, name);
        if (substituted === null) {
          failed = true;
          break;
        }
        resolvedHeaders[k] = substituted;
      }
      if (failed) {
        continue;
      }
    }

    servers.push({
      name,
      type,
      command: entry.command,
      args: entry.args,
      url: entry.url,
      headers: resolvedHeaders,
      env: resolvedEnv,
    });

    log("info", "mcp-config-loader", `Loaded MCP server config: ${name}`, { type });
  }

  return servers;
}
