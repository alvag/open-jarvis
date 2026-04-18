import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase } from "../../memory/db.js";
import { createMemoryManager } from "../../memory/memory-manager.js";
import { createStructuredMemoryRepository } from "../../memory/structured-memory/repository.js";
import { createStructuredMemoryService } from "../../memory/structured-memory/service.js";
import { createStructuredMemoryTool } from "./structured-memory.js";
import type { ToolContext } from "../tool-types.js";

interface Fixture {
  ctx: ToolContext;
  tool: ReturnType<typeof createStructuredMemoryTool>;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-structured-tool-"));
  const db = initDatabase(join(dir, "test.db"));
  const memoryManager = createMemoryManager(db);
  const repo = createStructuredMemoryRepository(db);
  const service = createStructuredMemoryService(repo, memoryManager);
  const tool = createStructuredMemoryTool(service);
  return {
    tool,
    ctx: { userId: "u1", sessionId: "s1" },
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("tool schema exposes all actions", () => {
  const fx = makeFixture();
  try {
    const actions = fx.tool.definition.parameters.properties.action.enum;
    assert.ok(actions);
    assert.deepEqual(
      actions?.slice().sort(),
      [
        "create_entity",
        "create_relation",
        "delete_relation",
        "get_entity",
        "get_profile",
        "link_memory",
        "merge_entities",
        "search_entities",
        "suggest_duplicates",
        "update_entity",
      ].sort(),
    );
  } finally {
    fx.cleanup();
  }
});

test("create_entity happy path returns entity", async () => {
  const fx = makeFixture();
  try {
    const result = await fx.tool.execute(
      {
        action: "create_entity",
        entity_type: "person",
        canonical_name: "Arely",
        aliases: '["Esposa"]',
        tags: '["familia"]',
      },
      fx.ctx,
    );
    assert.equal(result.success, true);
    const data = result.data as { entity: { slug: string; aliases: string[] } };
    assert.equal(data.entity.slug, "arely");
    assert.deepEqual(data.entity.aliases, ["Esposa"]);
  } finally {
    fx.cleanup();
  }
});

test("create_entity missing canonical_name returns error", async () => {
  const fx = makeFixture();
  try {
    const result = await fx.tool.execute(
      { action: "create_entity", entity_type: "person" },
      fx.ctx,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /canonical_name/);
  } finally {
    fx.cleanup();
  }
});

test("create_entity invalid aliases JSON returns error", async () => {
  const fx = makeFixture();
  try {
    const result = await fx.tool.execute(
      {
        action: "create_entity",
        entity_type: "person",
        canonical_name: "X",
        aliases: "not-json",
      },
      fx.ctx,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /aliases/);
  } finally {
    fx.cleanup();
  }
});

test("create_entity blocks duplicate without force", async () => {
  const fx = makeFixture();
  try {
    await fx.tool.execute(
      {
        action: "create_entity",
        entity_type: "person",
        canonical_name: "Marilú Lozano",
      },
      fx.ctx,
    );
    const second = await fx.tool.execute(
      {
        action: "create_entity",
        entity_type: "person",
        canonical_name: "Marilu Lozano",
      },
      fx.ctx,
    );
    assert.equal(second.success, false);
    const data = second.data as { duplicates: unknown[] };
    assert.ok(data.duplicates.length > 0);
  } finally {
    fx.cleanup();
  }
});

test("merge_entities without confirm returns error", async () => {
  const fx = makeFixture();
  try {
    await fx.tool.execute(
      {
        action: "create_entity",
        entity_type: "person",
        canonical_name: "A",
      },
      fx.ctx,
    );
    await fx.tool.execute(
      {
        action: "create_entity",
        entity_type: "person",
        canonical_name: "B",
      },
      fx.ctx,
    );
    const result = await fx.tool.execute(
      {
        action: "merge_entities",
        primary_id: "a",
        secondary_id: "b",
      },
      fx.ctx,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /confirm/);
  } finally {
    fx.cleanup();
  }
});

test("get_profile returns empty relations for isolated entity", async () => {
  const fx = makeFixture();
  try {
    await fx.tool.execute(
      {
        action: "create_entity",
        entity_type: "person",
        canonical_name: "Solo",
      },
      fx.ctx,
    );
    const result = await fx.tool.execute(
      { action: "get_profile", slug: "solo" },
      fx.ctx,
    );
    assert.equal(result.success, true);
    const data = result.data as { relations: unknown[]; relatedMemories: unknown[] };
    assert.equal(data.relations.length, 0);
    assert.equal(data.relatedMemories.length, 0);
  } finally {
    fx.cleanup();
  }
});

test("unknown action returns descriptive error", async () => {
  const fx = makeFixture();
  try {
    const result = await fx.tool.execute({ action: "nope" }, fx.ctx);
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /Unknown action/);
  } finally {
    fx.cleanup();
  }
});
