/**
 * Approval gate — async pause/resume for risky command execution.
 *
 * Architecture:
 *   1. request() writes pending approval to SQLite FIRST (survives restart)
 *   2. request() returns a Promise that resolves when handleCallback() is called
 *   3. A 5-minute setTimeout auto-expires the request if no response arrives
 *   4. On bot restart, recoverPendingOnStartup() marks stale rows as expired
 *      and notifies the user so they can re-request
 *
 * The in-memory `resolvers` Map holds Promise resolve functions keyed by
 * approval ID. SQLite is the source of truth; the Map is just the async handle.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { createLogger } from "../logger.js";

const log = createLogger("approval-gate");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  /** The executable or script to run. */
  command: string;
  /** Arguments for the command. */
  args: string[];
  /** Working directory for the command. */
  cwd: string;
  /** Human-readable risk reason shown to the user. */
  reason: string;
  /** Telegram user ID who owns this request. */
  userId: string;
  /**
   * Callback invoked to send the approval message to the user.
   * The gate passes: the formatted message text and the unique approval ID
   * (so the caller can construct the inline keyboard with approve:id / deny:id).
   */
  sendApproval: (text: string, approvalId: string) => Promise<void>;
}

export interface ApprovalGate {
  /**
   * Request approval for a risky command.
   * Writes to SQLite immediately, then awaits user response.
   * Resolves to true (approved) or false (denied / expired).
   */
  request(params: ApprovalRequest): Promise<boolean>;

  /**
   * Called by the Telegram callback_query handler when the user taps
   * Approve or Deny. Resolves the in-memory Promise if it still exists
   * (normal flow), or just updates SQLite (post-restart flow).
   */
  handleCallback(id: string, approved: boolean): void;

  /**
   * Called once at startup. Scans for pending approval rows in SQLite
   * that were not resolved before the last restart, marks them expired,
   * and notifies the user so they know to re-request the command.
   */
  recoverPendingOnStartup(
    notify: (userId: string, message: string) => Promise<void>,
  ): void;
}

// ---------------------------------------------------------------------------
// Internal row type (matches the pending_approvals SQLite schema)
// ---------------------------------------------------------------------------

interface PendingApprovalRow {
  id: string;
  user_id: string;
  command: string;
  args: string;
  cwd: string;
  reason: string;
  status: string;
  created_at: string;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// Module-level resolver Map
// ---------------------------------------------------------------------------

/**
 * In-memory map from approval ID → Promise resolve function.
 * Populated in request(), consumed in handleCallback() or the timeout.
 * Intentionally module-level so it survives multiple createApprovalGate calls
 * (though in practice only one gate is created per process).
 */
const resolvers = new Map<string, (approved: boolean) => void>();

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createApprovalGate(db: Database.Database): ApprovalGate {
  // Prepared statements — created once, reused for performance
  const insertApproval = db.prepare<[string, string, string, string, string, string, string]>(`
    INSERT INTO pending_approvals (id, user_id, command, args, cwd, reason, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `);

  const updateStatus = db.prepare<[string, string]>(`
    UPDATE pending_approvals SET status = ? WHERE id = ?
  `);

  const selectPending = db.prepare<[]>(`
    SELECT * FROM pending_approvals WHERE status = 'pending'
  `);

  return {
    async request(params: ApprovalRequest): Promise<boolean> {
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      // Write to SQLite FIRST — ensures persistence before awaiting user response
      insertApproval.run(
        id,
        params.userId,
        params.command,
        JSON.stringify(params.args),
        params.cwd,
        params.reason,
        expiresAt,
      );

      log.info({ id, command: params.command, userId: params.userId, expiresAt }, "Approval request created");

      // Build and send the approval message
      const commandDisplay = [params.command, ...params.args].join(" ");
      const expiryTime = new Date(expiresAt).toLocaleTimeString();
      const message = [
        "Jarvis wants to execute a command:",
        `\`${commandDisplay}\``,
        `Working directory: \`${params.cwd}\``,
        `Risk reason: ${params.reason}`,
        `Expires at: ${expiryTime}`,
      ].join("\n");

      await params.sendApproval(message, id);

      // Return a Promise that resolves when the user responds or the timer fires
      return new Promise<boolean>((resolve) => {
        resolvers.set(id, resolve);

        // Auto-expire after 5 minutes
        const timeoutHandle = setTimeout(() => {
          if (resolvers.has(id)) {
            resolvers.delete(id);
            updateStatus.run("expired", id);
            log.info({ id, command: params.command, userId: params.userId }, "Approval request expired");
            resolve(false);
          }
        }, 5 * 60 * 1000);

        // Avoid keeping the Node.js process alive for the timeout alone
        if (timeoutHandle.unref) {
          timeoutHandle.unref();
        }
      });
    },

    handleCallback(id: string, approved: boolean): void {
      const resolver = resolvers.get(id);

      if (resolver) {
        // Normal flow — Promise is still waiting
        resolvers.delete(id);
        updateStatus.run(approved ? "approved" : "denied", id);
        log.info({ id, approved }, "Approval callback handled");
        resolver(approved);
      } else {
        // Post-restart flow — no in-memory Promise exists; just update SQLite
        updateStatus.run(approved ? "approved" : "denied", id);
        log.warn({ id, approved }, "Callback received but no resolver found (post-restart?)");
      }
    },

    recoverPendingOnStartup(
      notify: (userId: string, message: string) => Promise<void>,
    ): void {
      const staleRows = selectPending.all() as PendingApprovalRow[];

      if (staleRows.length === 0) {
        return;
      }

      log.info({ count: staleRows.length }, "Recovering stale pending approvals on startup");

      for (const row of staleRows) {
        // Mark old approval as expired synchronously
        updateStatus.run("expired", row.id);

        // Parse stored args back to array for display
        let parsedArgs: string[] = [];
        try {
          parsedArgs = JSON.parse(row.args) as string[];
        } catch {
          parsedArgs = [];
        }

        const commandDisplay = [row.command, ...parsedArgs].join(" ");
        const message = [
          "A pending command approval expired during bot restart:",
          `\`${commandDisplay}\``,
          "Please re-request the command if you still need it to run.",
        ].join("\n");

        // Fire-and-forget notify — errors are non-fatal during startup
        notify(row.user_id, message).catch((err: unknown) => {
          log.warn({ userId: row.user_id, id: row.id, error: (err as Error).message }, "Failed to notify user of expired approval");
        });
      }

      log.info({ count: staleRows.length }, "Finished recovering stale approvals");
    },
  };
}
