import { Router } from "express";
import { knowledgeGraphService } from "../../src/edith/knowledgeGraphService";
import { knowledgeMapService } from "../../src/edith/knowledgeMapService";
import { obsidianVaultService } from "../../src/edith/obsidianVaultService";
import { ragService } from "../../src/edith/ragService";
import { parseMemoryLimit } from "../utils/memoryParsing";

export function createKnowledgeRouter(): Router {
  const router = Router();

  router.get("/api/edith/knowledge-map", (_req, res) => {
    res.json({
      success: true,
      map: knowledgeMapService.snapshot(),
    });
  });

  router.get("/api/edith/knowledge/graph", (req, res) => {
    res.json({
      success: true,
      graph: knowledgeGraphService.snapshot({
        query: typeof req.query.query === "string" ? req.query.query : undefined,
        nodeType: typeof req.query.nodeType === "string" ? req.query.nodeType as any : undefined,
        relationshipType: typeof req.query.relationshipType === "string" ? req.query.relationshipType as any : undefined,
        folder: typeof req.query.folder === "string" ? req.query.folder : undefined,
        tag: typeof req.query.tag === "string" ? req.query.tag : undefined,
        source: typeof req.query.source === "string" ? req.query.source : undefined,
        limit: Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : undefined,
      }),
    });
  });

  router.get("/api/edith/knowledge/nodes/:id", (req, res) => {
    const node = knowledgeGraphService.findNode(req.params.id);
    if (!node) return res.status(404).json({ success: false, error: "Knowledge node not found." });
    res.json({ success: true, node });
  });

  router.get("/api/edith/knowledge/search", (req, res) => {
    const query = String(req.query.query ?? "").trim();
    if (!query) return res.status(400).json({ success: false, error: "query is required." });
    res.json({
      success: true,
      nodes: knowledgeGraphService.search(query, parseMemoryLimit(req.query.limit, 25)),
      retrieval: ragService.retrieve(query, parseMemoryLimit(req.query.limit, 8)),
    });
  });

  router.post("/api/edith/knowledge/reindex", (_req, res) => {
    res.json({ success: true, reindex: obsidianVaultService.reindex() });
  });

  router.get("/api/edith/knowledge/rag/status", (_req, res) => {
    res.json({ success: true, status: ragService.status() });
  });

  router.get("/api/edith/knowledge/rag/retrieve", (req, res) => {
    const query = String(req.query.query ?? "").trim();
    if (!query) return res.status(400).json({ success: false, error: "query is required." });
    res.json({ success: true, retrieval: ragService.retrieve(query, parseMemoryLimit(req.query.limit, 8)) });
  });

  router.get("/api/edith/obsidian/status", (_req, res) => {
    res.json({ success: true, status: obsidianVaultService.status() });
  });

  router.patch("/api/edith/obsidian/settings", (req, res) => {
    res.json({ success: true, settings: obsidianVaultService.updateSettings(req.body ?? {}), status: obsidianVaultService.status() });
  });

  router.post("/api/edith/obsidian/sync-now", (_req, res) => {
    res.json({ success: true, reindex: obsidianVaultService.reindex() });
  });

  router.post("/api/edith/obsidian/agent-notes", (req, res) => {
    const kind = String(req.body?.kind ?? "");
    if (kind !== "research" && kind !== "coding" && kind !== "meeting" && kind !== "trading") {
      return res.status(400).json({ success: false, error: "kind must be research, coding, meeting, or trading." });
    }
    const title = String(req.body?.title ?? "").trim();
    const body = String(req.body?.body ?? "").trim();
    if (!title || !body) return res.status(400).json({ success: false, error: "title and body are required." });
    const notePath = obsidianVaultService.writeAgentNote({
      agentId: String(req.body?.agentId ?? "agent"),
      kind,
      title,
      body,
    });
    res.json({ success: true, path: notePath });
  });

  return router;
}
