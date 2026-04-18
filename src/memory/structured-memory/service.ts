import { randomUUID } from "node:crypto";
import type { MemoryManager } from "../memory-manager.js";
import type { StructuredMemoryRepository } from "./repository.js";
import { findDuplicateCandidates } from "./duplicate-detection.js";
import { dedupStrings, normalizeName, slugify } from "./normalize.js";
import {
  ENTITY_TYPES,
  type CreateEntityInput,
  type CreateEntityResult,
  type CreateRelationInput,
  type DuplicateCandidate,
  type EntityProfile,
  type EntityType,
  type KnowledgeEntity,
  type KnowledgeRelation,
  type MergeResult,
  type RelationWithTarget,
  type UpdateEntityPatch,
} from "./types.js";

const DUPLICATE_BLOCK_SCORE = 0.9;

export interface StructuredMemoryService {
  createEntity(userId: string, input: CreateEntityInput): CreateEntityResult;
  updateEntity(
    userId: string,
    idOrSlug: string,
    patch: UpdateEntityPatch,
  ): KnowledgeEntity;
  getEntity(userId: string, idOrSlug: string): KnowledgeEntity | null;
  searchEntities(
    userId: string,
    query: string,
    opts?: { type?: EntityType; limit?: number },
  ): KnowledgeEntity[];
  createRelation(
    userId: string,
    input: CreateRelationInput,
  ): KnowledgeRelation;
  deleteRelation(userId: string, relationId: string): boolean;
  getProfile(userId: string, idOrSlug: string): EntityProfile | null;
  suggestDuplicates(
    userId: string,
    idOrSlug: string,
  ): DuplicateCandidate[];
  linkMemory(
    userId: string,
    entityIdOrSlug: string,
    memoryKey: string,
  ): { entity: KnowledgeEntity; memoryId: number };
  mergeEntities(
    userId: string,
    primaryIdOrSlug: string,
    secondaryIdOrSlug: string,
    opts: { confirm: boolean },
  ): MergeResult;
}

export function createStructuredMemoryService(
  repo: StructuredMemoryRepository,
  memoryManager: MemoryManager,
): StructuredMemoryService {
  function resolveEntity(userId: string, idOrSlug: string): KnowledgeEntity {
    const byId = repo.getEntityById(userId, idOrSlug);
    if (byId) return byId;
    const bySlug = repo.getEntityBySlug(userId, idOrSlug);
    if (bySlug) return bySlug;
    throw new Error(`Entity not found: ${idOrSlug}`);
  }

  function uniqueSlug(userId: string, base: string): string {
    let candidate = base || `entity_${Date.now()}`;
    if (!repo.slugExists(userId, candidate)) return candidate;
    for (let i = 2; i < 1000; i++) {
      const next = `${candidate}_${i}`;
      if (!repo.slugExists(userId, next)) return next;
    }
    return `${candidate}_${randomUUID().slice(0, 8)}`;
  }

  return {
    createEntity(userId, input) {
      if (!ENTITY_TYPES.includes(input.entityType)) {
        throw new Error(
          `Invalid entity_type: ${input.entityType}. Must be one of ${ENTITY_TYPES.join(", ")}`,
        );
      }
      const canonicalName = input.canonicalName.trim();
      if (!canonicalName) {
        throw new Error("canonical_name is required");
      }

      const aliases = dedupStrings(input.aliases ?? []);
      const tags = dedupStrings(input.tags ?? []);
      const notes = (input.notes ?? []).map((n) => n.trim()).filter(Boolean);

      if (!input.force) {
        const candidates = findDuplicateCandidates(repo, {
          userId,
          canonicalName,
          aliases,
          tags,
          entityType: input.entityType,
        });
        const blockers = candidates.filter(
          (c) => c.score >= DUPLICATE_BLOCK_SCORE,
        );
        if (blockers.length > 0) {
          return { created: false, duplicates: blockers };
        }
      }

      const baseSlug = input.slug ? slugify(input.slug) : slugify(canonicalName);
      const slug = uniqueSlug(userId, baseSlug);
      const now = new Date().toISOString();

      const entity: KnowledgeEntity = {
        id: randomUUID(),
        userId,
        entityType: input.entityType,
        canonicalName,
        slug,
        aliases,
        attributes: input.attributes ?? {},
        notes,
        tags,
        confidence: input.confidence,
        createdAt: now,
        updatedAt: now,
      };

      repo.insertEntity(entity);
      return { created: true, entity };
    },

    updateEntity(userId, idOrSlug, patch) {
      const existing = resolveEntity(userId, idOrSlug);

      const next: KnowledgeEntity = {
        ...existing,
        entityType: patch.entityType ?? existing.entityType,
        canonicalName: patch.canonicalName
          ? patch.canonicalName.trim()
          : existing.canonicalName,
        confidence: patch.confidence ?? existing.confidence,
        attributes: patch.attributes
          ? { ...existing.attributes, ...patch.attributes }
          : existing.attributes,
        aliases: existing.aliases,
        notes: existing.notes,
        tags: existing.tags,
        updatedAt: new Date().toISOString(),
      };

      const identityChanged =
        (patch.canonicalName &&
          normalizeName(patch.canonicalName) !==
            normalizeName(existing.canonicalName)) ||
        !!patch.aliasesAdd?.length ||
        !!patch.aliasesRemove?.length;

      if (patch.entityType && !ENTITY_TYPES.includes(patch.entityType)) {
        throw new Error(`Invalid entity_type: ${patch.entityType}`);
      }

      if (patch.aliasesAdd?.length || patch.aliasesRemove?.length) {
        const toRemove = new Set(
          (patch.aliasesRemove ?? []).map(normalizeName).filter(Boolean),
        );
        const combined = [
          ...existing.aliases.filter((a) => !toRemove.has(normalizeName(a))),
          ...(patch.aliasesAdd ?? []),
        ];
        next.aliases = dedupStrings(combined);
      }

      if (patch.tagsAdd?.length || patch.tagsRemove?.length) {
        const toRemove = new Set(
          (patch.tagsRemove ?? []).map(normalizeName).filter(Boolean),
        );
        const combined = [
          ...existing.tags.filter((t) => !toRemove.has(normalizeName(t))),
          ...(patch.tagsAdd ?? []),
        ];
        next.tags = dedupStrings(combined);
      }

      if (patch.notesAdd?.length) {
        next.notes = [
          ...existing.notes,
          ...patch.notesAdd.map((n) => n.trim()).filter(Boolean),
        ];
      }

      if (patch.regenerateSlug && patch.canonicalName) {
        const newBase = slugify(patch.canonicalName);
        const oldBase = slugify(existing.canonicalName);
        if (newBase !== oldBase) {
          next.slug = uniqueSlug(userId, newBase);
        }
      }

      if (identityChanged) {
        const candidates = findDuplicateCandidates(repo, {
          userId,
          canonicalName: next.canonicalName,
          aliases: next.aliases,
          tags: next.tags,
          entityType: next.entityType,
          excludeId: existing.id,
        });
        const blockers = candidates.filter((c) => c.score >= 0.9);
        if (blockers.length > 0) {
          const list = blockers
            .map((b) => `${b.canonicalName} (${b.slug})`)
            .join(", ");
          throw new Error(
            `Update would collide with existing entity: ${list}. Use merge_entities to consolidate instead, or choose a different canonical_name/aliases.`,
          );
        }
      }

      repo.updateEntity(next);
      return next;
    },

    getEntity(userId, idOrSlug) {
      return (
        repo.getEntityById(userId, idOrSlug) ??
        repo.getEntityBySlug(userId, idOrSlug)
      );
    },

    searchEntities(userId, query, opts = {}) {
      const limit = opts.limit ?? 10;
      return repo.searchEntitiesByName(userId, query, limit, opts.type);
    },

    createRelation(userId, input) {
      if (!input.relationType || !input.relationType.trim()) {
        throw new Error("relation_type is required");
      }
      const fromRef = input.fromId ?? input.fromSlug;
      const toRef = input.toId ?? input.toSlug;
      if (!fromRef || !toRef) {
        throw new Error("from_slug/from_id and to_slug/to_id are required");
      }
      const from = resolveEntity(userId, fromRef);
      const to = resolveEntity(userId, toRef);
      if (from.id === to.id) {
        throw new Error("Cannot create a relation from an entity to itself");
      }

      const now = new Date().toISOString();
      const relation: KnowledgeRelation = {
        id: randomUUID(),
        userId,
        fromEntityId: from.id,
        relationType: input.relationType.trim(),
        toEntityId: to.id,
        attributes: input.attributes ?? {},
        notes: (input.notes ?? []).map((n) => n.trim()).filter(Boolean),
        confidence: input.confidence,
        createdAt: now,
        updatedAt: now,
      };

      const inserted = repo.insertRelation(relation);
      if (!inserted) {
        throw new Error(
          `Relation already exists: ${from.slug} -> ${relation.relationType} -> ${to.slug}`,
        );
      }
      return relation;
    },

    deleteRelation(userId, relationId) {
      return repo.deleteRelation(userId, relationId);
    },

    getProfile(userId, idOrSlug) {
      const entity =
        repo.getEntityById(userId, idOrSlug) ??
        repo.getEntityBySlug(userId, idOrSlug);
      if (!entity) return null;

      const relations = repo.getRelationsFor(userId, entity.id);
      const targetIds = new Set<string>();
      for (const r of relations) {
        targetIds.add(r.fromEntityId);
        targetIds.add(r.toEntityId);
      }
      targetIds.delete(entity.id);

      const targetMap = new Map<string, KnowledgeEntity>();
      for (const id of targetIds) {
        const t = repo.getEntityById(userId, id);
        if (t) targetMap.set(id, t);
      }

      const relationsWithTargets: RelationWithTarget[] = relations.flatMap(
        (r) => {
          const isOutgoing = r.fromEntityId === entity.id;
          const otherId = isOutgoing ? r.toEntityId : r.fromEntityId;
          const other = targetMap.get(otherId);
          if (!other) return [];
          return [
            {
              relationId: r.id,
              relationType: r.relationType,
              direction: isOutgoing ? "outgoing" : "incoming",
              other: {
                id: other.id,
                canonicalName: other.canonicalName,
                slug: other.slug,
                entityType: other.entityType,
              },
              attributes: r.attributes,
              notes: r.notes,
              confidence: r.confidence,
            },
          ];
        },
      );

      const relatedMemories = repo.getLinkedMemories(userId, entity.id);

      return {
        entity,
        relations: relationsWithTargets,
        relatedMemories,
      };
    },

    suggestDuplicates(userId, idOrSlug) {
      const entity = resolveEntity(userId, idOrSlug);
      return findDuplicateCandidates(repo, {
        userId,
        canonicalName: entity.canonicalName,
        aliases: entity.aliases,
        tags: entity.tags,
        entityType: entity.entityType,
        excludeId: entity.id,
      });
    },

    linkMemory(userId, entityIdOrSlug, memoryKey) {
      const entity = resolveEntity(userId, entityIdOrSlug);
      const memory = memoryManager.getMemoryByKey(userId, memoryKey);
      if (!memory) {
        throw new Error(`Memory not found by key: ${memoryKey}`);
      }
      repo.linkMemory(entity.id, memory.id);
      return { entity, memoryId: memory.id };
    },

    mergeEntities(userId, primaryIdOrSlug, secondaryIdOrSlug, opts) {
      if (!opts.confirm) {
        throw new Error(
          "merge requires confirm=true. This is irreversible — confirm with the user before calling again.",
        );
      }
      const primary = resolveEntity(userId, primaryIdOrSlug);
      const secondary = resolveEntity(userId, secondaryIdOrSlug);
      if (primary.id === secondary.id) {
        throw new Error("Cannot merge an entity with itself");
      }

      const log: string[] = [];

      const mergedAliases = dedupStrings([
        ...primary.aliases,
        secondary.canonicalName,
        ...secondary.aliases,
      ]);
      const mergedTags = dedupStrings([...primary.tags, ...secondary.tags]);
      const mergedNotes = [
        ...primary.notes,
        ...secondary.notes.map((n) => `[merged] ${n}`),
      ];
      const mergedAttributes = { ...secondary.attributes, ...primary.attributes };

      const merged: KnowledgeEntity = {
        ...primary,
        aliases: mergedAliases,
        tags: mergedTags,
        notes: mergedNotes,
        attributes: mergedAttributes,
        updatedAt: new Date().toISOString(),
      };
      log.push(
        `aliases merged (${primary.aliases.length} + ${secondary.aliases.length} -> ${mergedAliases.length})`,
      );
      log.push(
        `tags merged (${primary.tags.length} + ${secondary.tags.length} -> ${mergedTags.length})`,
      );

      repo.redirectRelationsFrom(secondary.id, primary.id);
      log.push(`relations redirected from ${secondary.slug} to ${primary.slug}`);

      repo.transferMemoryLinks(secondary.id, primary.id);
      log.push(`memory links transferred from ${secondary.slug}`);

      repo.updateEntity(merged);
      repo.deleteEntity(userId, secondary.id);
      log.push(`deleted secondary entity ${secondary.slug}`);

      return { merged, log };
    },
  };
}
