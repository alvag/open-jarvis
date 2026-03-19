import { tavily } from "@tavily/core";
import type { Tool, ToolResult } from "../tool-types.js";
import { config } from "../../config.js";

// Lazy-init: only create client when actually called (avoids crash if API key missing)
let client: ReturnType<typeof tavily> | null = null;
function getClient() {
  if (!client) {
    client = tavily({ apiKey: config.tavily.apiKey });
  }
  return client;
}

const webSearchTool: Tool = {
  definition: {
    name: "web_search",
    description:
      "Search the web for current information. Returns a synthesized summary with source links. Use 'advanced' depth for research questions requiring multiple sources.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
        depth: {
          type: "string",
          description:
            "Search depth: 'basic' for quick facts, 'advanced' for deeper research requiring multiple sources",
          enum: ["basic", "advanced"],
        },
      },
      required: ["query"],
    },
  },

  async execute(args): Promise<ToolResult> {
    const query = args.query as string;
    const depth = (args.depth as "basic" | "advanced") || "basic";

    try {
      const response = await getClient().search(query, {
        maxResults: 5,
        searchDepth: depth,
        includeAnswer: false,
      });

      const results = response.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: `[WEB CONTENT - UNTRUSTED]\nSource: ${r.url}\n\n${r.content}\n[/WEB CONTENT]`,
        score: r.score,
        publishedDate: r.publishedDate,
      }));

      return { success: true, data: { query, results } };
    } catch (err) {
      return { success: false, data: null, error: (err as Error).message };
    }
  },
};

export default webSearchTool;
