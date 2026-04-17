import type Database from "better-sqlite3";
import {
  BitbucketClient,
  type BitbucketPR,
  type BitbucketComment,
  type BitbucketActivityItem,
} from "../tools/bitbucket-api.js";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { buildBitbucketPrReviewPrompt } from "./pr-review-prompt.js";
import type { SchedulerDeps } from "./types.js";

const log = createLogger("pr-monitor");

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

interface ParticipantStates {
  reviewers: string[];
  last_reviewed_on: string | null;
  my_comment_ids: number[];
}

export type PrMonitorAgentDeps = Pick<
  SchedulerDeps,
  "runAgent" | "llm" | "toolRegistry" | "memoryManager" | "soul" | "maxIterations"
>;

const EMPTY_PARTICIPANT_STATES: ParticipantStates = {
  reviewers: [],
  last_reviewed_on: null,
  my_comment_ids: [],
};

function getUserNickname(): string {
  return config.bitbucket.email.split("@")[0];
}

function isPrRelevantToUser(pr: BitbucketPR): boolean {
  const nickname = getUserNickname();
  const isAuthor = pr.author.nickname === nickname;
  const isReviewer = pr.reviewers?.some((r) => r.nickname === nickname) ?? false;
  return isAuthor || isReviewer;
}

function userIsReviewer(pr: BitbucketPR): boolean {
  const nickname = getUserNickname();
  return pr.reviewers?.some((r) => r.nickname === nickname) ?? false;
}

function parseParticipantStates(raw: string | null | undefined): ParticipantStates {
  if (!raw) return { ...EMPTY_PARTICIPANT_STATES };
  try {
    const parsed = JSON.parse(raw) as Partial<ParticipantStates>;
    return {
      reviewers: Array.isArray(parsed.reviewers) ? parsed.reviewers : [],
      last_reviewed_on: typeof parsed.last_reviewed_on === "string" ? parsed.last_reviewed_on : null,
      my_comment_ids: Array.isArray(parsed.my_comment_ids) ? parsed.my_comment_ids : [],
    };
  } catch {
    return { ...EMPTY_PARTICIPANT_STATES };
  }
}

function isCommitUpdate(item: BitbucketActivityItem, currentState: string, prevState: string): boolean {
  return Boolean(item.update && item.update.state === currentState && currentState === prevState);
}

function buildNotification(
  pr: BitbucketPR,
  known: PrStateRow,
  activity: BitbucketActivityItem[],
  replies: BitbucketComment[],
): string | null {
  const nickname = getUserNickname();
  const changes: string[] = [];

  if (pr.state !== known.last_state) {
    changes.push(`Estado: ${known.last_state} -> ${pr.state}`);
  }

  const commitUpdates = activity.filter((item) => isCommitUpdate(item, pr.state, known.last_state));
  if (commitUpdates.length > 0) {
    const authors = [
      ...new Set(commitUpdates.map((item) => item.update!.author.display_name)),
    ];
    changes.push(
      `${commitUpdates.length} nuevo${commitUpdates.length > 1 ? "s" : ""} commit${commitUpdates.length > 1 ? "s" : ""} por ${authors.join(", ")}`,
    );
  }

  const mentionPattern = `@${nickname}`;
  const mentionItems = activity.filter(
    (item) => item.comment && item.comment.content.raw.includes(mentionPattern),
  );
  if (mentionItems.length > 0) {
    changes.push(`Te mencionaron en ${mentionItems.length} comentario${mentionItems.length > 1 ? "s" : ""}`);
  }

  if (replies.length > 0) {
    const authors = [...new Set(replies.map((r) => r.user.display_name))];
    changes.push(
      `\u{1F4AC} ${replies.length} respuesta${replies.length > 1 ? "s" : ""} a tus comentarios por ${authors.join(", ")}`,
    );
  }

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

async function runPrReview(
  pr: BitbucketPR,
  isRereview: boolean,
  client: BitbucketClient,
  userId: string,
  agentDeps: PrMonitorAgentDeps,
  sendMessage: (userId: string, text: string) => Promise<void>,
): Promise<void> {
  const diff = await client.getPRDiff(String(pr.id));
  const prompt = buildBitbucketPrReviewPrompt(pr, diff, isRereview);
  const sessionId = agentDeps.memoryManager.resolveSession(userId, "scheduler", 0);

  log.info({ prId: pr.id, isRereview, diffChars: diff.length }, "Triggering PR code review");

  const result = await agentDeps.runAgent(
    {
      userId,
      userName: "scheduler",
      channelId: "scheduler",
      sessionId,
      userMessage: prompt,
      preApproved: true,
    },
    agentDeps.llm,
    agentDeps.toolRegistry,
    agentDeps.memoryManager,
    agentDeps.soul,
    agentDeps.maxIterations,
  );

  // The scheduler path does not auto-deliver AgentResponse.text — we forward it explicitly.
  const reviewText = result?.text?.trim();
  if (reviewText) {
    await sendMessage(userId, reviewText);
  } else {
    log.warn({ prId: pr.id }, "PR review produced no text to send");
  }
}

interface ReplyDetection {
  replies: BitbucketComment[];
  nextMyCommentIds: number[];
}

async function detectReplies(
  pr: BitbucketPR,
  known: PrStateRow,
  prev: ParticipantStates,
  nickname: string,
  client: BitbucketClient,
): Promise<ReplyDetection> {
  try {
    const comments = (await client.getPRComments(String(pr.id))).values;
    const myIdsFromPage = comments
      .filter((c) => c.user.nickname === nickname)
      .map((c) => c.id);
    // Merge with previous to survive pagination (getPRComments returns only first page).
    const nextMyCommentIds = [
      ...new Set([...prev.my_comment_ids, ...myIdsFromPage]),
    ];
    const replies = comments.filter(
      (c) =>
        c.parent &&
        prev.my_comment_ids.includes(c.parent.id) &&
        c.user.nickname !== nickname &&
        c.created_on > known.last_updated_on,
    );
    return { replies, nextMyCommentIds };
  } catch (err) {
    log.warn(
      {
        prId: pr.id,
        error: err instanceof Error ? err.message : String(err),
      },
      "Failed to fetch PR comments for reply detection",
    );
    return { replies: [], nextMyCommentIds: prev.my_comment_ids };
  }
}

async function seedMyCommentIds(
  pr: BitbucketPR,
  nickname: string,
  client: BitbucketClient,
): Promise<number[]> {
  try {
    const comments = (await client.getPRComments(String(pr.id))).values;
    return comments
      .filter((c) => c.user.nickname === nickname)
      .map((c) => c.id);
  } catch (err) {
    log.warn(
      {
        prId: pr.id,
        error: err instanceof Error ? err.message : String(err),
      },
      "Failed to seed my_comment_ids on first sight",
    );
    return [];
  }
}

export async function checkPRChanges(
  db: Database.Database,
  sendMessage: (userId: string, text: string) => Promise<void>,
  userId: string,
  agentDeps: PrMonitorAgentDeps,
): Promise<void> {
  try {
    const client = new BitbucketClient();
    const nickname = getUserNickname();

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
    let reviewsTriggered = 0;

    const workspace = config.bitbucket.defaultWorkspace;
    const repoSlug = config.bitbucket.defaultRepoSlug;

    const openResult = await client.listPRs(undefined, undefined, "OPEN");
    const relevantOpenPrs = openResult.values.filter(isPrRelevantToUser);

    for (const pr of relevantOpenPrs) {
      prsChecked++;
      const known = selectPrState.get(pr.id) as PrStateRow | undefined;
      const prev = parseParticipantStates(known?.participant_states);
      const currentReviewers = (pr.reviewers ?? []).map((r) => r.nickname);
      const amReviewer = userIsReviewer(pr);

      const prIsNew = !known;
      const prUpdated = known ? pr.updated_on !== known.last_updated_on : false;

      const activity = prUpdated
        ? (await client.getPRActivity(String(pr.id))).values
        : [];

      const commitUpdates = activity.filter((item) =>
        isCommitUpdate(item, pr.state, known?.last_state ?? pr.state),
      );

      const isFirstTimeAsReviewer = prIsNew && amReviewer;
      const wasJustAddedAsReviewer =
        !prIsNew && amReviewer && !prev.reviewers.includes(nickname);
      const hasNewCommitsToReview =
        !prIsNew &&
        amReviewer &&
        commitUpdates.length > 0 &&
        prev.last_reviewed_on !== pr.updated_on;

      const doReview =
        isFirstTimeAsReviewer || wasJustAddedAsReviewer || hasNewCommitsToReview;

      // Detect replies BEFORE deciding review vs notification, so a single PR
      // update that contains BOTH a push and a reply to my comment does not
      // silently drop the reply (the review flow is for code, not conversation).
      const hasCommentActivity = activity.some((item) => item.comment);
      let replies: BitbucketComment[] = [];
      let nextMyCommentIds = prev.my_comment_ids;
      if (!prIsNew && hasCommentActivity) {
        const detection = await detectReplies(pr, known!, prev, nickname, client);
        replies = detection.replies;
        nextMyCommentIds = detection.nextMyCommentIds;
      } else if (prIsNew) {
        // First sight — seed my_comment_ids from any existing comments so
        // replies to my pre-existing comments can be detected on later polls.
        nextMyCommentIds = await seedMyCommentIds(pr, nickname, client);
      }

      if (doReview) {
        const isRereview = hasNewCommitsToReview && !wasJustAddedAsReviewer;

        // If replies exist in the same update, notify them separately before
        // the code review so the user still gets the conversational signal.
        if (replies.length > 0) {
          const authors = [...new Set(replies.map((r) => r.user.display_name))];
          const replyNote = [
            `\u{1F500} PR #${pr.id} "${pr.title}":`,
            `  - \u{1F4AC} ${replies.length} respuesta${replies.length > 1 ? "s" : ""} a tus comentarios por ${authors.join(", ")}`,
            pr.links.html.href,
          ].join("\n");
          await sendMessage(userId, replyNote);
        }

        // Persist state ONLY after the review succeeds. A transient failure
        // (LLM, network, diff fetch, sendMessage) leaves pr_states untouched,
        // so the next poll observes the same triggering conditions and retries.
        // The small cost is a possible duplicate review if the process crashes
        // between successful delivery and the DB write — preferable to
        // permanently dropping a review that was never delivered.
        try {
          await runPrReview(pr, isRereview, client, userId, agentDeps, sendMessage);
          reviewsTriggered++;

          const nextState: ParticipantStates = {
            reviewers: currentReviewers,
            last_reviewed_on: pr.updated_on,
            my_comment_ids: nextMyCommentIds,
          };
          upsertPrState.run(
            pr.id,
            workspace,
            repoSlug,
            pr.updated_on,
            pr.state,
            null,
            JSON.stringify(nextState),
          );
        } catch (err) {
          log.error(
            {
              prId: pr.id,
              error: err instanceof Error ? err.message : String(err),
            },
            "PR review failed — state not persisted, will retry on next poll",
          );
        }
        continue;
      }

      if (prIsNew) {
        const nextState: ParticipantStates = {
          reviewers: currentReviewers,
          last_reviewed_on: null,
          my_comment_ids: nextMyCommentIds,
        };
        upsertPrState.run(
          pr.id,
          workspace,
          repoSlug,
          pr.updated_on,
          pr.state,
          null,
          JSON.stringify(nextState),
        );
        continue;
      }

      if (!prUpdated) {
        continue;
      }

      const nextState: ParticipantStates = {
        reviewers: currentReviewers,
        last_reviewed_on: prev.last_reviewed_on,
        my_comment_ids: nextMyCommentIds,
      };

      // Update pr_states BEFORE sending notification (prevents duplicates on crash)
      upsertPrState.run(
        pr.id,
        workspace,
        repoSlug,
        pr.updated_on,
        pr.state,
        null,
        JSON.stringify(nextState),
      );

      const notification = buildNotification(pr, known!, activity, replies);
      if (notification) {
        await sendMessage(userId, notification);
      }
    }

    // Check recently merged/declined PRs we were tracking
    const mergedResult = await client.listPRs(undefined, undefined, "MERGED");
    for (const pr of mergedResult.values.filter(isPrRelevantToUser)) {
      prsChecked++;
      const known = selectPrState.get(pr.id) as PrStateRow | undefined;
      if (!known) continue;

      if (pr.state !== known.last_state) {
        const prev = parseParticipantStates(known.participant_states);
        const nextState: ParticipantStates = {
          reviewers: (pr.reviewers ?? []).map((r) => r.nickname),
          last_reviewed_on: prev.last_reviewed_on,
          my_comment_ids: prev.my_comment_ids,
        };

        upsertPrState.run(
          pr.id,
          workspace,
          repoSlug,
          pr.updated_on,
          pr.state,
          null,
          JSON.stringify(nextState),
        );

        const notification = [
          `\u{1F500} PR #${pr.id} "${pr.title}":`,
          `  - Estado: ${known.last_state} -> ${pr.state}`,
          pr.links.html.href,
        ].join("\n");
        await sendMessage(userId, notification);
      }
    }

    log.info({ prsChecked, reviewsTriggered }, "PR check complete");
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "PR check failed");
    // Do NOT re-throw — PR monitor failures should not crash the scheduler
  }
}
