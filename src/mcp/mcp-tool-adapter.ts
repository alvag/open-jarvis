/**
 * mcp-tool-adapter.ts — Converts MCP tool definitions into Tool objects
 * compatible with the existing ToolRegistry.
 *
 * After adaptation, MCP tools are indistinguishable from built-in tools in the
 * agent loop. Each tool is namespaced as `serverName__toolName` (double
 * underscore) to prevent collisions across MCP servers and with built-ins.
 */

import type { Tool, ToolResult, JsonSchema } from "../tools/tool-types.js";
import type { McpClient } from "./mcp-client.js";

/** Shape of a single tool returned by McpClient.listTools() */
type McpToolDef = Awaited<ReturnType<McpClient["listTools"]>>["tools"][number];

/** Normalized MCP content item (text variant) */
type McpContentItem = { type: string; text?: string; [key: string]: unknown };

/** Shape of the result from McpClient.callTool() — cast from SDK's loose types */
type McpCallToolResult = {
  content: McpContentItem[];
  isError?: boolean;
};

/**
 * Convert a list of MCP tool definitions into Tool objects for the ToolRegistry.
 *
 * @param tools      Raw tool definitions from McpClient.listTools()
 * @param client     The McpClient instance to route callTool() calls through
 * @param serverName Server name from McpServerConfig — used for namespacing
 * @returns          Array of adapted Tool objects ready for ToolRegistry.register()
 */
export function adaptMcpTools(
  tools: McpToolDef[],
  client: McpClient,
  serverName: string,
): Tool[] {
  return tools.map((mcpTool) => {
    // MCP-04: Prefix with serverName__toolName (double underscore separator)
    const prefixedName = `${serverName}__${mcpTool.name}`;

    const tool: Tool = {
      definition: {
        name: prefixedName,
        description:
          mcpTool.description ?? `MCP tool ${mcpTool.name} from ${serverName}`,
        // Cast required: MCP inputSchema.properties is Record<string, object>
        // while project JsonSchema.properties is Record<string, {type, description, enum?}>
        // They are compatible at runtime for LLM consumption (Pitfall 2 from RESEARCH.md)
        // Also handle tools with no properties field (Pitfall 5 from RESEARCH.md)
        parameters: {
          ...mcpTool.inputSchema,
          properties: mcpTool.inputSchema.properties ?? {},
        } as unknown as JsonSchema,
      },

      async execute(
        args: Record<string, unknown>,
        _context,
      ): Promise<ToolResult> {
        // Dead server guard — return structured error without crashing agent loop
        if (!client.isAlive) {
          return {
            success: false,
            data: null,
            error: `MCP server '${serverName}' is not available (disconnected)`,
          };
        }

        try {
          // IMPORTANT: Use ORIGINAL tool name (not prefixed) — the MCP server
          // does not know about the prefix we added for the ToolRegistry namespace.
          // Cast to McpCallToolResult: SDK types content as unknown for flexibility,
          // but the MCP spec guarantees content is an array of content items.
          const result = await client.callTool(
            mcpTool.name,
            args,
          ) as unknown as McpCallToolResult;

          // Check server-side error flag
          if (result.isError) {
            const errText =
              result.content
                .filter(
                  (c): c is { type: "text"; text: string } =>
                    c.type === "text",
                )
                .map((c) => c.text)
                .join(" ") || "Tool reported error";
            return {
              success: false,
              data: null,
              error: `MCP server '${serverName}' error: ${errText}`,
            };
          }

          // Success path: extract text from first text content item
          const textItem = result.content.find(
            (c): c is { type: "text"; text: string } => c.type === "text",
          );
          return {
            success: true,
            data: textItem?.text ?? result.content,
          };
        } catch (err) {
          // Never throw — return structured error to keep agent loop alive
          return {
            success: false,
            data: null,
            error: `MCP server '${serverName}' error: ${(err as Error).message}`,
          };
        }
      },
    };

    return tool;
  });
}
