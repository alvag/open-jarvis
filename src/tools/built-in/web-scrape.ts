import Firecrawl from "@mendable/firecrawl-js";
import type { Tool, ToolResult } from "../tool-types.js";
import { config } from "../../config.js";

const MAX_CONTENT_CHARS = 8000; // ~2,000 tokens — prevents LLM context saturation

// Lazy-init: only create client when actually called (avoids crash if API key missing)
let firecrawl: Firecrawl | null = null;
function getFirecrawl() {
  if (!firecrawl) {
    firecrawl = new Firecrawl({ apiKey: config.firecrawl.apiKey });
  }
  return firecrawl;
}

const webScrapeTool: Tool = {
  definition: {
    name: "web_scrape",
    description:
      "Extract the text content of a web page as clean markdown. Handles JavaScript-rendered pages (SPAs, React, etc.). Use this when the user sends a URL or when web_search results need deeper reading.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to scrape (must start with http:// or https://)",
        },
      },
      required: ["url"],
    },
  },

  async execute(args): Promise<ToolResult> {
    const url = args.url as string;

    try {
      const result = await getFirecrawl().scrape(url, {
        formats: ["markdown"],
        onlyMainContent: true,
        removeBase64Images: true,
        timeout: 30000, // 30s — prevents agent loop hang on slow/hanging servers
      });

      if (!result.markdown) {
        return {
          success: false,
          data: null,
          error:
            "No content could be extracted from the page. It may be paywalled, require authentication, or return no readable content.",
        };
      }

      let content = result.markdown;
      let truncated = false;

      if (content.length > MAX_CONTENT_CHARS) {
        // Truncate at last paragraph boundary before limit to avoid mid-sentence cuts
        const slice = content.slice(0, MAX_CONTENT_CHARS);
        const lastParagraph = slice.lastIndexOf("\n\n");
        content = lastParagraph > MAX_CONTENT_CHARS * 0.8
          ? slice.slice(0, lastParagraph)
          : slice;
        truncated = true;
      }

      const truncationNotice = truncated
        ? `\n\n[Content truncated at ${MAX_CONTENT_CHARS} characters. Full page available at: ${url}]`
        : "";

      const wrappedContent = `[WEB CONTENT - UNTRUSTED]\nSource: ${url}\n\n${content}${truncationNotice}\n[/WEB CONTENT]`;

      return {
        success: true,
        data: {
          url,
          title: result.metadata?.title || "",
          content: wrappedContent,
          truncated,
        },
      };
    } catch (err) {
      const message = (err as Error).message;
      const friendly = message.includes("timeout")
        ? "Page took too long to load (timeout after 30s)"
        : message.includes("402") || message.includes("payment")
        ? "This page requires payment or subscription to access"
        : message.includes("403") || message.includes("blocked")
        ? "Access to this page was blocked (CAPTCHA or anti-bot protection)"
        : message;
      return { success: false, data: null, error: friendly };
    }
  },
};

export default webScrapeTool;
