/**
 * mcp-client.ts — McpClient class wrapping MCP SDK Client + transports.
 *
 * Provides lifecycle management (connect/disconnect), dual transport support
 * (stdio child process + StreamableHTTP), crash detection via onclose/onerror,
 * stderr capture for stdio servers, and isAlive state tracking.
 *
 * This is the core building block for MCP integration. The adapter layer
 * (mcp-tool-adapter.ts) uses McpClient to expose MCP tools to the ToolRegistry.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "../tools/mcp-config-loader.js";
import { createLogger } from "../logger.js";

export class McpClient {
  readonly name: string;
  private client: Client;
  private transport: StdioClientTransport | StreamableHTTPClientTransport;
  private _isAlive: boolean = false;
  private log;

  constructor(config: McpServerConfig) {
    this.name = config.name;
    this.log = createLogger(`mcp:${config.name}`);
    this.client = new Client({ name: "jarvis", version: "1.0.0" });

    if (config.type === "stdio") {
      this.transport = new StdioClientTransport({
        command: config.command!,
        args: config.args ?? [],
        // Merge full process.env first, then server-specific env on top.
        // CRITICAL: Without this, npx and other tools fail with ENOENT because
        // SDK's getDefaultEnvironment() only provides ~6 safe vars (HOME, PATH, etc.)
        env: { ...process.env, ...config.env } as Record<string, string>,
        stderr: "pipe", // Capture stderr for debug logging
      });

      // Wire stderr capture for debug logging
      this.transport.stderr?.on("data", (chunk: Buffer) => {
        this.log.debug(chunk.toString().trimEnd());
      });
    } else {
      this.transport = new StreamableHTTPClientTransport(new URL(config.url!), {
        requestInit: {
          headers: config.headers ?? {},
        },
      });
    }
  }

  /**
   * Connect to the MCP server.
   *
   * Wires transport callbacks (onclose, onerror) BEFORE calling connect() —
   * the SDK calls transport.start() synchronously inside connect(), so late
   * wiring can miss early events.
   *
   * Sets isAlive = true after successful connection.
   */
  async connect(): Promise<void> {
    // Wire onclose BEFORE connect() — SDK calls transport.start() inside connect()
    this.transport.onclose = () => {
      if (this._isAlive) {
        // Only log warning for unexpected disconnections.
        // disconnect() sets _isAlive = false first, so clean shutdowns are silent.
        this.log.warn("Server disconnected");
      }
      this._isAlive = false;
    };

    this.transport.onerror = (err: Error) => {
      this.log.error({ error: err.message }, "Transport error");
    };

    await this.client.connect(this.transport);
    this._isAlive = true;
  }

  /**
   * Whether the server connection is currently alive.
   * Becomes false after disconnect() or when the transport closes (crash or network loss).
   */
  get isAlive(): boolean {
    return this._isAlive;
  }

  /**
   * List all tools exposed by this MCP server.
   */
  async listTools() {
    return this.client.listTools();
  }

  /**
   * Call a tool on this MCP server.
   */
  async callTool(name: string, args: Record<string, unknown>) {
    return this.client.callTool({ name, arguments: args });
  }

  /**
   * Disconnect from the MCP server cleanly.
   *
   * Sets isAlive = false BEFORE calling client.close() so the onclose handler
   * does not log a spurious "Server disconnected" warning during intentional shutdown.
   * The SDK handles SIGTERM -> SIGKILL lifecycle for stdio child processes.
   */
  async disconnect(): Promise<void> {
    this._isAlive = false; // Must be set BEFORE client.close() to silence onclose warning
    await this.client.close();
  }
}
