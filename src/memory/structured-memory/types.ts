export type EntityType =
  | "person"
  | "project"
  | "group"
  | "context"
  | "preference";

export type Confidence = "high" | "medium" | "low";

export const ENTITY_TYPES: EntityType[] = [
  "person",
  "project",
  "group",
  "context",
  "preference",
];

export interface KnowledgeEntity {
  id: string;
  userId: string;
  entityType: EntityType;
  canonicalName: string;
  slug: string;
  aliases: string[];
  attributes: Record<string, unknown>;
  notes: string[];
  tags: string[];
  confidence?: Confidence;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeRelation {
  id: string;
  userId: string;
  fromEntityId: string;
  relationType: string;
  toEntityId: string;
  attributes: Record<string, unknown>;
  notes: string[];
  confidence?: Confidence;
  createdAt: string;
  updatedAt: string;
}

export interface RelationWithTarget {
  relationId: string;
  relationType: string;
  direction: "outgoing" | "incoming";
  other: {
    id: string;
    canonicalName: string;
    slug: string;
    entityType: EntityType;
  };
  attributes: Record<string, unknown>;
  notes: string[];
  confidence?: Confidence;
}

export interface RelatedMemory {
  id: number;
  key: string;
  content: string;
  category: string;
}

export interface EntityProfile {
  entity: KnowledgeEntity;
  relations: RelationWithTarget[];
  relatedMemories: RelatedMemory[];
}

export interface DuplicateCandidate {
  entityId: string;
  canonicalName: string;
  slug: string;
  entityType: EntityType;
  score: number;
  reasons: string[];
}

export interface CreateEntityInput {
  entityType: EntityType;
  canonicalName: string;
  slug?: string;
  aliases?: string[];
  attributes?: Record<string, unknown>;
  notes?: string[];
  tags?: string[];
  confidence?: Confidence;
  force?: boolean;
}

export interface UpdateEntityPatch {
  canonicalName?: string;
  entityType?: EntityType;
  aliasesAdd?: string[];
  aliasesRemove?: string[];
  attributes?: Record<string, unknown>;
  notesAdd?: string[];
  tagsAdd?: string[];
  tagsRemove?: string[];
  confidence?: Confidence;
  regenerateSlug?: boolean;
}

export interface CreateRelationInput {
  fromId?: string;
  fromSlug?: string;
  relationType: string;
  toId?: string;
  toSlug?: string;
  attributes?: Record<string, unknown>;
  notes?: string[];
  confidence?: Confidence;
}

export type CreateEntityResult =
  | { created: true; entity: KnowledgeEntity }
  | { created: false; duplicates: DuplicateCandidate[] };

export interface MergeResult {
  merged: KnowledgeEntity;
  log: string[];
}
