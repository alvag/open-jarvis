import { describe, test } from "node:test";

describe("PR monitor", () => {
  describe("SCHED-04: PR change detection", () => {
    test.todo("first sight of a PR inserts baseline into pr_states without notification");
    test.todo("detects state change (e.g., OPEN -> MERGED) and sends notification");
    test.todo("detects new commits and includes count in notification");
    test.todo("detects direct mention in comment and includes in notification");
    test.todo("updates pr_states BEFORE sending notification (no duplicates)");
    test.todo("errors in PR check are caught and logged, not thrown");
    test.todo("PR monitor task is seeded on first startup with correct interval");
  });

  describe("SCHED-05: auto code review for reviewer", () => {
    test.todo("first sight of PR where user is reviewer triggers runAgent with review prompt");
    test.todo("first sight of PR where user is only author does NOT trigger review, stores baseline");
    test.todo("known PR where user was not reviewer but is added as reviewer triggers review");
    test.todo("known PR where user is reviewer and new commits pushed triggers re-review with isRereview=true");
    test.todo("known PR where user is reviewer without new commits does NOT re-review");
    test.todo("known PR where user was removed as reviewer updates participant_states without review");
    test.todo("closed (MERGED/DECLINED) PR transition notifies state change without review");
    test.todo("pr_states persists reviewers, last_reviewed_on and my_comment_ids as typed JSON");
    test.todo("review state is persisted BEFORE runAgent call to prevent duplicate reviews on crash");
  });

  describe("SCHED-06: reply detection on comments", () => {
    test.todo("new comment whose parent.id is in my_comment_ids from a different author triggers reply notification");
    test.todo("new comment without parent is not counted as reply");
    test.todo("new comment whose parent.id is mine but author is me is not counted as reply");
    test.todo("reply notification includes count and author display names");
    test.todo("getPRComments is only called when activity contains comment items");
    test.todo("my_comment_ids is recomputed from fetched comments after each run");
  });
});
