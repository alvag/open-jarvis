import type Database from "better-sqlite3";
import type { IntentCategory } from "./canonicalizer.js";

export interface IntentUsageRow {
  id: number;
  user_id: string;
  category: string;
  canonical_key: string;
  raw_text: string;
  created_at: string;
}

export interface IntentSuggestionRow {
  user_id: string;
  canonical_key: string;
  category: string;
  last_suggested_at: string | null;
  last_dismissed_at: string | null;
  accepted_at: string | null;
}

export interface RepetitionStore {
  recordUsage: (input: {
    userId: string;
    category: IntentCategory;
    canonicalKey: string;
    rawText: string;
  }) => void;
  countUsageSince: (input: {
    userId: string;
    canonicalKey: string;
    sinceIsoTimestamp: string;
  }) => number;
  getSuggestionState: (input: {
    userId: string;
    canonicalKey: string;
  }) => IntentSuggestionRow | null;
  markSuggested: (input: {
    userId: string;
    canonicalKey: string;
    category: IntentCategory;
  }) => void;
  markDismissed: (input: { userId: string; canonicalKey: string }) => void;
  markAccepted: (input: { userId: string; canonicalKey: string }) => void;
}

export function createRepetitionStore(db: Database.Database): RepetitionStore {
  const insertUsage = db.prepare(`
    INSERT INTO intent_usage (user_id, category, canonical_key, raw_text)
    VALUES (?, ?, ?, ?)
  `);

  const countSince = db.prepare(`
    SELECT COUNT(*) as n FROM intent_usage
    WHERE user_id = ? AND canonical_key = ? AND created_at >= ?
  `);

  const selectSuggestion = db.prepare(`
    SELECT * FROM intent_suggestions
    WHERE user_id = ? AND canonical_key = ?
  `);

  const upsertSuggested = db.prepare(`
    INSERT INTO intent_suggestions (user_id, canonical_key, category, last_suggested_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, canonical_key) DO UPDATE SET
      last_suggested_at = datetime('now'),
      category = excluded.category
  `);

  const upsertDismissed = db.prepare(`
    INSERT INTO intent_suggestions (user_id, canonical_key, category, last_dismissed_at)
    VALUES (?, ?, '', datetime('now'))
    ON CONFLICT(user_id, canonical_key) DO UPDATE SET
      last_dismissed_at = datetime('now')
  `);

  const upsertAccepted = db.prepare(`
    INSERT INTO intent_suggestions (user_id, canonical_key, category, accepted_at)
    VALUES (?, ?, '', datetime('now'))
    ON CONFLICT(user_id, canonical_key) DO UPDATE SET
      accepted_at = datetime('now')
  `);

  return {
    recordUsage({ userId, category, canonicalKey, rawText }) {
      insertUsage.run(userId, category, canonicalKey, rawText);
    },
    countUsageSince({ userId, canonicalKey, sinceIsoTimestamp }) {
      const row = countSince.get(userId, canonicalKey, sinceIsoTimestamp) as { n: number };
      return row.n;
    },
    getSuggestionState({ userId, canonicalKey }) {
      return (selectSuggestion.get(userId, canonicalKey) as IntentSuggestionRow | undefined) ?? null;
    },
    markSuggested({ userId, canonicalKey, category }) {
      upsertSuggested.run(userId, canonicalKey, category);
    },
    markDismissed({ userId, canonicalKey }) {
      upsertDismissed.run(userId, canonicalKey);
    },
    markAccepted({ userId, canonicalKey }) {
      upsertAccepted.run(userId, canonicalKey);
    },
  };
}
