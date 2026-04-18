import type Database from "better-sqlite3";
import type {
  EntityType,
  KnowledgeEntity,
  KnowledgeRelation,
  RelatedMemory,
} from "./types.js";
import { normalizeName } from "./normalize.js";

function buildSearchText(e: KnowledgeEntity): string {
  const parts = [e.canonicalName, ...e.aliases];
  return parts.map(normalizeName).filter(Boolean).join(" ");
}

interface EntityRow {
  id: string;
  user_id: string;
  entity_type: string;
  canonical_name: string;
  slug: string;
  aliases_json: string;
  attributes_json: string;
  notes_json: string;
  tags_json: string;
  confidence: string | null;
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  id: string;
  user_id: string;
  from_entity_id: string;
  relation_type: string;
  to_entity_id: string;
  attributes_json: string;
  notes_json: string;
  confidence: string | null;
  created_at: string;
  updated_at: string;
}

function parseEntity(row: EntityRow): KnowledgeEntity {
  return {
    id: row.id,
    userId: row.user_id,
    entityType: row.entity_type as EntityType,
    canonicalName: row.canonical_name,
    slug: row.slug,
    aliases: JSON.parse(row.aliases_json),
    attributes: JSON.parse(row.attributes_json),
    notes: JSON.parse(row.notes_json),
    tags: JSON.parse(row.tags_json),
    confidence: row.confidence as KnowledgeEntity["confidence"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseRelation(row: RelationRow): KnowledgeRelation {
  return {
    id: row.id,
    userId: row.user_id,
    fromEntityId: row.from_entity_id,
    relationType: row.relation_type,
    toEntityId: row.to_entity_id,
    attributes: JSON.parse(row.attributes_json),
    notes: JSON.parse(row.notes_json),
    confidence: row.confidence as KnowledgeRelation["confidence"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface StructuredMemoryRepository {
  insertEntity(e: KnowledgeEntity): void;
  updateEntity(e: KnowledgeEntity): void;
  getEntityById(userId: string, id: string): KnowledgeEntity | null;
  getEntityBySlug(userId: string, slug: string): KnowledgeEntity | null;
  slugExists(userId: string, slug: string): boolean;
  searchEntitiesByName(
    userId: string,
    query: string,
    limit: number,
    type?: EntityType,
  ): KnowledgeEntity[];
  listEntitiesByUser(userId: string, type?: EntityType): KnowledgeEntity[];
  deleteEntity(userId: string, id: string): boolean;

  insertRelation(r: KnowledgeRelation): boolean;
  getRelationById(userId: string, id: string): KnowledgeRelation | null;
  getRelationsFor(
    userId: string,
    entityId: string,
  ): KnowledgeRelation[];
  redirectRelationsFrom(oldId: string, newId: string): void;
  deleteRelation(userId: string, id: string): boolean;

  linkMemory(entityId: string, memoryId: number): void;
  unlinkMemory(entityId: string, memoryId: number): void;
  getLinkedMemoryIds(entityId: string): number[];
  getLinkedMemories(userId: string, entityId: string): RelatedMemory[];
  transferMemoryLinks(fromId: string, toId: string): void;
}

export function createStructuredMemoryRepository(
  db: Database.Database,
): StructuredMemoryRepository {
  const stmts = {
    insertEntity: db.prepare(`
      INSERT INTO knowledge_entities (
        id, user_id, entity_type, canonical_name, slug, search_text,
        aliases_json, attributes_json, notes_json, tags_json,
        confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateEntity: db.prepare(`
      UPDATE knowledge_entities
      SET entity_type = ?,
          canonical_name = ?,
          slug = ?,
          search_text = ?,
          aliases_json = ?,
          attributes_json = ?,
          notes_json = ?,
          tags_json = ?,
          confidence = ?,
          updated_at = ?
      WHERE id = ? AND user_id = ?
    `),
    getEntityById: db.prepare(`
      SELECT * FROM knowledge_entities WHERE user_id = ? AND id = ?
    `),
    getEntityBySlug: db.prepare(`
      SELECT * FROM knowledge_entities WHERE user_id = ? AND slug = ?
    `),
    slugExists: db.prepare(`
      SELECT 1 FROM knowledge_entities WHERE user_id = ? AND slug = ? LIMIT 1
    `),
    searchByName: db.prepare(`
      SELECT * FROM knowledge_entities
      WHERE user_id = ? AND search_text LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?
    `),
    searchByNameAndType: db.prepare(`
      SELECT * FROM knowledge_entities
      WHERE user_id = ? AND entity_type = ? AND search_text LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?
    `),
    listAll: db.prepare(`
      SELECT * FROM knowledge_entities WHERE user_id = ? ORDER BY canonical_name
    `),
    listByType: db.prepare(`
      SELECT * FROM knowledge_entities
      WHERE user_id = ? AND entity_type = ?
      ORDER BY canonical_name
    `),
    deleteEntity: db.prepare(`
      DELETE FROM knowledge_entities WHERE user_id = ? AND id = ?
    `),

    insertRelation: db.prepare(`
      INSERT OR IGNORE INTO knowledge_relations (
        id, user_id, from_entity_id, relation_type, to_entity_id,
        attributes_json, notes_json, confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getRelationById: db.prepare(`
      SELECT * FROM knowledge_relations WHERE user_id = ? AND id = ?
    `),
    getRelationsByEntity: db.prepare(`
      SELECT * FROM knowledge_relations
      WHERE user_id = ? AND (from_entity_id = ? OR to_entity_id = ?)
      ORDER BY updated_at DESC
    `),
    deleteOverlappingOutgoing: db.prepare(`
      DELETE FROM knowledge_relations AS r
      WHERE r.from_entity_id = ?
        AND EXISTS (
          SELECT 1 FROM knowledge_relations AS p
          WHERE p.from_entity_id = ?
            AND p.user_id = r.user_id
            AND p.relation_type = r.relation_type
            AND p.to_entity_id = r.to_entity_id
        )
    `),
    deleteOverlappingIncoming: db.prepare(`
      DELETE FROM knowledge_relations AS r
      WHERE r.to_entity_id = ?
        AND EXISTS (
          SELECT 1 FROM knowledge_relations AS p
          WHERE p.to_entity_id = ?
            AND p.user_id = r.user_id
            AND p.relation_type = r.relation_type
            AND p.from_entity_id = r.from_entity_id
        )
    `),
    redirectRelationFrom: db.prepare(`
      UPDATE knowledge_relations SET from_entity_id = ?, updated_at = datetime('now')
      WHERE from_entity_id = ?
    `),
    redirectRelationTo: db.prepare(`
      UPDATE knowledge_relations SET to_entity_id = ?, updated_at = datetime('now')
      WHERE to_entity_id = ?
    `),
    deleteSelfReferences: db.prepare(`
      DELETE FROM knowledge_relations WHERE from_entity_id = to_entity_id
    `),
    deleteRelation: db.prepare(`
      DELETE FROM knowledge_relations WHERE user_id = ? AND id = ?
    `),

    linkMemory: db.prepare(`
      INSERT OR IGNORE INTO knowledge_entity_memories (entity_id, memory_id)
      VALUES (?, ?)
    `),
    unlinkMemory: db.prepare(`
      DELETE FROM knowledge_entity_memories WHERE entity_id = ? AND memory_id = ?
    `),
    getLinkedMemoryIds: db.prepare(`
      SELECT memory_id FROM knowledge_entity_memories WHERE entity_id = ?
      ORDER BY created_at DESC
    `),
    getLinkedMemories: db.prepare(`
      SELECT m.id, m.key, m.content, m.category
      FROM knowledge_entity_memories kem
      JOIN memories m ON m.id = kem.memory_id
      WHERE kem.entity_id = ? AND m.user_id = ?
      ORDER BY m.updated_at DESC
    `),
    transferMemoryLinks: db.prepare(`
      INSERT OR IGNORE INTO knowledge_entity_memories (entity_id, memory_id, created_at)
      SELECT ?, memory_id, created_at FROM knowledge_entity_memories WHERE entity_id = ?
    `),
  };

  return {
    insertEntity(e) {
      stmts.insertEntity.run(
        e.id,
        e.userId,
        e.entityType,
        e.canonicalName,
        e.slug,
        buildSearchText(e),
        JSON.stringify(e.aliases),
        JSON.stringify(e.attributes),
        JSON.stringify(e.notes),
        JSON.stringify(e.tags),
        e.confidence ?? null,
        e.createdAt,
        e.updatedAt,
      );
    },

    updateEntity(e) {
      stmts.updateEntity.run(
        e.entityType,
        e.canonicalName,
        e.slug,
        buildSearchText(e),
        JSON.stringify(e.aliases),
        JSON.stringify(e.attributes),
        JSON.stringify(e.notes),
        JSON.stringify(e.tags),
        e.confidence ?? null,
        e.updatedAt,
        e.id,
        e.userId,
      );
    },

    getEntityById(userId, id) {
      const row = stmts.getEntityById.get(userId, id) as EntityRow | undefined;
      return row ? parseEntity(row) : null;
    },

    getEntityBySlug(userId, slug) {
      const row = stmts.getEntityBySlug.get(userId, slug) as
        | EntityRow
        | undefined;
      return row ? parseEntity(row) : null;
    },

    slugExists(userId, slug) {
      return stmts.slugExists.get(userId, slug) !== undefined;
    },

    searchEntitiesByName(userId, query, limit, type) {
      const pattern = `%${normalizeName(query)}%`;
      const rows = (type
        ? stmts.searchByNameAndType.all(userId, type, pattern, limit)
        : stmts.searchByName.all(userId, pattern, limit)) as EntityRow[];
      return rows.map(parseEntity);
    },

    listEntitiesByUser(userId, type) {
      const rows = (type
        ? stmts.listByType.all(userId, type)
        : stmts.listAll.all(userId)) as EntityRow[];
      return rows.map(parseEntity);
    },

    deleteEntity(userId, id) {
      const res = stmts.deleteEntity.run(userId, id);
      return res.changes > 0;
    },

    insertRelation(r) {
      const res = stmts.insertRelation.run(
        r.id,
        r.userId,
        r.fromEntityId,
        r.relationType,
        r.toEntityId,
        JSON.stringify(r.attributes),
        JSON.stringify(r.notes),
        r.confidence ?? null,
        r.createdAt,
        r.updatedAt,
      );
      return res.changes > 0;
    },

    getRelationById(userId, id) {
      const row = stmts.getRelationById.get(userId, id) as
        | RelationRow
        | undefined;
      return row ? parseRelation(row) : null;
    },

    getRelationsFor(userId, entityId) {
      const rows = stmts.getRelationsByEntity.all(
        userId,
        entityId,
        entityId,
      ) as RelationRow[];
      return rows.map(parseRelation);
    },

    redirectRelationsFrom(oldId, newId) {
      stmts.deleteOverlappingOutgoing.run(oldId, newId);
      stmts.deleteOverlappingIncoming.run(oldId, newId);
      stmts.redirectRelationFrom.run(newId, oldId);
      stmts.redirectRelationTo.run(newId, oldId);
      stmts.deleteSelfReferences.run();
    },

    deleteRelation(userId, id) {
      const res = stmts.deleteRelation.run(userId, id);
      return res.changes > 0;
    },

    linkMemory(entityId, memoryId) {
      stmts.linkMemory.run(entityId, memoryId);
    },

    unlinkMemory(entityId, memoryId) {
      stmts.unlinkMemory.run(entityId, memoryId);
    },

    getLinkedMemoryIds(entityId) {
      const rows = stmts.getLinkedMemoryIds.all(entityId) as Array<{
        memory_id: number;
      }>;
      return rows.map((r) => r.memory_id);
    },

    getLinkedMemories(userId, entityId) {
      return stmts.getLinkedMemories.all(entityId, userId) as RelatedMemory[];
    },

    transferMemoryLinks(fromId, toId) {
      stmts.transferMemoryLinks.run(toId, fromId);
    },
  };
}
