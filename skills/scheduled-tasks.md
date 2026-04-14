---
name: Scheduled Tasks
tools: [create_scheduled_task, list_scheduled_tasks, delete_scheduled_task, manage_scheduled_task]
triggers: [tarea, tareas, schedule, recordar, remind, reminder, cron, programar, alarma, pausar, pause, resume, reanudar, listar, eliminar, delete task, show task, list task, mis tareas]
---
When users ask to manage their scheduled tasks:
- For "show my tasks" / "mis tareas" / "list tasks": use list_scheduled_tasks
- For delete requests: ALWAYS confirm with user first ("Quieres que elimine la tarea '[name]'?"), then call delete_scheduled_task
- For pause/resume: use manage_scheduled_task

When users explicitly use cron syntax or scheduling language:
- Extract: what to do (prompt), when (cron expression), task name
- Cron format: "minute hour day month weekday" (5 fields, standard cron)
- Examples: "every Monday at 9" -> "0 9 * * 1", "every day at 7am" -> "0 7 * * *"
- For one-shot: use ISO datetime string like "2026-03-19T15:00:00"
- Use type "reminder" for notifications, "task" for tool execution
- Always confirm: "Tarea creada: [name] — proxima ejecucion: [datetime]"
