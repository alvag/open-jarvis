#!/usr/bin/env node

/**
 * Standalone CLI for authenticating with OpenAI Codex via ChatGPT OAuth.
 * Usage:
 *   npm run auth:codex            — run full OAuth flow
 *   npm run auth:codex -- --status — check token status
 *   npm run auth:codex -- --logout — delete stored tokens
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import {
  generatePKCE,
  generateState,
  buildAuthorizationURL,
  exchangeCode,
  decodeAccountId,
  REDIRECT_URI,
} from "./codex-oauth.js";
import { loadTokens, saveTokens, deleteTokens, tokensExist } from "./codex-token-store.js";

const PORT = 1455;
const TIMEOUT_MS = 120_000;

function showStatus(): void {
  const tokens = loadTokens();
  if (!tokens) {
    console.log("❌ No Codex tokens found.");
    console.log("   Run: npm run auth:codex");
    return;
  }

  const expiresAt = new Date(tokens.expires);
  const expired = tokens.expires < Date.now();
  const accountId = (() => {
    try { return decodeAccountId(tokens.access); } catch { return "unknown"; }
  })();

  console.log("✅ Codex tokens found");
  console.log(`   Account ID: ${accountId}`);
  console.log(`   Expires: ${expiresAt.toLocaleString()}${expired ? " (EXPIRED — will auto-refresh)" : ""}`);
}

function logout(): void {
  if (!tokensExist()) {
    console.log("No tokens to delete.");
    return;
  }
  deleteTokens();
  console.log("✅ Codex tokens deleted.");
}

async function runOAuthFlow(): Promise<void> {
  console.log("🔐 Starting OpenAI Codex OAuth flow...\n");

  const { verifier, challenge } = generatePKCE();
  const state = generateState();
  const authURL = buildAuthorizationURL(state, challenge);

  // Promise that resolves when we receive the callback
  let resolveCode: (code: string) => void;
  let rejectCode: (err: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (url.pathname !== "/auth/callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const receivedState = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<html><body><h2>Authentication failed</h2><p>${error}</p></body></html>`);
      rejectCode(new Error(`OAuth error: ${error}`));
      return;
    }

    if (receivedState !== state) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Invalid state parameter</h2></body></html>");
      rejectCode(new Error("State mismatch — possible CSRF attack"));
      return;
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Missing authorization code</h2></body></html>");
      rejectCode(new Error("No authorization code received"));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<html><body style=\"font-family:system-ui;text-align:center;padding:60px\">" +
      "<h2>✅ Authentication successful!</h2>" +
      "<p>You can close this tab and return to the terminal.</p>" +
      "</body></html>",
    );
    resolveCode(code);
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Callback server listening on http://127.0.0.1:${PORT}`);
    console.log(`\nOpening browser...\n`);
    console.log(`If the browser doesn't open, visit this URL manually:\n${authURL}\n`);

    // Open browser (macOS)
    spawn("open", [authURL], { stdio: "ignore" }).unref();
  });

  // Timeout
  const timeout = setTimeout(() => {
    rejectCode(new Error("Timed out waiting for OAuth callback (120s)"));
  }, TIMEOUT_MS);

  try {
    const code = await codePromise;
    clearTimeout(timeout);

    console.log("Exchanging authorization code for tokens...");
    const tokens = await exchangeCode(code, verifier);
    saveTokens(tokens);

    const accountId = decodeAccountId(tokens.access);
    console.log(`\n✅ Authentication successful!`);
    console.log(`   Account ID: ${accountId}`);
    console.log(`   Token expires: ${new Date(tokens.expires).toLocaleString()}`);
    console.log(`\nSet LLM_PROVIDER=codex in your .env to use Codex models.`);
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}

// --- Main ---

const args = process.argv.slice(2);

if (args.includes("--status")) {
  showStatus();
} else if (args.includes("--logout")) {
  logout();
} else {
  runOAuthFlow().catch((err) => {
    console.error(`\n❌ Authentication failed: ${(err as Error).message}`);
    process.exit(1);
  });
}
