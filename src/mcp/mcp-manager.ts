/**
 * mcp-manager.ts — Orchestrates MCP server lifecycle (connect / disconnect).
 *
 * McpManager encapsulates parallel connection of multiple MCP servers so that
 * index.ts can replace its inline loop with a single `connectAll()` call.
 *
 * Key design decisions:
 * - Connections run via Promise.allSettled so one failure never blocks others.
 * - 10-second per-server timeout applied internally via Promise.race.
 * - Tool registration errors (duplicate name collisions) are caught and logged
 *   as warnings rather than failing the whole server connection.
 */

import { McpClient } from "./mcp-client.js";
import { adaptMcpTools } from "./mcp-tool-adapter.js";
import type { McpServerConfig } from "../tools/mcp-config-loader.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import { createLogger } from "../logger.js";

const log = createLogger("mcp");

const CONNECT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface McpStartupSummary {
  connected: number;
  failed: number;
  toolsRegistered: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// McpManager
// ---------------------------------------------------------------------------

export class McpManager {
  private configs: McpServerConfig[];
  private clients: McpClient[] = [];

  constructor(configs: McpServerConfig[]) {
    this.configs = configs;
  }

  /**
   * Connect all configured MCP servers in parallel and register their tools.
   *
   * Uses Promise.allSettled so a failure on one server does not block others.
   * Returns a summary of connection results for the caller to log.
   */
  async connectAll(registry: ToolRegistry): Promise<McpStartupSummary> {
    if (this.configs.length === 0) {
      return { connected: 0, failed: 0, toolsRegistered: 0, errors: [] };
    }

    const results = await Promise.allSettled(
      this.configs.map((cfg) => this.connectOne(cfg, registry)),
    );

    const summary: McpStartupSummary = {
      connected: 0,
      failed: 0,
      toolsRegistered: 0,
      errors: [],
    };

    for (const result of results) {
      if (result.status === "fulfilled") {
        summary.connected++;
        summary.toolsRegistered += result.value;
      } else {
        summary.failed++;
        summary.errors.push((result.reason as Error).message);
      }
    }

    return summary;
  }

  /**
   * Connect a single MCP server, register its tools, and push the client
   * into the active clients array.
   *
   * @returns Number of tools successfully registered for this server.
   * @throws  On connection timeout or connect() failure — caller (connectAll)
   *          catches via Promise.allSettled.
   */
  private async connectOne(cfg: McpServerConfig, registry: ToolRegistry): Promise<number> {
    const client = new McpClient(cfg);

    // Apply 10-second timeout — covers slow npx npm-install on first run
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Connection timeout after ${CONNECT_TIMEOUT_MS}ms`)),
          CONNECT_TIMEOUT_MS,
        ),
      ),
    ]);

    const { tools } = await client.listTools();
    const adapted = adaptMcpTools(tools, client, cfg.name);

    let registered = 0;
    for (const tool of adapted) {
      try {
        registry.register(tool);
        registered++;
      } catch (err) {
        // ToolRegistry.register() throws on duplicate name — log and skip
        log.warn({ server: cfg.name, error: (err as Error).message }, `Tool name collision: ${tool.definition.name} — skipping`);
      }
    }

    this.clients.push(client);
    log.info({ toolsRegistered: registered, totalExposed: tools.length }, `Connected: ${cfg.name}`);

    return registered;
  }

  /**
   * Disconnect all active MCP clients cleanly.
   *
   * Uses Promise.allSettled so one failed disconnect does not block others.
   */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(this.clients.map((c) => c.disconnect()));
    log.info("MCP connections closed");
  }
}
