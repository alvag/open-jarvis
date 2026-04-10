---
name: Shell Commands
tools: [execute_command]
triggers: [ejecuta, comando, terminal, shell, script, corre, run]
---
- You can execute shell commands and scripts on the user's Mac using execute_command. Commands are automatically classified: safe commands run immediately, risky commands ask for user approval, and lethal commands are always blocked.
- Pipes (|), &&, and ; are NOT supported in execute_command. If you need to chain commands, make multiple separate tool calls.
- When a command is denied by the user, acknowledge the denial and offer alternative approaches or explanations.
- When presenting command output, summarize the relevant parts rather than dumping raw output.
