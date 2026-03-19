import type { Tool, ToolResult } from "../tools/tool-types.js";
import type { TaskType } from "./types.js";
import {
  createTask,
  deleteTask,
  pauseTask,
  resumeTask,
  listTasks,
  getNextRun,
} from "./scheduler-manager.js";
import { config } from "../config.js";

export const createScheduledTaskTool: Tool = {
  definition: {
    name: "create_scheduled_task",
    description:
      "Create a scheduled task or reminder. Extract cron expression from user's natural language before calling. Use 'reminder' type for simple text notifications (no agent loop). Use 'task' type for tasks that need tool execution.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Human-readable task name, e.g. 'Daily standup reminder'",
        },
        type: {
          type: "string",
          description: "Task type",
          enum: ["reminder", "task"],
        },
        cron_expression: {
          type: "string",
          description:
            "Cron expression (5 fields: min hour day month weekday) OR ISO 8601 datetime for one-shot tasks, e.g. '0 9 * * 1' for every Monday 9am, or '2026-03-19T09:00:00' for a specific time",
        },
        prompt: {
          type: "string",
          description:
            "For reminders: the notification text. For tasks: the instruction for the agent to execute",
        },
        timezone: {
          type: "string",
          description:
            "IANA timezone, e.g. 'America/Bogota'. Defaults to system timezone",
        },
      },
      required: ["name", "type", "cron_expression", "prompt"],
    },
  },

  async execute(args, context): Promise<ToolResult> {
    try {
      const task = createTask({
        userId: context.userId,
        name: args.name as string,
        type: args.type as TaskType,
        cronExpression: args.cron_expression as string,
        prompt: args.prompt as string,
        timezone: (args.timezone as string) || config.scheduler.timezone,
      });
      const nextRun = getNextRun(task.id);
      return {
        success: true,
        data: {
          id: task.id,
          name: task.name,
          type: task.type,
          cron_expression: task.cron_expression,
          next_run: nextRun?.toISOString() ?? "N/A",
        },
      };
    } catch (err) {
      return { success: false, data: null, error: (err as Error).message };
    }
  },
};

export const listScheduledTasksTool: Tool = {
  definition: {
    name: "list_scheduled_tasks",
    description:
      "List all scheduled tasks and reminders for the current user. Shows name, type, status, cron expression, next run time, and last run info.",
    parameters: {
      type: "object",
      properties: {},
    },
  },

  async execute(_args, context): Promise<ToolResult> {
    try {
      const tasks = listTasks(context.userId);
      const result = tasks.map((task) => {
        const nextRun = getNextRun(task.id);
        return {
          id: task.id,
          name: task.name,
          type: task.type,
          status: task.status,
          cron_expression: task.cron_expression,
          next_run: nextRun?.toISOString() ?? "N/A",
          last_run_at: task.last_run_at,
          run_count: task.run_count,
          last_error: task.last_error,
        };
      });
      return { success: true, data: result };
    } catch (err) {
      return { success: false, data: null, error: (err as Error).message };
    }
  },
};

export const deleteScheduledTaskTool: Tool = {
  definition: {
    name: "delete_scheduled_task",
    description:
      "Delete a scheduled task or reminder by ID. Always confirm with user before calling this.",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "Task ID to delete",
        },
      },
      required: ["task_id"],
    },
  },

  async execute(args, _context): Promise<ToolResult> {
    try {
      const deleted = deleteTask(args.task_id as string);
      if (deleted) {
        return {
          success: true,
          data: { message: `Task ${args.task_id as string} deleted successfully` },
        };
      } else {
        return {
          success: false,
          data: null,
          error: `Task ${args.task_id as string} not found`,
        };
      }
    } catch (err) {
      return { success: false, data: null, error: (err as Error).message };
    }
  },
};

export const manageScheduledTaskTool: Tool = {
  definition: {
    name: "manage_scheduled_task",
    description: "Pause or resume a scheduled task by ID.",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "Task ID",
        },
        action: {
          type: "string",
          description: "Action to perform",
          enum: ["pause", "resume"],
        },
      },
      required: ["task_id", "action"],
    },
  },

  async execute(args, _context): Promise<ToolResult> {
    try {
      const taskId = args.task_id as string;
      const action = args.action as string;

      let success: boolean;
      if (action === "pause") {
        success = pauseTask(taskId);
      } else if (action === "resume") {
        success = resumeTask(taskId);
      } else {
        return { success: false, data: null, error: `Unknown action: ${action}` };
      }

      if (success) {
        return {
          success: true,
          data: { message: `Task ${taskId} ${action}d successfully` },
        };
      } else {
        return {
          success: false,
          data: null,
          error: `Task ${taskId} not found`,
        };
      }
    } catch (err) {
      return { success: false, data: null, error: (err as Error).message };
    }
  },
};
