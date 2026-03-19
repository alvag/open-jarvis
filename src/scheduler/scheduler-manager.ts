import { Cron } from "croner";
import { randomUUID } from "node:crypto";
import type { ScheduledTaskRow, SchedulerDeps } from "./types.js";
import { log } from "../logger.js";

// Module-level state
const activeJobs = new Map<string, Cron>();
const taskQueue: ScheduledTaskRow[] = [];
let isExecuting = false;
let deps: SchedulerDeps | null = null;

// Prepared statements (set once in startScheduler)
let stmts: {
  selectActive: import("better-sqlite3").Statement;
  selectByUser: import("better-sqlite3").Statement;
  selectById: import("better-sqlite3").Statement;
  insertTask: import("better-sqlite3").Statement;
  updateStatus: import("better-sqlite3").Statement;
  updateAfterRun: import("better-sqlite3").Statement;
  updateError: import("better-sqlite3").Statement;
  deleteTask: import("better-sqlite3").Statement;
} | null = null;

export function startScheduler(schedulerDeps: SchedulerDeps): void {
  deps = schedulerDeps;
  const db = deps.db;

  stmts = {
    selectActive: db.prepare(
      "SELECT * FROM scheduled_tasks WHERE status = 'active'",
    ),
    selectByUser: db.prepare(
      "SELECT * FROM scheduled_tasks WHERE user_id = ? ORDER BY created_at DESC",
    ),
    selectById: db.prepare("SELECT * FROM scheduled_tasks WHERE id = ?"),
    insertTask: db.prepare(`
      INSERT INTO scheduled_tasks
        (id, user_id, name, type, cron_expression, prompt, timezone, status, pre_approved)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `),
    updateStatus: db.prepare(
      "UPDATE scheduled_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?",
    ),
    updateAfterRun: db.prepare(`
      UPDATE scheduled_tasks
      SET last_run_at = datetime('now'),
          run_count = run_count + 1,
          last_error = NULL,
          retry_after = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `),
    updateError: db.prepare(`
      UPDATE scheduled_tasks
      SET last_error = ?,
          retry_after = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `),
    deleteTask: db.prepare("DELETE FROM scheduled_tasks WHERE id = ?"),
  };

  const rows = stmts.selectActive.all() as ScheduledTaskRow[];
  for (const row of rows) {
    registerJob(row);
  }

  log("info", "scheduler", "Scheduler started", { tasksLoaded: rows.length });
}

function registerJob(task: ScheduledTaskRow): void {
  // Stop existing job if present
  const existing = activeJobs.get(task.id);
  if (existing) {
    existing.stop();
  }

  const job = new Cron(
    task.cron_expression,
    {
      name: task.id,
      timezone: task.timezone === "local" ? undefined : task.timezone,
      protect: true,
      paused: task.status === "paused",
    },
    async () => {
      enqueueExecution(task);
    },
  );

  activeJobs.set(task.id, job);
}

function enqueueExecution(task: ScheduledTaskRow): void {
  taskQueue.push(task);
  if (!isExecuting) {
    void processQueue();
  }
}

async function processQueue(): Promise<void> {
  isExecuting = true;
  while (taskQueue.length > 0) {
    const task = taskQueue.shift()!;
    await executeTask(task);
  }
  isExecuting = false;
}

async function executeTask(task: ScheduledTaskRow): Promise<void> {
  if (!deps || !stmts) return;

  // Re-read from DB to get fresh status
  const fresh = stmts.selectById.get(task.id) as ScheduledTaskRow | undefined;
  if (!fresh || fresh.status !== "active") {
    return;
  }

  try {
    if (fresh.type === "reminder") {
      await deps.sendMessage(fresh.user_id, `🔔 Recordatorio: ${fresh.prompt}`);
    } else if (fresh.type === "pr-monitor") {
      const { checkPRChanges } = await import("./pr-monitor.js");
      await checkPRChanges(deps.db, deps.sendMessage, fresh.user_id);
    } else {
      const sessionId = deps.memoryManager.resolveSession(
        fresh.user_id,
        "scheduler",
        0,
      );
      await deps.runAgent(
        {
          userId: fresh.user_id,
          userName: "scheduler",
          channelId: "scheduler",
          sessionId,
          userMessage: fresh.prompt,
        },
        deps.llm,
        deps.toolRegistry,
        deps.memoryManager,
        deps.soulContent,
        deps.maxIterations,
      );
    }

    stmts.updateAfterRun.run(fresh.id);

    // Check if this is a one-shot task (no next run)
    const job = activeJobs.get(fresh.id);
    if (job && job.nextRun() === null) {
      stmts.updateStatus.run("completed", fresh.id);
      job.stop();
      activeJobs.delete(fresh.id);
    }
  } catch (err: unknown) {
    await handleTaskError(fresh, err);
  }
}

async function handleTaskError(
  task: ScheduledTaskRow,
  err: unknown,
): Promise<void> {
  if (!deps || !stmts) return;

  const errorMsg =
    err instanceof Error ? err.message : String(err);

  log("error", "scheduler", "Task execution failed", {
    taskId: task.id,
    taskName: task.name,
    error: errorMsg,
  });

  // Check if this is a retry attempt (retry_after was previously set)
  if (task.retry_after !== null) {
    // Second failure: clear retry_after, leave active for next scheduled run
    stmts.updateError.run(errorMsg, null, task.id);
    await deps.sendMessage(
      task.user_id,
      `❌ Tarea "${task.name}" falló de nuevo: ${errorMsg}\nEsperando próxima ejecución programada.`,
    );
  } else {
    // First failure: set retry_after and schedule a retry in 5 minutes
    const retryAfter = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    stmts.updateError.run(errorMsg, retryAfter, task.id);
    await deps.sendMessage(
      task.user_id,
      `❌ Tarea "${task.name}" falló: ${errorMsg}\nReintentando en 5 minutos...`,
    );
    setTimeout(() => {
      enqueueExecution(task);
    }, 5 * 60 * 1000);
  }
}

export function createTask(params: {
  userId: string;
  name: string;
  type: ScheduledTaskRow["type"];
  cronExpression: string;
  prompt: string;
  timezone?: string;
  preApproved?: boolean;
}): ScheduledTaskRow {
  if (!stmts) {
    throw new Error("Scheduler not started. Call startScheduler first.");
  }

  const id = randomUUID();
  const timezone = params.timezone ?? "local";
  const preApproved = params.preApproved ? 1 : 0;

  stmts.insertTask.run(
    id,
    params.userId,
    params.name,
    params.type,
    params.cronExpression,
    params.prompt,
    timezone,
    preApproved,
  );

  const row = stmts.selectById.get(id) as ScheduledTaskRow;
  registerJob(row);

  log("info", "scheduler", "Task created", {
    taskId: id,
    taskName: params.name,
    type: params.type,
  });

  return row;
}

export function deleteTask(taskId: string): boolean {
  if (!stmts) return false;

  const job = activeJobs.get(taskId);
  if (job) {
    job.stop();
    activeJobs.delete(taskId);
  }

  const result = stmts.deleteTask.run(taskId);
  return result.changes > 0;
}

export function pauseTask(taskId: string): boolean {
  if (!stmts) return false;

  const result = stmts.updateStatus.run("paused", taskId);
  const job = activeJobs.get(taskId);
  if (job) {
    job.pause();
  }

  return result.changes > 0;
}

export function resumeTask(taskId: string): boolean {
  if (!stmts) return false;

  const result = stmts.updateStatus.run("active", taskId);
  const job = activeJobs.get(taskId);
  if (job) {
    job.resume();
  }

  return result.changes > 0;
}

export function listTasks(userId: string): ScheduledTaskRow[] {
  if (!stmts) return [];
  return stmts.selectByUser.all(userId) as ScheduledTaskRow[];
}

export function getNextRun(taskId: string): Date | null {
  const job = activeJobs.get(taskId);
  if (job) {
    return job.nextRun();
  }
  return null;
}

export function stopAll(): void {
  for (const job of activeJobs.values()) {
    job.stop();
  }
  activeJobs.clear();
  log("info", "scheduler", "All scheduler jobs stopped");
}
