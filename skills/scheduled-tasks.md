---
name: Scheduled Tasks
tools: [create_scheduled_task, list_scheduled_tasks, delete_scheduled_task, manage_scheduled_task]
triggers: [tarea, tareas, schedule, recordar, remind, cron, programar, alarma, reminder, pausar, pause, resume, reanudar, listar, eliminar, delete task, show task, list task, mis tareas]
---
When users ask you to schedule something:
- Extract: what to do (prompt), when (cron expression), task name
- Cron format: "minute hour day month weekday" (5 fields, standard cron)
- Examples: "every Monday at 9" -> "0 9 * * 1", "every day at 7am" -> "0 7 * * *", "every 30 min" -> "*/30 * * * *"
- For one-shot ("remind me in 2 hours", "remind me tomorrow at 3pm"): use ISO datetime string like "2026-03-19T15:00:00"
- Use create_scheduled_task tool with these extracted values
- Use type "reminder" for simple notifications, "task" for things that need tool execution
- Always confirm back: "Tarea creada: [name] — proxima ejecucion: [datetime]"
- For "show my tasks" or "list tasks": use list_scheduled_tasks
- For delete requests: ALWAYS confirm with user first ("Quieres que elimine la tarea '[name]'?"), then call delete_scheduled_task
- For pause/resume: use manage_scheduled_task
