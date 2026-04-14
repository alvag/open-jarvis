---
name: Quick Tasks
tools: [manage_lists, create_scheduled_task]
triggers: [recordar, recuerdame, recuérdame, remind, reminder, anota, anotar, apunta, apuntar, pendientes, no olvidar, hay que, tengo que, agregar tarea, nueva tarea, add task, to-do, programar]
---
You detected a task-like message. Quickly capture it using the right tool:

## Decision Tree

1. **Has specific date/time or recurrence?** → `create_scheduled_task`
   - Date words: mañana, pasado mañana, lunes-domingo, el [día], en [N] horas/días, esta tarde/noche, próximo/a
   - Time words: a las [N], a la [N], am/pm, en la mañana/tarde/noche, al mediodía
   - Recurrence: todos los, cada, every, diario, semanal, mensual
   → Extract datetime and create a scheduled reminder (see rules below)

2. **No date/time, just a task to remember?** → `manage_lists`
   - Action: `add_item`, list_name: `Tareas`, item_text: clean task description
   - "Tareas" is the default task inbox (auto-creates if it doesn't exist)

3. **Ambiguous?** → Ask the user
   - "¿Lo agendo como recordatorio para [fecha] o lo anoto en tu lista de tareas?"

## Datetime Extraction (Spanish)

Resolve relative to the current date/time from system context.

**Relative dates:**
- "mañana" → tomorrow
- "pasado mañana" → day after tomorrow
- "el lunes/martes/..." → next occurrence (if today is that day, use next week)
- "en N horas/días" → current + N
- "esta tarde" → today 15:00 | "esta noche" → today 21:00
- "la próxima semana" → next Monday

**Time extraction:**
- "a las 7" / "a las 7am" → 07:00
- "a las 3 de la tarde" / "3pm" → 15:00
- "al mediodía" → 12:00
- "en la mañana" → 09:00 | "en la tarde" → 15:00 | "en la noche" → 21:00

**Default time:** If date but NO time → **09:00**

**Recurrence** (use 5-field cron):
- "todos los lunes" → `0 9 * * 1`
- "cada día" / "diario" → `0 9 * * *`
- "todos los días a las 7" → `0 7 * * *`
- "cada viernes a las 6pm" → `0 18 * * 5`

## Tool Calls

**List task** (no date):
→ `manage_lists({ action: "add_item", list_name: "Tareas", item_text: "<task>" })`

**One-shot reminder** (with date):
→ `create_scheduled_task({ name: "<short name>", type: "reminder", cron_expression: "<ISO 8601>", prompt: "Recuerda: <task>" })`

**Recurring reminder:**
→ `create_scheduled_task({ name: "<short name>", type: "reminder", cron_expression: "<cron>", prompt: "Recuerda: <task>" })`

## Confirmation Format

- **List task:** "Anotado en Tareas: *[task]*"
- **One-shot:** "Te recuerdo el *[fecha]* a las *[hora]*: *[task]*"
- **Recurring:** "Recordatorio creado: *[task]* — *[schedule]*"

## Edge Cases

- If content is clearly a personal fact, not an action → use `save_memory` instead (e.g., "anota que mi cumpleaños es el 5 de mayo")
- If user specifies an explicit list name ("agregar X a lista del super") → use that list, not "Tareas"
- If no description provided ("agregar tarea" solo) → ask: "¿Qué tarea quieres agregar?"
- Multiple tasks in one message → create each separately, confirm all at the end
- If `manage_lists` returns duplicate → inform: "Ya tienes eso en tu lista"
