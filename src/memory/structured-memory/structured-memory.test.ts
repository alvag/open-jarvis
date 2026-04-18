import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initDatabase } from "../db.js";
import { createMemoryManager } from "../memory-manager.js";
import { createStructuredMemoryRepository } from "./repository.js";
import { createStructuredMemoryService } from "./service.js";
import { slugify, normalizeName, similarity } from "./normalize.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Fixture {
  dir: string;
  db: Database.Database;
  service: ReturnType<typeof createStructuredMemoryService>;
  memoryManager: ReturnType<typeof createMemoryManager>;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-structured-"));
  const db = initDatabase(join(dir, "test.db"));
  const memoryManager = createMemoryManager(db);
  const repo = createStructuredMemoryRepository(db);
  const service = createStructuredMemoryService(repo, memoryManager);
  return {
    dir,
    db,
    service,
    memoryManager,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("normalize: diacritics and lowercase", () => {
  assert.equal(normalizeName("Marilú Lozano"), "marilu lozano");
  assert.equal(normalizeName("  ÁRELY  "), "arely");
  assert.equal(slugify("Marilú Lozano"), "marilu_lozano");
  assert.equal(slugify("Juan Manuel Toni"), "juan_manuel_toni");
});

test("similarity detects close typos", () => {
  assert.ok(similarity("Juan Manuel Toni", "Juanma Toni") > 0.5);
  assert.equal(similarity("Arely", "Arely"), 1);
});

test("createEntity assigns slug and persists", () => {
  const fx = makeFixture();
  try {
    const res = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilú Lozano",
      aliases: ["Marilú", "Suegra"],
      tags: ["familia", "balance"],
    });
    assert.equal(res.created, true);
    if (!res.created) return;
    assert.equal(res.entity.slug, "marilu_lozano");
    assert.deepEqual(res.entity.aliases, ["Marilú", "Suegra"]);

    const fetched = fx.service.getEntity("u1", "marilu_lozano");
    assert.ok(fetched);
    assert.equal(fetched?.canonicalName, "Marilú Lozano");
  } finally {
    fx.cleanup();
  }
});

test("createEntity with slug collision appends suffix", () => {
  const fx = makeFixture();
  try {
    const first = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilú Lozano",
    });
    assert.equal(first.created, true);
    const second = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilu Lozano",
      force: true,
    });
    assert.equal(second.created, true);
    if (!second.created) return;
    assert.equal(second.entity.slug, "marilu_lozano_2");
  } finally {
    fx.cleanup();
  }
});

test("createEntity blocks duplicate by canonical match (without force)", () => {
  const fx = makeFixture();
  try {
    fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilú Lozano",
    });
    const second = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilu Lozano",
    });
    assert.equal(second.created, false);
    if (second.created) return;
    assert.ok(second.duplicates.length > 0);
    assert.ok(
      second.duplicates[0].reasons.includes("canonical_name_normalized_match"),
    );
  } finally {
    fx.cleanup();
  }
});

test("searchEntities resolves by alias", () => {
  const fx = makeFixture();
  try {
    fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilú Lozano",
      aliases: ["Suegra"],
    });
    const results = fx.service.searchEntities("u1", "suegra");
    assert.equal(results.length, 1);
    assert.equal(results[0].slug, "marilu_lozano");
  } finally {
    fx.cleanup();
  }
});

test("createRelation resolves slugs to ids", () => {
  const fx = makeFixture();
  try {
    fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilú Lozano",
    });
    fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Usuario",
    });
    const rel = fx.service.createRelation("u1", {
      fromSlug: "marilu_lozano",
      relationType: "mother_in_law_of",
      toSlug: "usuario",
    });
    assert.equal(rel.relationType, "mother_in_law_of");

    const profile = fx.service.getProfile("u1", "marilu_lozano");
    assert.ok(profile);
    assert.equal(profile?.relations.length, 1);
    assert.equal(profile?.relations[0].direction, "outgoing");
    assert.equal(profile?.relations[0].other.slug, "usuario");
  } finally {
    fx.cleanup();
  }
});

test("createRelation rejects duplicate", () => {
  const fx = makeFixture();
  try {
    fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "A",
    });
    fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "B",
    });
    fx.service.createRelation("u1", {
      fromSlug: "a",
      relationType: "spouse_of",
      toSlug: "b",
    });
    assert.throws(() =>
      fx.service.createRelation("u1", {
        fromSlug: "a",
        relationType: "spouse_of",
        toSlug: "b",
      }),
    );
  } finally {
    fx.cleanup();
  }
});

test("suggestDuplicates detects fuzzy matches", () => {
  const fx = makeFixture();
  try {
    fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Juan Manuel Toni",
    });
    const second = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Juanma Toni",
      force: true,
    });
    assert.equal(second.created, true);
    if (!second.created) return;
    const duplicates = fx.service.suggestDuplicates("u1", second.entity.id);
    assert.ok(duplicates.length >= 1);
    assert.ok(
      duplicates[0].reasons.some(
        (r) => r === "fuzzy_name" || r === "shared_token",
      ),
    );
  } finally {
    fx.cleanup();
  }
});

test("mergeEntities requires confirm=true", () => {
  const fx = makeFixture();
  try {
    const a = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Juan Manuel Toni",
    });
    const b = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Juanma Toni",
      force: true,
    });
    if (!a.created || !b.created) throw new Error("setup failed");
    assert.throws(() =>
      fx.service.mergeEntities("u1", a.entity.id, b.entity.id, {
        confirm: false,
      }),
    );
  } finally {
    fx.cleanup();
  }
});

test("mergeEntities combines aliases, redirects relations and deletes secondary", () => {
  const fx = makeFixture();
  try {
    const primary = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Juan Manuel Toni",
      aliases: ["JM Toni"],
      tags: ["coworker"],
    });
    const secondary = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Juanma Toni",
      aliases: ["Juanma"],
      tags: ["reviewer"],
      force: true,
    });
    const other = fx.service.createEntity("u1", {
      entityType: "project",
      canonicalName: "Repo X",
    });
    if (!primary.created || !secondary.created || !other.created)
      throw new Error("setup failed");

    fx.service.createRelation("u1", {
      fromId: secondary.entity.id,
      relationType: "reviewer_of",
      toId: other.entity.id,
    });

    const { merged, log } = fx.service.mergeEntities(
      "u1",
      primary.entity.id,
      secondary.entity.id,
      { confirm: true },
    );
    assert.ok(merged.aliases.some((a) => a === "Juanma"));
    assert.ok(merged.aliases.some((a) => a === "Juanma Toni"));
    assert.ok(merged.tags.includes("reviewer"));
    assert.ok(merged.tags.includes("coworker"));
    assert.ok(log.length > 0);

    assert.equal(
      fx.service.getEntity("u1", secondary.entity.id),
      null,
    );
    const profile = fx.service.getProfile("u1", primary.entity.id);
    assert.ok(profile);
    assert.equal(profile?.relations.length, 1);
    assert.equal(profile?.relations[0].other.slug, "repo_x");
  } finally {
    fx.cleanup();
  }
});

test("linkMemory attaches memory and surfaces in profile", () => {
  const fx = makeFixture();
  try {
    fx.memoryManager.saveMemory(
      "u1",
      "marilu_note",
      "Marilú suele mencionarse en el grupo familiar",
      "note",
    );
    const created = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilú Lozano",
    });
    if (!created.created) throw new Error("setup failed");

    const result = fx.service.linkMemory(
      "u1",
      created.entity.id,
      "marilu_note",
    );
    assert.ok(result.memoryId > 0);

    const profile = fx.service.getProfile("u1", created.entity.id);
    assert.ok(profile);
    assert.equal(profile?.relatedMemories.length, 1);
    assert.equal(profile?.relatedMemories[0].key, "marilu_note");
  } finally {
    fx.cleanup();
  }
});

test("searchEntities accent-insensitive (Marilu matches Marilú)", () => {
  const fx = makeFixture();
  try {
    fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilú Lozano",
      aliases: ["Suegra"],
    });
    const hits = fx.service.searchEntities("u1", "Marilu");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].slug, "marilu_lozano");
  } finally {
    fx.cleanup();
  }
});

test("searchEntities applies type filter at SQL, not after limit", () => {
  const fx = makeFixture();
  try {
    for (let i = 0; i < 5; i++) {
      fx.service.createEntity("u1", {
        entityType: "project",
        canonicalName: `arely project ${i}`,
      });
    }
    fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Arely",
    });
    const persons = fx.service.searchEntities("u1", "arely", {
      type: "person",
      limit: 3,
    });
    assert.equal(persons.length, 1);
    assert.equal(persons[0].entityType, "person");
  } finally {
    fx.cleanup();
  }
});

test("mergeEntities tolerates overlapping relations (no UNIQUE crash)", () => {
  const fx = makeFixture();
  try {
    const primary = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Juan Manuel Toni",
    });
    const secondary = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Juanma Toni",
      force: true,
    });
    const project = fx.service.createEntity("u1", {
      entityType: "project",
      canonicalName: "Repo X",
    });
    if (!primary.created || !secondary.created || !project.created)
      throw new Error("setup failed");

    fx.service.createRelation("u1", {
      fromId: primary.entity.id,
      relationType: "reviewer_of",
      toId: project.entity.id,
    });
    fx.service.createRelation("u1", {
      fromId: secondary.entity.id,
      relationType: "reviewer_of",
      toId: project.entity.id,
    });

    const { merged } = fx.service.mergeEntities(
      "u1",
      primary.entity.id,
      secondary.entity.id,
      { confirm: true },
    );

    const profile = fx.service.getProfile("u1", merged.id);
    assert.ok(profile);
    const reviewerRelations = profile?.relations.filter(
      (r) => r.relationType === "reviewer_of",
    );
    assert.equal(reviewerRelations?.length, 1);
  } finally {
    fx.cleanup();
  }
});

test("get_profile hides memory links after the memory is deleted", () => {
  const fx = makeFixture();
  try {
    const saved = fx.memoryManager.saveMemory("u1", "ghost_note", "x", "note");
    const created = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Ghosty",
    });
    if (!created.created) throw new Error("setup failed");
    fx.service.linkMemory("u1", created.entity.id, "ghost_note");

    fx.memoryManager.deleteMemory(saved.id, "u1");

    const profile = fx.service.getProfile("u1", created.entity.id);
    assert.ok(profile);
    assert.equal(profile?.relatedMemories.length, 0);

    const entity = fx.service.getEntity("u1", created.entity.id);
    assert.ok(entity);
    assert.equal(
      (entity as unknown as { sourceMemoryIds?: number[] }).sourceMemoryIds,
      undefined,
    );
  } finally {
    fx.cleanup();
  }
});

test("aliases_remove works accent-insensitive", () => {
  const fx = makeFixture();
  try {
    const created = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilú Lozano",
      aliases: ["Marilú", "Suegra"],
    });
    if (!created.created) throw new Error("setup failed");

    const updated = fx.service.updateEntity("u1", created.entity.id, {
      aliasesRemove: ["Marilu"],
    });

    assert.ok(!updated.aliases.some((a) => a === "Marilú"));
    assert.ok(updated.aliases.includes("Suegra"));
  } finally {
    fx.cleanup();
  }
});

test("tags_remove works accent-insensitive", () => {
  const fx = makeFixture();
  try {
    const created = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "X",
      tags: ["Música", "trabajo"],
    });
    if (!created.created) throw new Error("setup failed");
    const updated = fx.service.updateEntity("u1", created.entity.id, {
      tagsRemove: ["musica"],
    });
    assert.ok(!updated.tags.some((t) => t === "Música"));
    assert.ok(updated.tags.includes("trabajo"));
  } finally {
    fx.cleanup();
  }
});

test("updateEntity rejects rename that would collide with another entity", () => {
  const fx = makeFixture();
  try {
    fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Juan Manuel Toni",
    });
    const alt = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Juanma Toni",
      force: true,
    });
    if (!alt.created) throw new Error("setup failed");

    assert.throws(() =>
      fx.service.updateEntity("u1", alt.entity.id, {
        canonicalName: "Juan Manuel Toni",
      }),
    );
  } finally {
    fx.cleanup();
  }
});

test("regenerateSlug preserves suffixed slug on no-op name update", () => {
  const fx = makeFixture();
  try {
    fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilú Lozano",
    });
    const second = fx.service.createEntity("u1", {
      entityType: "person",
      canonicalName: "Marilu Lozano",
      force: true,
    });
    if (!second.created) throw new Error("setup failed");
    assert.equal(second.entity.slug, "marilu_lozano_2");

    const updated = fx.service.updateEntity("u1", second.entity.id, {
      canonicalName: "Marilu Lozano",
      regenerateSlug: true,
    });
    assert.equal(updated.slug, "marilu_lozano_2");
  } finally {
    fx.cleanup();
  }
});

test("existing memories remain usable after structured memory migration", () => {
  const fx = makeFixture();
  try {
    fx.memoryManager.saveMemory("u1", "esposa", "Arely", "fact");
    const search = fx.memoryManager.searchMemories("u1", "Arely");
    assert.equal(search.length, 1);
    assert.equal(search[0].key, "esposa");
  } finally {
    fx.cleanup();
  }
});
