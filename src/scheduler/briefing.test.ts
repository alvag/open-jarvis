import { describe, test } from "node:test";

describe("morning briefing", () => {
  describe("SCHED-03: automated briefing", () => {
    test.todo("briefing task is seeded on first startup with correct cron expression");
    test.todo("briefing task prompt includes Calendar, Gmail, Bitbucket, and web search instructions");
    test.todo("briefing type executes through agent loop (not direct sendMessage)");
    test.todo("duplicate briefing task is not created if one already exists");
  });
});
