import { readFileSync, writeFileSync, renameSync, unlinkSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export interface CodexTokens {
  access: string;
  refresh: string;
  expires: number; // epoch ms
}

const TOKEN_PATH = join("data", "codex-tokens.json");

export function loadTokens(): CodexTokens | null {
  try {
    const raw = readFileSync(TOKEN_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.access || !parsed.refresh || typeof parsed.expires !== "number") {
      return null;
    }
    return parsed as CodexTokens;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: CodexTokens): void {
  const dir = dirname(TOKEN_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = TOKEN_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(tokens, null, 2), "utf-8");
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, TOKEN_PATH);
}

export function deleteTokens(): void {
  try {
    unlinkSync(TOKEN_PATH);
  } catch {
    // File doesn't exist — nothing to delete
  }
}

export function tokensExist(): boolean {
  return existsSync(TOKEN_PATH);
}
