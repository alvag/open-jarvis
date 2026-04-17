import type Database from "better-sqlite3";
import { createLogger } from "../logger.js";
import {
  extractRepetitiveIntent,
  type IntentCategory,
  type RepetitiveIntent,
} from "./canonicalizer.js";
import {
  createRepetitionStore,
  type RepetitionStore,
} from "./repetition-store.js";

const log = createLogger("proactivity");

export interface RepetitionConfig {
  enabled: boolean;
  windowDays: number;
  threshold: number;
  tightWindowDays: number;
  tightThreshold: number;
  cooldownDays: number;
}

export interface SuggestionDecision {
  shouldSuggest: boolean;
  message?: string;
  canonicalKey?: string;
  category?: string;
  occurrences?: number;
}

export interface ToolOutcome {
  name: string;
  success: boolean;
  args?: Record<string, unknown>;
}

export interface HandleTurnInput {
  userId: string;
  sessionId: string;
  userText: string;
  intent: RepetitiveIntent | null;
  toolOutcomes: ToolOutcome[];
}

export interface RepetitionDetector {
  extract: (userText: string) => RepetitiveIntent | null;
  handleTurn: (input: HandleTurnInput) => SuggestionDecision;
}

/**
 * Checks whether a tool outcome actually represents the action the user asked
 * for. `manage_lists` is multi-action (add_item, view_list, get_lists, …), so
 * only mutations that add an item should count as a completed `list_add`.
 * Inspections like `view_list` are excluded to avoid false positives when the
 * LLM reads a list but never mutates it.
 */
function isRelevantOutcome(
  category: IntentCategory,
  outcome: ToolOutcome,
): boolean {
  if (category === "list_add") {
    if (outcome.name !== "manage_lists") return false;
    const action = outcome.args?.action;
    return action === "add_item";
  }
  if (category === "reminder_request") {
    return (
      outcome.name === "create_scheduled_task" ||
      outcome.name === "manage_scheduled_task"
    );
  }
  return false;
}

const DECLINATION_PATTERNS: RegExp[] = [
  /^\s*no\s*[.!]?\s*$/i,
  /^\s*nah\s*[.!]?\s*$/i,
  /\bno\s+(gracias|hace falta|insistas|por ahora|ahora|me lo sugieras|sugieras)\b/i,
  /\bd[eé]jalo\b/i,
  /\bolv[ií]dalo\b/i,
  /\bno\s+quiero\b/i,
];

// Affirmations that specifically acknowledge the AUTOMATION offer.
// Restricted to phrases with explicit automation/recurrence content so that
// a bare "sí" or "ok" confirming some unrelated action in the same session
// cannot falsely mark an older pending suggestion as accepted.
const AFFIRMATION_PATTERNS: RegExp[] = [
  /\brecurrente\b/i,
  /\brecurrencia\b/i,
  /\bautom[aá]t[ií]zalo\b/i,
  /\bautom[aá]t[ií]zala\b/i,
  /\bconv[ieé]rtelo\b/i,
  /\bconv[ieé]rtela\b/i,
  /\bh[aá]zlo\s+recurrente\b/i,
  /\bd[eé]jalo\s+(?:recurrente|autom[aá]tico)\b/i,
];

const PENDING_TTL_MS = 10 * 60_000;

interface PendingSuggestion {
  canonicalKey: string;
  category: IntentCategory;
  at: number;
}

function isDeclination(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 80) return false;
  return DECLINATION_PATTERNS.some((r) => r.test(t));
}

function isAffirmation(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 120) return false;
  return AFFIRMATION_PATTERNS.some((r) => r.test(t));
}

/**
 * Returns true only when the LAST relevant invocation (per action semantics)
 * for this category succeeded. Handles the common "check then mutate" pattern:
 * if the final mutation failed (or never happened), the turn does not count
 * as a user action.
 */
function hasSuccessfulRelevantInvocation(
  outcomes: ToolOutcome[],
  category: IntentCategory,
): boolean {
  const filtered = outcomes.filter((o) => isRelevantOutcome(category, o));
  if (filtered.length === 0) return false;
  return filtered[filtered.length - 1].success;
}

function suggestionCopy(intent: RepetitiveIntent, occurrences: number): string {
  const lead = `💡 Ya me pediste esto ${occurrences} veces recientemente.`;
  if (intent.category === "reminder_request") {
    return `\n\n${lead} Si quieres, lo convierto en un recordatorio recurrente — dime "sí, hazlo recurrente".`;
  }
  if (intent.category === "list_add") {
    const list = intent.metadata?.listName ?? "esa lista";
    return `\n\n${lead} ¿Quieres que lo automatice o deje una plantilla para "${list}"?`;
  }
  return `\n\n${lead} ¿Lo automatizamos?`;
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().replace("T", " ").replace(/\..+$/, "");
}

function parseSqliteTimestamp(raw: string): number {
  return Date.parse(raw.replace(" ", "T") + "Z");
}

export function createRepetitionDetector(
  db: Database.Database,
  cfg: RepetitionConfig,
): RepetitionDetector {
  const store: RepetitionStore = createRepetitionStore(db);
  const pendingBySession = new Map<string, PendingSuggestion>();

  function takePending(sessionId: string): PendingSuggestion | null {
    const pending = pendingBySession.get(sessionId);
    if (!pending) return null;
    if (Date.now() - pending.at > PENDING_TTL_MS) {
      pendingBySession.delete(sessionId);
      return null;
    }
    return pending;
  }

  function inCooldown(rawTimestamp: string | null): boolean {
    if (!rawTimestamp) return false;
    const ms = parseSqliteTimestamp(rawTimestamp);
    if (!Number.isFinite(ms)) return false;
    return Date.now() - ms < cfg.cooldownDays * 86_400_000;
  }

  return {
    extract(userText) {
      if (!cfg.enabled) return null;
      try {
        return extractRepetitiveIntent(userText);
      } catch (err) {
        log.warn({ err: (err as Error).message }, "extract failed");
        return null;
      }
    },

    handleTurn({ userId, sessionId, userText, intent, toolOutcomes }) {
      if (!cfg.enabled) return { shouldSuggest: false };

      try {
        // 1. Resolve pending suggestion from previous turn (accept/decline).
        //    Acceptance requires a relevant tool invocation to have succeeded
        //    PLUS either (a) the current intent's canonicalKey matches the
        //    pending key — same patrón pedido de nuevo — or (b) the reply is
        //    a short affirmation ("sí", "hazlo", "dale", "recurrente") and
        //    extractRepetitiveIntent returns null because the follow-up
        //    doesn't restate the verb. Without (b) the common natural flow
        //    ("sí, hazlo recurrente") would never mark accepted.
        const pending = takePending(sessionId);
        if (pending) {
          if (isDeclination(userText)) {
            store.markDismissed({ userId, canonicalKey: pending.canonicalKey });
            pendingBySession.delete(sessionId);
            log.info(
              { userId, sessionId, canonicalKey: pending.canonicalKey },
              "suggestion dismissed by user",
            );
            return { shouldSuggest: false };
          }

          const pendingToolSucceeded = hasSuccessfulRelevantInvocation(
            toolOutcomes,
            pending.category,
          );
          const keyMatches = intent?.canonicalKey === pending.canonicalKey;
          const isShortAffirmation = !intent && isAffirmation(userText);

          if (pendingToolSucceeded && (keyMatches || isShortAffirmation)) {
            store.markAccepted({ userId, canonicalKey: pending.canonicalKey });
            pendingBySession.delete(sessionId);
            log.info(
              {
                userId,
                sessionId,
                canonicalKey: pending.canonicalKey,
                via: isShortAffirmation ? "affirmation" : "restated_intent",
              },
              "suggestion accepted by user",
            );
            // Do NOT return: fall through so the new usage is still recorded.
            // Cooldown check below will prevent re-suggesting immediately.
          } else {
            // Neither accept nor decline — leave pending untouched for another turn
            pendingBySession.set(sessionId, pending);
          }
        }

        // 2. Record usage ONLY when a relevant tool actually ran successfully
        //    for this intent. Keeps intent_usage aligned with completed actions,
        //    avoiding conversational false positives and mixed-outcome turns.
        if (!intent) return { shouldSuggest: false };
        const toolMatched = hasSuccessfulRelevantInvocation(
          toolOutcomes,
          intent.category,
        );
        if (!toolMatched) return { shouldSuggest: false };

        store.recordUsage({
          userId,
          category: intent.category,
          canonicalKey: intent.canonicalKey,
          rawText: intent.rawText,
        });

        // 3. Check suggestion state
        const state = store.getSuggestionState({
          userId,
          canonicalKey: intent.canonicalKey,
        });
        if (state?.accepted_at) return { shouldSuggest: false };
        if (inCooldown(state?.last_suggested_at ?? null)) {
          return { shouldSuggest: false };
        }
        if (inCooldown(state?.last_dismissed_at ?? null)) {
          return { shouldSuggest: false };
        }

        // 4. Evaluate threshold
        const countWindow = store.countUsageSince({
          userId,
          canonicalKey: intent.canonicalKey,
          sinceIsoTimestamp: isoDaysAgo(cfg.windowDays),
        });
        const countTight = store.countUsageSince({
          userId,
          canonicalKey: intent.canonicalKey,
          sinceIsoTimestamp: isoDaysAgo(cfg.tightWindowDays),
        });

        const hits =
          countWindow >= cfg.threshold || countTight >= cfg.tightThreshold;
        if (!hits) return { shouldSuggest: false };

        // 5. Fire suggestion + remember pending so next turn can detect outcome
        store.markSuggested({
          userId,
          canonicalKey: intent.canonicalKey,
          category: intent.category,
        });
        pendingBySession.set(sessionId, {
          canonicalKey: intent.canonicalKey,
          category: intent.category,
          at: Date.now(),
        });

        log.info(
          {
            userId,
            canonicalKey: intent.canonicalKey,
            category: intent.category,
            countWindow,
            countTight,
          },
          "repetition detected — suggesting",
        );

        return {
          shouldSuggest: true,
          message: suggestionCopy(intent, countWindow),
          canonicalKey: intent.canonicalKey,
          category: intent.category,
          occurrences: countWindow,
        };
      } catch (err) {
        log.warn({ err: (err as Error).message }, "handleTurn failed");
        return { shouldSuggest: false };
      }
    },
  };
}
