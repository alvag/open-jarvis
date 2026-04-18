import type { StructuredMemoryRepository } from "./repository.js";
import type { DuplicateCandidate, KnowledgeEntity } from "./types.js";
import { normalizeName, similarity } from "./normalize.js";

function significantTokens(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(/\s+/)
      .filter((t) => t.length >= 4),
  );
}

function sharedTokenCount(a: string, b: string): number {
  const sa = significantTokens(a);
  const sb = significantTokens(b);
  let count = 0;
  for (const t of sa) if (sb.has(t)) count++;
  return count;
}

interface ProbeInput {
  userId: string;
  canonicalName: string;
  aliases?: string[];
  tags?: string[];
  excludeId?: string;
  entityType?: KnowledgeEntity["entityType"];
}

export function findDuplicateCandidates(
  repo: StructuredMemoryRepository,
  input: ProbeInput,
  maxResults = 5,
): DuplicateCandidate[] {
  const candidates = repo.listEntitiesByUser(input.userId);
  const probeCanonical = normalizeName(input.canonicalName);
  const probeAliases = (input.aliases ?? []).map(normalizeName).filter(Boolean);
  const probeTags = new Set((input.tags ?? []).map(normalizeName));

  const scored: DuplicateCandidate[] = [];

  for (const candidate of candidates) {
    if (input.excludeId && candidate.id === input.excludeId) continue;

    const reasons: string[] = [];
    let score = 0;

    const candCanonical = normalizeName(candidate.canonicalName);
    const candAliases = candidate.aliases.map(normalizeName).filter(Boolean);
    const candTags = candidate.tags.map(normalizeName);

    if (candCanonical === probeCanonical) {
      score = Math.max(score, 0.95);
      reasons.push("canonical_name_normalized_match");
    }

    const aliasOverlap =
      probeAliases.some((a) => candAliases.includes(a) || a === candCanonical) ||
      candAliases.some((a) => a === probeCanonical);
    if (aliasOverlap) {
      score = Math.max(score, 0.85);
      reasons.push("alias_overlap");
    }

    const fuzzy = similarity(probeCanonical, candCanonical);
    if (fuzzy > 0.85 && !reasons.includes("canonical_name_normalized_match")) {
      score = Math.max(score, fuzzy);
      reasons.push("fuzzy_name");
    }

    const shared = sharedTokenCount(
      input.canonicalName,
      candidate.canonicalName,
    );
    if (
      shared > 0 &&
      input.entityType === candidate.entityType &&
      !reasons.includes("canonical_name_normalized_match")
    ) {
      const tokenScore = shared >= 2 ? 0.8 : 0.65;
      if (score < tokenScore) score = tokenScore;
      reasons.push("shared_token");
    }

    const sharedTags = candTags.filter((t) => probeTags.has(t));
    if (
      input.entityType === candidate.entityType &&
      sharedTags.length > 0 &&
      fuzzy > 0.6
    ) {
      if (score < 0.6) score = 0.6;
      reasons.push("type_plus_tag_match");
    }

    if (reasons.length > 0) {
      scored.push({
        entityId: candidate.id,
        canonicalName: candidate.canonicalName,
        slug: candidate.slug,
        entityType: candidate.entityType,
        score: Number(score.toFixed(3)),
        reasons,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
