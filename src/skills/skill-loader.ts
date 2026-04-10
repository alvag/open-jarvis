import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../logger.js";

const log = createLogger("skills");

export interface Skill {
  name: string;
  tools: string[];
  triggers: string[];
  content: string;
}

const SKILLS_DIR = "./skills";

let cachedSkills: Skill[] | null = null;

/** Parse simple YAML-like frontmatter from a skill markdown file. */
function parseFrontmatter(raw: string): { meta: Record<string, string[]>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string[]> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*\[(.+)]$/);
    if (kv) {
      meta[kv[1]] = kv[2].split(",").map((s) => s.trim());
    }
    const simple = line.match(/^(\w+):\s*(.+)$/);
    if (simple && !kv) {
      meta[simple[1]] = [simple[2].trim()];
    }
  }
  return { meta, body: match[2].trim() };
}

/** Load all skill files from the skills/ directory. Cached after first call. */
export function loadAllSkills(): Skill[] {
  if (cachedSkills) return cachedSkills;

  try {
    const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));
    cachedSkills = files.map((file) => {
      const raw = readFileSync(join(SKILLS_DIR, file), "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      return {
        name: meta.name?.[0] ?? file.replace(".md", ""),
        tools: meta.tools ?? [],
        triggers: (meta.triggers ?? []).map((t) => t.toLowerCase()),
        content: body,
      };
    });
    log.info({ count: cachedSkills.length }, `Loaded ${cachedSkills.length} skills`);
    return cachedSkills;
  } catch {
    cachedSkills = [];
    return cachedSkills;
  }
}

/** Match skills whose triggers appear in the user message. */
export function matchByMessage(message: string): Skill[] {
  const lower = message.toLowerCase();
  return loadAllSkills().filter((skill) =>
    skill.triggers.some((trigger) => lower.includes(trigger)),
  );
}

/** Match skills associated with a tool name. */
export function matchByTool(toolName: string): Skill[] {
  return loadAllSkills().filter((skill) => skill.tools.includes(toolName));
}
