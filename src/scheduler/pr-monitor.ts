import type Database from "better-sqlite3";
import {
  BitbucketClient,
  type BitbucketPR,
  type BitbucketActivityItem,
} from "../tools/bitbucket-api.js";
import { config } from "../config.js";
import { log } from "../logger.js";

interface PrStateRow {
  pr_id: number;
  workspace: string;
  repo_slug: string;
  last_updated_on: string;
  last_state: string;
  last_commit_hash: string | null;
  participant_states: string;
  checked_at: string;
}

function getUserNickname(): string {
  return config.bitbucket.email.split("@")[0];
}

function isPrRelevantToUser(pr: BitbucketPR): boolean {
  const nickname = getUserNickname();
  const isAuthor = pr.author.nickname === nickname;
  const isReviewer = pr.reviewers.some((r) => r.nickname === nickname);
  return isAuthor || isReviewer;
}

function buildNotification(
  pr: BitbucketPR,
  known: PrStateRow,
  activity: BitbucketActivityItem[],
): string | null {
  const nickname = getUserNickname();
  const changes: string[] = [];

  // Detect state changes
  if (pr.state !== known.last_state) {
    changes.push(`Estado: ${known.last_state} -> ${pr.state}`);
  }

  // Detect new commits (update items where state matches current state = commit push, not state change)
  const commitUpdates = activity.filter(
    (item) => item.update && item.update.state === pr.state && pr.state === known.last_state,
  );
  if (commitUpdates.length > 0) {
    const authors = [
      ...new Set(commitUpdates.map((item) => item.update!.author.display_name)),
    ];
    changes.push(
      `${commitUpdates.length} nuevo${commitUpdates.length > 1 ? "s" : ""} commit${commitUpdates.length > 1 ? "s" : ""} por ${authors.join(", ")}`,
    );
  }

  // Detect direct mentions in comments
  const mentionPattern = `@${nickname}`;
  const mentionItems = activity.filter(
    (item) =>
      item.comment &&
      item.comment.content.raw.includes(mentionPattern),
  );
  if (mentionItems.length > 0) {
    changes.push(`Te mencionaron en ${mentionItems.length} comentario${mentionItems.length > 1 ? "s" : ""}`);
  }

  // Detect approvals
  const approvals = activity.filter((item) => item.approval);
  if (approvals.length > 0) {
    const approvers = approvals.map((item) => item.approval!.user.display_name);
    changes.push(`Aprobado por: ${approvers.join(", ")}`);
  }

  if (changes.length === 0) {
    return null;
  }

  return [
    `\u{1F500} PR #${pr.id} "${pr.title}":`,
    ...changes.map((c) => `  - ${c}`),
    pr.links.html.href,
  ].join("\n");
}

export async function checkPRChanges(
  db: Database.Database,
  sendMessage: (userId: string, text: string) => Promise<void>,
  userId: string,
): Promise<void> {
  try {
    const client = new BitbucketClient();

    const selectPrState = db.prepare<[number], PrStateRow>(
      "SELECT * FROM pr_states WHERE pr_id = ?",
    );
    const upsertPrState = db.prepare(`
      INSERT INTO pr_states (pr_id, workspace, repo_slug, last_updated_on, last_state, last_commit_hash, participant_states, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(pr_id) DO UPDATE SET
        last_updated_on = excluded.last_updated_on,
        last_state = excluded.last_state,
        last_commit_hash = excluded.last_commit_hash,
        participant_states = excluded.participant_states,
        checked_at = datetime('now')
    `);

    let prsChecked = 0;

    // Check open PRs
    const openResult = await client.listPRs(undefined, undefined, "OPEN");
    const relevantOpenPrs = openResult.values.filter(isPrRelevantToUser);

    for (const pr of relevantOpenPrs) {
      prsChecked++;
      const known = selectPrState.get(pr.id) as PrStateRow | undefined;
      const workspace = config.bitbucket.defaultWorkspace;
      const repoSlug = config.bitbucket.defaultRepoSlug;

      if (!known) {
        // First time seeing this PR — store baseline, don't notify
        upsertPrState.run(
          pr.id,
          workspace,
          repoSlug,
          pr.updated_on,
          pr.state,
          null,
          "{}",
        );
        continue;
      }

      if (pr.updated_on !== known.last_updated_on) {
        // Fetch activity to analyze what changed
        const activityResult = await client.getPRActivity(String(pr.id));

        // Update pr_states BEFORE sending notification (prevents duplicates on crash)
        upsertPrState.run(
          pr.id,
          workspace,
          repoSlug,
          pr.updated_on,
          pr.state,
          null,
          known.participant_states,
        );

        const notification = buildNotification(pr, known, activityResult.values);
        if (notification) {
          await sendMessage(userId, notification);
        }
      }
    }

    // Check recently merged/declined PRs we were tracking
    const mergedResult = await client.listPRs(undefined, undefined, "MERGED");
    for (const pr of mergedResult.values.filter(isPrRelevantToUser)) {
      prsChecked++;
      const known = selectPrState.get(pr.id) as PrStateRow | undefined;
      if (!known) continue;

      if (pr.state !== known.last_state) {
        const workspace = config.bitbucket.defaultWorkspace;
        const repoSlug = config.bitbucket.defaultRepoSlug;

        // Update pr_states BEFORE sending notification
        upsertPrState.run(
          pr.id,
          workspace,
          repoSlug,
          pr.updated_on,
          pr.state,
          null,
          known.participant_states,
        );

        const notification = [
          `\u{1F500} PR #${pr.id} "${pr.title}":`,
          `  - Estado: ${known.last_state} -> ${pr.state}`,
          pr.links.html.href,
        ].join("\n");
        await sendMessage(userId, notification);
      }
    }

    log("info", "pr-monitor", "PR check complete", { prsChecked });
  } catch (err) {
    log("error", "pr-monitor", "PR check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Do NOT re-throw — PR monitor failures should not crash the scheduler
  }
}
