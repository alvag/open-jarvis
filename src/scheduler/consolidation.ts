import type { MemoryManager } from "../memory/memory-manager.js";

const MAX_MEMORIES = 200;
const MAX_MESSAGES = 50;
const MAX_PROMPT_CHARS = 30_000;

export function buildConsolidationPrompt(
  memoryManager: MemoryManager,
  userId: string,
): string {
  const allMemories = memoryManager.getAllMemories(userId);
  const todayMessages = memoryManager.getTodaySessionMessages(userId);

  const memories = allMemories.slice(0, MAX_MEMORIES);
  const messages = todayMessages.slice(0, MAX_MESSAGES);

  const memoriesBlock = memories.length > 0
    ? memories.map(m => `[ID:${m.id}] (${m.category}) "${m.key}": ${m.content} [updated: ${m.updated_at}]`).join("\n")
    : "(no memories stored)";

  const messagesBlock = messages.length > 0
    ? messages.map(m => `- ${m.content}`).join("\n")
    : "(no conversations today)";

  const truncationNote = allMemories.length > MAX_MEMORIES
    ? `\n\n> Note: Showing ${MAX_MEMORIES} of ${allMemories.length} memories. Oldest memories were omitted.`
    : "";

  let prompt = `You are performing daily memory maintenance. This is an automated task — do NOT send any message to the user.

## Current Memories (${allMemories.length} total)
${memoriesBlock}${truncationNote}

## Today's Conversations
${messagesBlock}

## Instructions

Perform these steps in order:

### 1. Extract new facts from today's conversations
Review today's conversations. If the user mentioned any new facts, preferences, events, or important information that is NOT already in memories, save them using save_memory.
- Only save genuinely useful, long-term information
- Do NOT save transient requests ("search for X", "what time is it")
- Do NOT save information already covered by existing memories

### 2. Merge duplicate/overlapping memories
Look for memories that cover the same topic or contain redundant information. Merge them:
- Use save_memory with the key of the memory to keep (this updates it)
- Use delete_memory to remove the redundant one
- Prefer the more recent or more complete version

### 3. Update outdated information
If today's conversations revealed that a stored memory is outdated (e.g., user changed jobs, moved cities, changed preference), update it using save_memory with the same key.

### 4. Clean up low-value memories
Delete memories that are:
- Clearly obsolete (past events that are no longer relevant)
- Too vague to be useful
- Duplicated information already captured in other memories

## Rules
- Be conservative: when in doubt, keep the memory
- Never delete memories about health, allergies, important dates, strong preferences, or system settings (keys like "response_tone")
- Each save_memory/delete_memory call should be deliberate — explain your reasoning before each action
- If there's nothing to do, that's fine — not every day requires changes`;

  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS) + "\n\n[Prompt truncated due to size]";
  }

  return prompt;
}
