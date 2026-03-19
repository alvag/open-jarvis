import { describe, test } from "node:test";

describe("scheduler-manager", () => {
  describe("SCHED-01: recurring task CRUD", () => {
    test.todo("createTask inserts a row into scheduled_tasks and returns it");
    test.todo("createTask registers a croner job in activeJobs");
    test.todo("listTasks returns all tasks for a given userId");
    test.todo("deleteTask removes the row and stops the croner job");
    test.todo("pauseTask sets status to paused and pauses the croner job");
    test.todo("resumeTask sets status to active and resumes the croner job");
  });

  describe("SCHED-02: one-shot reminders", () => {
    test.todo("reminder type sends text directly via sendMessage without agent loop");
    test.todo("one-shot task marks itself completed when nextRun() returns null");
  });

  describe("execution", () => {
    test.todo("task type invokes runAgent with synthetic prompt");
    test.todo("concurrent triggers are queued and executed sequentially");
    test.todo("executeTask re-reads task from DB and skips if not active");
  });

  describe("error handling", () => {
    test.todo("first failure sets retry_after and sends error notification");
    test.todo("second failure clears retry_after and notifies user");
  });

  describe("lifecycle", () => {
    test.todo("startScheduler loads active tasks and registers jobs");
    test.todo("stopAll stops all croner jobs and clears activeJobs");
  });
});
