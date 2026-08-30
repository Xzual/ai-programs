import { Router } from "express";
import { memoryService } from "../../src/edith/memoryService";
import { obsidianVaultService } from "../../src/edith/obsidianVaultService";
import { getEdithPersistenceStore } from "../../src/edith/persistence";
import { parseMemoryLimit, parseMemoryScope, parseMemoryType } from "../utils/memoryParsing";

export function createMemoryRouter(): Router {
  const router = Router();

  router.get("/api/edith/memory-v2", (req, res) => {
    const options = {
      query: typeof req.query.query === "string" ? req.query.query : undefined,
      type: parseMemoryType(req.query.type),
      scope: parseMemoryScope(req.query.scope),
      namespace: typeof req.query.namespace === "string" ? req.query.namespace : undefined,
      includeSensitive: req.query.includeSensitive === "true",
      limit: parseMemoryLimit(req.query.limit, 50),
    };
    res.json({
      success: true,
      memories: options.query ? memoryService.search(options) : memoryService.list(options).slice(0, options.limit),
    });
  });

  router.post("/api/edith/memory-v2", (req, res) => {
    try {
      const conflicts = memoryService.conflicts(req.body ?? {});
      const memory = memoryService.upsert(req.body ?? {});
      obsidianVaultService.writeMemoryNote(memory);
      res.json({ success: true, memory, conflicts });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/api/edith/memory-v2/context", (req, res) => {
    const query = String(req.query.query ?? "").trim();
    if (!query) return res.status(400).json({ success: false, error: "query is required." });
    res.json({
      success: true,
      memories: memoryService.context(query, parseMemoryLimit(req.query.limit, 8)),
    });
  });

  router.post("/api/edith/memory-v2/merge", (req, res) => {
    const targetId = String(req.body?.targetId ?? "").trim();
    const sourceIds = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds.map(String) : [];
    if (!targetId || sourceIds.length === 0) return res.status(400).json({ success: false, error: "targetId and sourceIds are required." });
    const memory = memoryService.merge(targetId, sourceIds);
    if (!memory) return res.status(404).json({ success: false, error: "Target memory not found." });
    res.json({ success: true, memory });
  });

  router.get("/api/edith/memory-v2/export", (_req, res) => {
    res.json({ success: true, export: memoryService.exportSnapshot() });
  });

  router.get("/api/edith/memory-v2/:id", (req, res) => {
    const memory = memoryService.retrieve(req.params.id);
    res.status(memory ? 200 : 404).json({ success: Boolean(memory), memory });
  });

  router.patch("/api/edith/memory-v2/:id", (req, res) => {
    try {
      const memory = memoryService.update(req.params.id, req.body ?? {});
      res.status(memory ? 200 : 404).json({ success: Boolean(memory), memory });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete("/api/edith/memory-v2/:id", (req, res) => {
    const deleted = memoryService.forget(req.params.id);
    res.status(deleted ? 200 : 404).json({ success: deleted, deleted });
  });

  router.get("/api/edith/memories", (_req, res) => {
    const store = getEdithPersistenceStore();
    res.json({
      success: true,
      memories: store.listMemories?.() ?? [],
    });
  });

  router.post("/api/edith/memories", (req, res) => {
    const store = getEdithPersistenceStore();
    if (!store.upsertMemory) {
      return res.status(501).json({ success: false, error: "Memory persistence is unavailable." });
    }

    const { category = "custom", key, value, isSensitive = false } = req.body ?? {};
    if (!key || !value) {
      return res.status(400).json({ success: false, error: "key and value are required." });
    }

    const memory = {
      id: req.body?.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category,
      key,
      value,
      createdAt: Number(req.body?.createdAt ?? Date.now()),
      isSensitive: Boolean(isSensitive),
    };
    store.upsertMemory(memory);
    res.json({ success: true, memory });
  });

  return router;
}
