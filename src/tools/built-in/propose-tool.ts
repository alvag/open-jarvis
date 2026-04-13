import type { Tool, ToolResult } from "../tool-types.js";

const TOOL_TEMPLATE = `import type { Tool, ToolResult } from "../tool-types.js";

export function {{factoryName}}(): Tool {
  return {
    definition: {
      name: "{{tool_name}}",
      description: "{{description}}",
      parameters: {
        type: "object",
        properties: {
          // Define parameters here
        },
        required: [],
      },
    },

    async execute(args, context): Promise<ToolResult> {
      // Implementation here
      return { success: true, data: {} };
    },
  };
}
`;

const EXAMPLE_TOOL = `// Example: get-current-time.ts
import type { Tool, ToolResult } from "../tool-types.js";

export function createGetCurrentTimeTool(): Tool {
  return {
    definition: {
      name: "get_current_time",
      description: "Returns the current date and time in the specified timezone",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "IANA timezone string, e.g. 'America/New_York'. Defaults to system timezone.",
          },
        },
      },
    },

    async execute(args): Promise<ToolResult> {
      const tz = (args.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const now = new Date().toLocaleString("en-US", {
        timeZone: tz,
        dateStyle: "full",
        timeStyle: "long",
      });
      return { success: true, data: { time: now, timezone: tz } };
    },
  };
}
`;

export function createProposeToolTool(): Tool {
  return {
    definition: {
    name: "propose_tool",
    description:
      "Generate a complete TypeScript tool implementation based on a description. Returns the code for the user to review. Use this when the user asks for a new ability or skill that doesn't exist yet.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Snake_case name for the tool, e.g. 'web_search', 'get_weather', 'read_sheet'",
        },
        description: {
          type: "string",
          description: "What the tool does — this becomes the tool's description for the LLM",
        },
        implementation_plan: {
          type: "string",
          description:
            "Detailed plan for the implementation: what parameters it needs, what APIs/libraries to use, what it returns, and any dependencies required (npm packages, API keys, CLI tools)",
        },
      },
      required: ["name", "description", "implementation_plan"],
    },
  },

  async execute(args): Promise<ToolResult> {
    const name = args.name as string;
    const description = args.description as string;
    const plan = args.implementation_plan as string;

    const varName = name
      .split("_")
      .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
      .join("");

    const factoryName = "create" + name
      .split("_")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join("") + "Tool";

    const fileName = name.replace(/_/g, "-") + ".ts";

    const proposal = [
      `## Proposed Tool: \`${name}\``,
      "",
      `**File:** \`src/tools/built-in/${fileName}\``,
      "",
      `**Description:** ${description}`,
      "",
      `### Implementation Plan`,
      plan,
      "",
      `### Template`,
      "```typescript",
      TOOL_TEMPLATE.replace(/\{\{factoryName\}\}/g, factoryName)
        .replace("{{tool_name}}", name)
        .replace("{{description}}", description),
      "```",
      "",
      `### Example (existing tool for reference)`,
      "```typescript",
      EXAMPLE_TOOL,
      "```",
      "",
      `### Registration`,
      "To activate this tool, add to \`src/index.ts\`:",
      "```typescript",
      `import { ${factoryName} } from "./tools/built-in/${fileName.replace(".ts", ".js")}";`,
      `toolRegistry.register(${factoryName}());`,
      "```",
    ].join("\n");

    return {
      success: true,
      data: {
        tool_name: name,
        file_name: fileName,
        proposal,
      },
    };
  },
  };
}
