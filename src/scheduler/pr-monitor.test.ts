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
});
