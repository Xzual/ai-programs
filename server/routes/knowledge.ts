import { Router } from "express";
import { knowledgeGraphService } from "../../src/edith/knowledgeGraphService";
import { knowledgeMapService } from "../../src/edith/knowledgeMapService";
import { obsidianVaultService } from "../../src/edith/obsidianVaultService";
import { ragService } from "../../src/edith/ragService";
import { readRecentAuditEvents } from "../../src/edith/audit";
import { getEdithPersistenceStore } from "../../src/edith/persistence";
import { taskService } from "../../src/edith/taskService";
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

  router.get("/api/knowledge/node/:id", (req, res) => {
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

  router.get("/api/knowledge/status", (_req, res) => {
    res.json({ success: true, status: obsidianVaultService.status() });
  });

  router.get("/api/knowledge-graph/stats", (_req, res) => {
    const graph = knowledgeGraphService.snapshot({ limit: 5000 });
    const status = obsidianVaultService.status();
    res.json({
      success: true,
      stats: {
        generatedAt: graph.generatedAt,
        nodes: graph.nodes.length,
        edges: graph.relationships.length,
        sources: graph.sources,
        metrics: graph.metrics,
        obsidian: {
          connectionStatus: status.connectionStatus,
          vaultPath: status.settings.vaultPath,
          indexedNotes: status.indexedNotes,
          indexedFolders: status.indexedFolders,
          lastSyncAt: status.lastSyncAt,
        },
      },
    });
  });

  router.get("/api/knowledge/graph", (req, res) => {
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

  router.post("/api/knowledge/sync", (_req, res) => {
    const reindex = obsidianVaultService.reindex();
    res.status(reindex.success ? 200 : 409).json({ success: reindex.success, reindex });
  });

  router.get("/api/knowledge/search", (req, res) => {
    const query = String(req.query.query ?? "").trim();
    if (!query) return res.status(400).json({ success: false, error: "query is required." });
    res.json({
      success: true,
      nodes: knowledgeGraphService.search(query, parseMemoryLimit(req.query.limit, 25)),
      retrieval: ragService.retrieve(query, parseMemoryLimit(req.query.limit, 8)),
    });
  });

  router.get("/api/knowledge/recent", (_req, res) => {
    const status = obsidianVaultService.status();
    res.json({ success: true, events: status.recentEvents, status });
  });

  router.get("/api/knowledge-graph/activity", (_req, res) => {
    const auditEvents = readRecentAuditEvents(40);
    const syncEvents = obsidianVaultService.status().recentEvents;
    const toolRuns = getEdithPersistenceStore().listToolRuns?.(40) ?? [];
    const tasks = taskService.listTasks().slice(0, 20);
    res.json({
      success: true,
      activity: {
        generatedAt: new Date().toISOString(),
        mode: "polling",
        realtime: "polling",
        auditEvents,
        syncEvents,
        toolRuns,
        tasks: tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          updatedAt: task.updatedAt ?? task.createdAt,
          timeline: task.timeline ?? [],
          agentActivity: task.agentActivity ?? [],
        })),
      },
    });
  });

  router.get("/api/knowledge-graph/live", (_req, res) => {
    const graph = knowledgeGraphService.snapshot({ limit: 5000 });
    const status = obsidianVaultService.status();
    res.json({
      success: true,
      live: {
        generatedAt: graph.generatedAt,
        transport: "polling",
        graph,
        status,
        activity: {
          auditEvents: readRecentAuditEvents(30),
          syncEvents: status.recentEvents,
          toolRuns: getEdithPersistenceStore().listToolRuns?.(30) ?? [],
        },
      },
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

  router.get("/api/obsidian/status", (_req, res) => {
    res.json({ success: true, status: obsidianVaultService.status() });
  });

  router.get("/api/obsidian/recent", (_req, res) => {
    const status = obsidianVaultService.status();
    res.json({ success: true, events: status.recentEvents, status });
  });

  router.get("/api/obsidian/search", (req, res) => {
    const query = String(req.query.query ?? "").trim();
    if (!query) return res.status(400).json({ success: false, error: "query is required." });
    res.json({
      success: true,
      nodes: knowledgeGraphService.search(query, parseMemoryLimit(req.query.limit, 25)),
      retrieval: ragService.retrieve(query, parseMemoryLimit(req.query.limit, 8)),
    });
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
    const exportStatus = obsidianVaultService.writeAgentNoteResult({
      agentId: String(req.body?.agentId ?? "agent"),
      kind,
      title,
      body,
    });
    res.status(exportStatus.exported ? 200 : 409).json({ success: exportStatus.exported, export: exportStatus, path: exportStatus.notePath });
  });

  router.post("/api/knowledge/write-note", (req, res) => {
    const type = String(req.body?.type ?? "").trim();
    let exportStatus;
    if (type === "conversation") {
      exportStatus = obsidianVaultService.writeConversationSummary({
        title: typeof req.body?.title === "string" ? req.body.title : undefined,
        summary: String(req.body?.summary ?? req.body?.body ?? ""),
        assistantPersona: typeof req.body?.assistantPersona === "string" ? req.body.assistantPersona : undefined,
        provider: typeof req.body?.provider === "string" ? req.body.provider : undefined,
        model: typeof req.body?.model === "string" ? req.body.model : undefined,
        tasks: Array.isArray(req.body?.tasks) ? req.body.tasks.map(String) : undefined,
        followUps: Array.isArray(req.body?.followUps) ? req.body.followUps.map(String) : undefined,
      });
    } else if (type === "project") {
      exportStatus = obsidianVaultService.writeProjectSummary({
        title: String(req.body?.title ?? "E.D.I.T.H."),
        overview: String(req.body?.overview ?? req.body?.body ?? ""),
        decisions: Array.isArray(req.body?.decisions) ? req.body.decisions.map(String) : undefined,
        roadmap: Array.isArray(req.body?.roadmap) ? req.body.roadmap.map(String) : undefined,
        risks: Array.isArray(req.body?.risks) ? req.body.risks.map(String) : undefined,
      });
    } else if (type === "research") {
      exportStatus = obsidianVaultService.writeResearchNote({
        topic: String(req.body?.topic ?? req.body?.title ?? "Research Note"),
        summary: String(req.body?.summary ?? req.body?.body ?? ""),
        sources: Array.isArray(req.body?.sources) ? req.body.sources.map(String) : undefined,
        uncertainty: typeof req.body?.uncertainty === "string" ? req.body.uncertainty : undefined,
        questions: Array.isArray(req.body?.questions) ? req.body.questions.map(String) : undefined,
      });
    } else if (type === "person" || type === "organization") {
      exportStatus = obsidianVaultService.writePersonOrOrganizationNote({
        kind: type,
        name: String(req.body?.name ?? req.body?.title ?? ""),
        context: String(req.body?.context ?? req.body?.body ?? ""),
        projects: Array.isArray(req.body?.projects) ? req.body.projects.map(String) : undefined,
        notes: Array.isArray(req.body?.notes) ? req.body.notes.map(String) : undefined,
      });
    } else if (type === "crypto_learning" || type === "trading") {
      exportStatus = obsidianVaultService.writeCryptoLearningNote({
        title: typeof req.body?.title === "string" ? req.body.title : undefined,
        symbol: typeof req.body?.symbol === "string" ? req.body.symbol : undefined,
        lesson: String(req.body?.lesson ?? req.body?.body ?? ""),
        observations: Array.isArray(req.body?.observations) ? req.body.observations.map(String) : undefined,
      });
    } else {
      return res.status(400).json({ success: false, error: "Unsupported note type.", export: { exported: false, errorCode: "INVALID_NOTE_TYPE" } });
    }
    res.status(exportStatus.exported ? 200 : 409).json({ success: exportStatus.exported, export: exportStatus });
  });

  return router;
}
