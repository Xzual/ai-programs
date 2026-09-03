import "dotenv/config";
import express from "express";
import path from "path";
import http from "http";
import { createServer as createViteServer } from "vite";
import { edithToolRegistry, executeEdithTool, getEdithToolHealth } from "./src/edith/serverRegistry";
import { listExternalSkillProjects } from "./src/edith/skills/catalog";
import { appendAuditEvent, createAuditEvent, readRecentAuditEvents } from "./src/edith/audit";
import { getEdithPersistenceStore } from "./src/edith/persistence";
import { intentService } from "./src/edith/intent";
import { agentRegistryService } from "./src/edith/agentRegistry";
import { capabilityService } from "./src/edith/capabilityService";
import { memoryService } from "./src/edith/memoryService";
import { modelRouterService } from "./src/edith/modelRouter";
import { buildChatSystemPrompt } from "./src/edith/chatContext";
import { obsidianVaultService } from "./src/edith/obsidianVaultService";
import { cryptoService } from "./src/edith/cryptoService";
import { KillSwitchActiveError, killSwitchService } from "./src/edith/killSwitch";
import { permissionService } from "./src/edith/permissionService";
import { visionObservationService } from "./src/edith/visionService";
import { computerActionService } from "./src/edith/computerActionService";
import { browserWorkflowService } from "./src/edith/browserWorkflowService";
import { interruptService } from "./src/edith/interruptService";
import { confidenceService, patternMemoryService, presenceContextService, sentimentContextService } from "./src/edith/contextSignals";
import { proactiveService } from "./src/edith/proactiveService";
import { design3dService } from "./src/edith/design3dService";
import { legacyToolForPermission } from "./src/edith/legacyToolPolicy";
import { localToolProbeService } from "./src/edith/localToolProbes";
import { sensitiveIntegrationService } from "./src/edith/sensitiveIntegrationService";
import { interactionSafetyService } from "./src/edith/interactionSafetyService";
import assistantProfiles from "./src/config/assistantProfiles.json";
import { getGeminiClient } from "./server/providers/gemini";
import { providerRegistry } from "./server/providers/registry";
import { ProviderError } from "./server/providers/types";
import { createCryptoRouter } from "./server/routes/crypto";
import { createHealthRouter } from "./server/routes/health";
import { createKnowledgeRouter } from "./server/routes/knowledge";
import { createKillSwitchRouter } from "./server/routes/killSwitch";
import { createMemoryRouter } from "./server/routes/memory";
import { createModelsRouter } from "./server/routes/models";
import { createPermissionsRouter } from "./server/routes/permissions";
import { createProvidersRouter } from "./server/routes/providers";
import { createTasksRouter } from "./server/routes/tasks";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use(createProvidersRouter());
app.use(createHealthRouter());
app.use(createCryptoRouter());
app.use(createModelsRouter());
app.use(createKnowledgeRouter());
app.use(createKillSwitchRouter());
app.use(createPermissionsRouter());
app.use(createTasksRouter());
app.use(createMemoryRouter());

app.post("/api/voice/tts", async (req, res) => {
  const { text, apiKey, voiceId = "pNInz6obpgDQGcFmaJgB" } = req.body ?? {};
  if (!text || !apiKey) {
    return res.status(400).json({
      success: false,
      error: "text and apiKey are required for Claude Voice connector.",
    });
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: String(text).slice(0, 4500),
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      return res.status(response.status).send(await response.text());
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/edith/tools", (_req, res) => {
  res.json({
    success: true,
    tools: edithToolRegistry.list(),
  });
});

app.get("/api/edith/tools/health", (_req, res) => {
  res.json({
    success: true,
    health: getEdithToolHealth(),
  });
});

app.get("/api/edith/runtime/probes", (_req, res) => {
  res.json({
    success: true,
    probes: localToolProbeService.list(),
    note: "Read-only probe. EDITH does not start Ollama, Blender, FreeCAD, solvers, or browser runtimes here.",
  });
});

app.get("/api/edith/interaction-safety", (_req, res) => {
  res.json({
    success: true,
    snapshot: interactionSafetyService.snapshot(),
  });
});

app.get("/api/edith/agents", (_req, res) => {
  res.json({
    success: true,
    agents: agentRegistryService.listAgents(),
  });
});

app.post("/api/edith/agents/route", (req, res) => {
  const objective = String(req.body?.objective ?? "").trim();
  if (!objective) return res.status(400).json({ success: false, error: "objective is required." });
  const rawRiskLevel = Number(req.body?.riskLevel ?? 1);
  const riskLevel = ([0, 1, 2, 3, 4, 5].includes(rawRiskLevel) ? rawRiskLevel : 1) as 0 | 1 | 2 | 3 | 4 | 5;
  const routes = agentRegistryService.routeTask({
    objective,
    riskLevel,
    toolsRequired: Array.isArray(req.body?.toolsRequired) ? req.body.toolsRequired : [],
    permissionsRequired: Array.isArray(req.body?.permissionsRequired) ? req.body.permissionsRequired : [],
  });
  res.json({ success: true, routes });
});

app.post("/api/edith/capabilities/assess", (req, res) => {
  const objective = String(req.body?.objective ?? "").trim();
  if (!objective) return res.status(400).json({ success: false, error: "objective is required." });
  const rawRiskLevel = Number(req.body?.riskLevel ?? 1);
  const riskLevel = ([0, 1, 2, 3, 4, 5].includes(rawRiskLevel) ? rawRiskLevel : 1) as 0 | 1 | 2 | 3 | 4 | 5;
  try {
    const assessment = capabilityService.assess({
      objective,
      actor: typeof req.body?.actor === 'string' ? req.body.actor : 'edith-dashboard',
      toolsRequired: Array.isArray(req.body?.toolsRequired) ? req.body.toolsRequired : [],
      permissionsRequired: Array.isArray(req.body?.permissionsRequired) ? req.body.permissionsRequired : [],
      riskLevel,
    });
    res.json({ success: true, assessment });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/edith/skill-catalog", (_req, res) => {
  res.json({
    success: true,
    projects: listExternalSkillProjects(),
  });
});

app.get("/api/edith/audit", (req, res) => {
  const limit = Number(req.query.limit ?? 100);
  res.json({
    success: true,
    events: readRecentAuditEvents(Number.isFinite(limit) ? limit : 100),
  });
});

app.get("/api/edith/tool-runs", (req, res) => {
  const limit = Number(req.query.limit ?? 100);
  const store = getEdithPersistenceStore();
  res.json({
    success: true,
    runs: store.listToolRuns?.(Number.isFinite(limit) ? limit : 100) ?? [],
  });
});

app.get("/api/edith/persistence", (_req, res) => {
  const store = getEdithPersistenceStore();
  res.json({
    success: true,
    kind: store.kind,
    paths: store.getPaths(),
  });
});

app.post("/api/edith/vision/observe", (req, res) => {
  const observation = visionObservationService.createObservation(req.body ?? {});
  res.json({ success: true, observation });
});

app.post("/api/edith/vision/compare", (req, res) => {
  if (!req.body?.previous || !req.body?.current) {
    return res.status(400).json({ success: false, error: "previous and current observations are required." });
  }
  const observation = visionObservationService.compare(req.body.previous, req.body.current);
  res.json({ success: true, observation });
});

app.post("/api/edith/computer/actions", (req, res) => {
  const result = computerActionService.execute(req.body ?? {}, "edith-api");
  res.status(result.success ? 200 : result.errorCode === "PERMISSION_DENIED" ? 403 : 400).json(result);
});

app.get("/api/edith/browser/workflows/capabilities", (_req, res) => {
  res.json({ success: true, capabilities: browserWorkflowService.capabilities() });
});

app.post("/api/edith/browser/workflows", async (req, res) => {
  const result = await browserWorkflowService.run(req.body ?? {}, "edith-api");
  res.status(result.success ? 200 : result.errorCode === "PERMISSION_DENIED" ? 403 : 400).json(result);
});

app.get("/api/edith/integrations/capabilities", (_req, res) => {
  res.json({ success: true, capabilities: sensitiveIntegrationService.capabilities() });
});

app.post("/api/edith/iot/feedback", (req, res) => {
  const result = sensitiveIntegrationService.run("iot", req.body ?? {}, "edith-api");
  res.status(result.success ? 200 : result.errorCode === "PERMISSION_DENIED" ? 403 : 400).json(result);
});

app.post("/api/edith/finance/trading/actions", (req, res) => {
  const result = sensitiveIntegrationService.run("finance", req.body ?? {}, "edith-api");
  res.status(result.success ? 200 : result.errorCode === "PERMISSION_DENIED" ? 403 : 400).json(result);
});

app.get("/api/edith/proactive/settings", (_req, res) => {
  res.json({ success: true, settings: proactiveService.getSettings() });
});

app.patch("/api/edith/proactive/settings", (req, res) => {
  res.json({ success: true, settings: proactiveService.updateSettings(req.body ?? {}) });
});

app.get("/api/edith/proactive/signals", (req, res) => {
  res.json({
    success: true,
    signals: proactiveService.listSignals({ includeDismissed: req.query.includeDismissed === "true" }),
  });
});

app.post("/api/edith/proactive/signals/:id/dismiss", (req, res) => {
  const signal = proactiveService.dismissSignal(req.params.id, "edith-api");
  res.status(signal ? 200 : 404).json({ success: Boolean(signal), signal });
});

app.post("/api/edith/proactive/check", (req, res) => {
  const signals = proactiveService.checkOnce({
    presence: req.body?.presence,
    sentiment: req.body?.sentiment,
  }, "edith-api");
  res.json({ success: true, signals, activeSignals: proactiveService.listSignals() });
});

app.post("/api/edith/context/sentiment", (req, res) => {
  res.json({ success: true, context: sentimentContextService.analyzeText(String(req.body?.text ?? "")) });
});

app.post("/api/edith/context/presence", (req, res) => {
  res.json({ success: true, context: presenceContextService.snapshot(req.body ?? {}) });
});

app.post("/api/edith/context/patterns/observe", (req, res) => {
  res.json({ success: true, pattern: patternMemoryService.observeCommand(String(req.body?.command ?? "")) });
});

app.post("/api/edith/confidence/check", (req, res) => {
  res.json({ success: true, check: confidenceService.check(req.body ?? {}) });
});

app.get("/api/edith/design3d/projects", (_req, res) => {
  res.json({
    success: true,
    projects: design3dService.listProjects(),
    engineReport: design3dService.engineReport(),
    architectureReport: design3dService.architectureReport(),
  });
});

app.post("/api/edith/design3d/projects", (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim();
  if (!prompt) return res.status(400).json({ success: false, error: "prompt is required." });
  const project = design3dService.createProject({
    name: typeof req.body?.name === "string" ? req.body.name : undefined,
    prompt,
  });
  res.json({
    success: true,
    project,
    engineReport: design3dService.engineReport(),
    architectureReport: design3dService.architectureReport(),
  });
});

app.get("/api/edith/design3d/architecture-report", (_req, res) => {
  res.json({ success: true, report: design3dService.architectureReport() });
});

app.post("/api/edith/design3d/projects/:id/snapshot", (req, res) => {
  const project = design3dService.snapshot(req.params.id, String(req.body?.reason ?? "Manual snapshot."));
  if (!project) return res.status(404).json({ success: false, error: "Project not found." });
  res.json({ success: true, project });
});

app.post("/api/edith/interrupt", (req, res) => {
  res.json({
    success: true,
    interrupt: interruptService.request({
      taskId: typeof req.body?.taskId === "string" ? req.body.taskId : undefined,
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
      requestedBy: "edith-api",
    }),
  });
});

app.delete("/api/edith/interrupt/:id", (req, res) => {
  const cleared = interruptService.clear(req.params.id, "edith-api");
  res.status(cleared ? 200 : 404).json({ success: cleared });
});

function extractExplicitMemory(text: string): { key: string; content: string } | undefined {
  const normalized = String(text ?? '').trim();
  if (!normalized) return undefined;
  const patterns = [
    /(?:şunu\s+)?hatırla(?:\s+ki)?\s*[:：-]?\s*(.+)$/i,
    /unutma(?:\s+ki)?\s*[:：-]?\s*(.+)$/i,
    /bunu\s+(?:hafızaya|belleğe)\s+(?:al|kaydet)\s*[:：-]?\s*(.+)$/i,
    /(?:remember that|remember|save this|save to memory)\s*[:：-]?\s*(.+)$/i,
  ];
  const content = patterns
    .map((pattern) => normalized.match(pattern)?.[1]?.trim())
    .find((candidate): candidate is string => Boolean(candidate && candidate.length >= 4));
  if (!content) return undefined;
  const cleaned = content.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (cleaned.length < 4) return undefined;
  const key = cleaned
    .split(/[.!?\n]/)[0]
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim() || 'Kullanıcı hafıza notu';
  return { key, content: cleaned };
}

function captureExplicitMemory(text: string, userName: string) {
  const extracted = extractExplicitMemory(text);
  if (!extracted) return undefined;
  const memory = memoryService.upsert({
    type: 'semantic',
    scope: 'user',
    category: 'fact',
    key: extracted.key,
    content: extracted.content,
    source: 'chat-explicit-memory',
    provenance: `Explicit memory command from ${userName}.`,
    confidence: 0.92,
    importance: 0.72,
    sensitivity: 'internal',
  });
  obsidianVaultService.writeMemoryNote(memory);
  return memory;
}

// 3. Streaming Chat Endpoint
app.post("/api/chat", async (req, res) => {
  const {
    messages,
    provider = "ollama",
    model = "llama3.2",
    ollamaUrl = "http://localhost:11434",
    temperature = 0.7,
    systemPrompt = "Sen EDITH içinde çalışan seçili AI asistan personasısın. Türkçe konuş ve yardımsever ol.",
    memories = [],
    memoryEnabled = true,
    userName = "Kullanıcı",
    assistantPersona = "jarvis",
  } = req.body;

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const lastUserMessage = [...messages].reverse().find((m: any) => m.sender === "user")?.text ?? "";
  const capturedMemory = memoryEnabled ? captureExplicitMemory(lastUserMessage, userName) : undefined;
  const activeAssistant = (assistantProfiles as Array<{ id: string; name: string; systemPrompt?: string; greetingStyle?: string }>).find(
    (profile) => profile.id === assistantPersona
  ) ?? (assistantProfiles as Array<{ id: string; name: string; systemPrompt?: string; greetingStyle?: string }>)[0];

  const interrupt = interruptService.detectCommand(lastUserMessage);
  if (interrupt) {
    sendEvent({ text: `İptal sinyali alındı. Aktif görev döngüsü bir sonraki güvenli noktada durdurulacak.\nInterrupt ID: ${interrupt.id}`, done: true });
    return res.end();
  }

  const personaSystemPrompt = activeAssistant.systemPrompt || systemPrompt;
  if (capturedMemory) {
    sendEvent({
      text: `Belleğe kaydettim: ${capturedMemory.key}\n`,
      done: false,
      memoryId: capturedMemory.id,
    });
  }

  const { fullSystem } = buildChatSystemPrompt({
    systemPrompt: personaSystemPrompt,
    userName,
    memories: capturedMemory ? [capturedMemory, ...memories] : memories,
    memoryEnabled,
    lastUserMessage,
  });

  const providerSnapshots = await providerRegistry.health({
    ollamaUrl,
    timeoutMs: 2500,
  });
  const providerSnapshotById = new Map(providerSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const routerHealth = (providerId: "ollama" | "gemini" | "openai" | "anthropic" | "openrouter" | "local" | "mock") => {
    const snapshot = providerSnapshotById.get(providerId);
    if (!snapshot) return providerId === "mock" ? "available" : "unavailable";
    return snapshot.available ? "available" : "unavailable";
  };
  const matchesProviderModel = (requestedModel: string, availableModel: string) =>
    availableModel === requestedModel || availableModel === `${requestedModel}:latest`;
  const resolveProviderModel = (providerId: "ollama" | "gemini" | "mock", selectedModel: string) => {
    const snapshot = providerSnapshotById.get(providerId);
    if (!snapshot) return selectedModel;
    if (selectedModel === "auto") return snapshot.defaultModel;
    const modelMatch = snapshot.models.find((candidate) => matchesProviderModel(selectedModel, candidate.id));
    return modelMatch?.id ?? snapshot.defaultModel;
  };

  const modelRoute = modelRouterService.route({
    requestedProvider: provider,
    model,
    taskType: "conversation",
    modality: "text",
    privacyPreference: provider === "mock" ? "offline_only" : "local_first",
    providerHealth: {
      ollama: routerHealth("ollama"),
      gemini: routerHealth("gemini"),
      openai: process.env.OPENAI_API_KEY ? "unknown" : "unavailable",
      anthropic: process.env.ANTHROPIC_API_KEY ? "unknown" : "unavailable",
      openrouter: process.env.OPENROUTER_API_KEY ? "unknown" : "unavailable",
      local: "unknown",
      mock: "available",
    },
  });
  const initialResolvedModel = resolveProviderModel(modelRoute.selectedProvider as "ollama" | "gemini" | "mock", modelRoute.selectedModel);
  const initialSnapshot = providerSnapshotById.get(modelRoute.selectedProvider);
  sendEvent({
    requestedProvider: provider,
    requestedModel: model,
    resolvedProvider: modelRoute.selectedProvider,
    resolvedModel: initialResolvedModel,
    provider: modelRoute.selectedProvider,
    model: initialResolvedModel,
    fallbackUsed: modelRoute.selectedProvider !== provider,
    fallbackProvider: modelRoute.selectedProvider !== provider ? modelRoute.selectedProvider : undefined,
    fallbackModel: modelRoute.selectedProvider !== provider ? initialResolvedModel : undefined,
    providerStatus: "pending",
    configured: initialSnapshot?.configured,
    available: initialSnapshot?.available,
    healthy: initialSnapshot?.healthy,
    modelAvailable: initialSnapshot?.modelAvailable,
    errorCode: initialSnapshot?.errorCode,
  });

  const intent = intentService.understand(lastUserMessage);
  const toolRoute = intent.route;
  if (intent.kind !== "conversation" && toolRoute) {
    sendEvent({ text: `${toolRoute.summary}\n`, done: false });
    const result = await executeEdithTool(toolRoute.toolId, toolRoute.args, {
      actor: "edith-chat-router",
    });
    if (result.success) {
      sendEvent({
        text: `\n✅ Tool çalıştı: ${toolRoute.toolId}\n\n${result.result ?? "İşlem tamamlandı."}`,
        done: false,
      });
    } else {
      sendEvent({
        text: `\n⚠️ Tool çalıştırılamadı: ${toolRoute.toolId}\n${result.error ?? "Bilinmeyen hata."}`,
        done: false,
      });
    }
    sendEvent({
      done: true,
      toolId: toolRoute.toolId,
      auditEventId: result.auditEventId,
      intent: {
        kind: intent.kind,
        confidence: intent.confidence,
        requiresTask: intent.requiresTask,
        requiresPlanning: intent.requiresPlanning,
        rationale: intent.rationale,
      },
    });
    return res.end();
  }

  const providerMessages = [
    { role: "system" as const, content: fullSystem },
    ...messages.map((m: any) => ({
      role: m.sender === "user" ? "user" as const : "assistant" as const,
      content: m.text,
    })),
  ];

  const streamOllama = async (selectedModel: string): Promise<boolean> => {
    const ollama = providerRegistry.get("ollama");
    if (!ollama) return false;
    try {
      sendEvent({
        provider: "ollama",
        model: selectedModel,
        resolvedProvider: "ollama",
        resolvedModel: selectedModel,
        fallbackUsed: provider !== "ollama",
        fallbackProvider: provider !== "ollama" ? "ollama" : undefined,
        fallbackModel: provider !== "ollama" ? selectedModel : undefined,
        providerStatus: "attempting",
      });

      const startedAt = Date.now();
      for await (const chunk of ollama.stream({
        model: selectedModel,
        messages: providerMessages,
        temperature,
        timeoutMs: 30000,
        ollamaUrl,
      })) {
        if (chunk.text) sendEvent({ text: chunk.text, done: false });
      }
      sendEvent({ done: true, provider: "ollama", model: selectedModel, providerStatus: "available", latencyMs: Date.now() - startedAt });
      res.end();
      return true;
    } catch (err: any) {
      const errorCode = err instanceof ProviderError ? err.code : "provider_unavailable";
      console.log("Ollama provider unavailable, falling back gracefully...", errorCode);
      sendEvent({
        warning: "Ollama local API unreachable. Switch to Gemini/Mock mode or start Ollama service.",
        provider: "ollama",
        model: selectedModel,
        providerStatus: errorCode === "model_unavailable" ? "failed" : "unavailable",
        errorCode,
      });
      return false;
    }
  };

  const streamGemini = async (selectedModel: string): Promise<boolean> => {
    const gemini = providerRegistry.get("gemini");
    if (!gemini?.metadata().configured) return false;
    try {
      sendEvent({
        provider: "gemini",
        model: selectedModel,
        resolvedProvider: "gemini",
        resolvedModel: selectedModel,
        fallbackUsed: provider !== "gemini",
        fallbackProvider: provider !== "gemini" ? "gemini" : undefined,
        fallbackModel: provider !== "gemini" ? selectedModel : undefined,
        providerStatus: "attempting",
      });

      const startedAt = Date.now();
      for await (const chunk of gemini.stream({
        model: selectedModel,
        messages: providerMessages,
        temperature,
      })) {
        if (chunk.text) sendEvent({ text: chunk.text, done: false });
      }
      sendEvent({ done: true, provider: "gemini", model: selectedModel, providerStatus: "available", latencyMs: Date.now() - startedAt });
      res.end();
      return true;
    } catch (geminiErr: any) {
      const errorCode = geminiErr instanceof ProviderError ? geminiErr.code : "unknown_error";
      console.error("Gemini provider error:", errorCode);
      sendEvent({
        warning: "Gemini provider unavailable. Falling back to mock/degraded mode.",
        provider: "gemini",
        model: selectedModel,
        providerStatus: errorCode === "configuration_required" ? "configuration_required" : "failed",
        errorCode,
      });
      return false;
    }
  };

  for (const candidate of modelRoute.candidates) {
    if (candidate.skippedReason || candidate.provider === "mock") continue;
    const candidateModel = resolveProviderModel(candidate.provider as "ollama" | "gemini" | "mock", candidate.model);
    if (candidate.provider === "ollama" && await streamOllama(candidateModel)) return;
    if (candidate.provider === "gemini" && await streamGemini(candidateModel)) return;
  }

  // Fallback 2: Intelligent Local AI Assistant Mock Engine
  const lastUserMsg = messages[messages.length - 1]?.text || "Merhaba";
  const mockResponses = generateMockResponse(lastUserMsg, userName, memories, activeAssistant.name);
  sendEvent({
    provider: "mock",
    model: "edith-mock",
    resolvedProvider: "mock",
    resolvedModel: "edith-mock",
    fallbackUsed: provider !== "mock",
    fallbackProvider: provider !== "mock" ? "mock" : undefined,
    fallbackModel: provider !== "mock" ? "edith-mock" : undefined,
    providerStatus: "degraded",
  });

  for (let i = 0; i < mockResponses.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 30 + Math.random() * 40));
    sendEvent({ text: mockResponses[i], done: false });
  }

  sendEvent({ done: true, provider: "mock", model: "edith-mock", providerStatus: "degraded" });
  res.end();
});

// Helper for realistic fallback assistant response generator
function generateMockResponse(prompt: string, userName: string, memories: any[], assistantName = "JARVIS"): string[] {
  const lower = prompt.toLowerCase();
  let fullText = "";

  if (lower.includes("merhaba") || lower.includes("selam")) {
    fullText = `Merhaba ${userName}. Ben ${assistantName}; EDITH içindeki aktif kişisel asistanınızım. Size nasıl yardımcı olabilirim?`;
  } else if (lower.includes("dosya") || lower.includes("klasör")) {
    fullText = `Yerel dosya sisteminizdeki güvenli çalışma alanında kayıtlı dosyaları 'Automations' ekranından görüntüleyebilir veya analiz etmemi isteyebilirsiniz.`;
  } else if (lower.includes("hatırla") || lower.includes("bellek")) {
    fullText = `Anlaşıldı! Bu bilgiyi kişisel bellek sistemime ekliyorum. Memory ekranından tüm kayıtlı tercihlerinizi kontrol edebilirsiniz.`;
  } else if (lower.includes("kimsin") || lower.includes("edith") || lower.includes(assistantName.toLocaleLowerCase("tr-TR"))) {
    fullText = `Ben ${assistantName}. EDITH kişisel AI sistemi içinde çalışan, seçili persona ve model katmanından bağımsız bir asistan profilindeyim.`;
  } else {
    fullText = `Anladım "${prompt}". Bu isteğinizi yerel işleme yeteneklerimle değerlendiriyorum. Ollama veya Gemini servisleriniz bağlandığında daha kapsamlı model yanıtları alabilirsiniz.`;
  }

  // Split into small character chunks for natural typing animation
  const chunks: string[] = [];
  const words = fullText.split(" ");
  for (const word of words) {
    chunks.push(word + " ");
  }
  return chunks;
}

// 4. Tools Execution API — Mark-L skill'leri dahil genişletilmiş araç seti
app.post("/api/tools/execute", async (req, res) => {
  const { toolId, args = {} } = req.body;

  // ── Yardımcı: Gemini metin üretimi ──────────────────────────────────────
  async function geminiGenerate(prompt: string): Promise<string> {
    const gemini = providerRegistry.get("gemini");
    if (!gemini?.metadata().configured) throw new Error("Gemini API anahtarı tanımlı değil.");
    const result = await gemini.generate({
      messages: [{ role: "user", content: prompt }],
    });
    return result.text;
  }

  // ── Yardımcı: DuckDuckGo arama (fetch tabanlı) ───────────────────────────
  async function ddgSearch(query: string, max = 5): Promise<Array<{ title: string; snippet: string; url: string }>> {
    const encoded = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1`;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      const data = await r.json() as any;
      const results: Array<{ title: string; snippet: string; url: string }> = [];
      if (data.AbstractText) results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL || "" });
      for (const rel of (data.RelatedTopics || []).slice(0, max - 1)) {
        if (rel.Text) results.push({ title: rel.Text.slice(0, 60), snippet: rel.Text, url: rel.FirstURL || "" });
      }
      return results;
    } catch {
      return [];
    }
  }

  // ── Yardımcı: os-benzeri sistem metrikleri (Node built-in) ───────────────
  function getSystemMetrics(): Record<string, any> {
    const os = require("os") as typeof import("os");
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const uptime = os.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    return {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpu: { model: cpus[0]?.model ?? "N/A", cores: cpus.length },
      memory: {
        total: `${(totalMem / 1024 ** 3).toFixed(1)} GB`,
        used: `${(usedMem / 1024 ** 3).toFixed(1)} GB`,
        free: `${(freeMem / 1024 ** 3).toFixed(1)} GB`,
        usagePercent: `${((usedMem / totalMem) * 100).toFixed(1)}%`,
      },
      uptime: `${h}s ${m}d`,
      nodeVersion: process.version,
    };
  }

  const edithTool = edithToolRegistry.get(toolId);
  if (edithTool) {
    const result = await executeEdithTool(toolId, args as Record<string, unknown>, {
      actor: "edith-dashboard",
    });
    const blockedByKillSwitch = result.structuredOutput?.disabledCapability === 'tool_execution';
    return res.status(result.success ? 200 : blockedByKillSwitch ? 423 : 403).json(result);
  }

  try {
    killSwitchService.assertAllowed('tool_execution', 'edith-dashboard');
  } catch (error) {
    if (error instanceof KillSwitchActiveError) {
      return res.status(423).json({
        success: false,
        toolId,
        error: error.message,
        killSwitch: error.state,
      });
    }
    throw error;
  }

  const legacyTool = legacyToolForPermission(String(toolId), args as Record<string, any>);
  if (legacyTool) {
    const decision = permissionService.decideToolExecution({
      tool: legacyTool,
      actor: 'edith-dashboard',
      authorizedPermissions: Array.isArray(req.body?.authorizedPermissions)
        ? req.body.authorizedPermissions.map(String)
        : undefined,
    });
    if (decision.status === 'DENY') {
      appendAuditEvent(createAuditEvent({
        actor: 'edith-dashboard',
        action: 'legacy_tool.permission_denied',
        toolId: legacyTool.id,
        authorization: 'denied',
        riskLevel: decision.riskLevel,
        result: 'denied',
        message: decision.rationale,
      }));
      return res.status(403).json({
        success: false,
        toolId,
        error: decision.rationale,
        errorCode: 'PERMISSION_DENIED',
        structuredOutput: { permissionDecision: decision },
      });
    }
  }

  switch (toolId) {

    // ════════════════════════════════════════════════════════════════════════
    // MEVCUT ARAÇLAR
    // ════════════════════════════════════════════════════════════════════════

    case "list_dir": {
      const dirPath = args.path || "/workspace/documents";
      return res.json({
        success: true,
        toolId,
        result: JSON.stringify({
          path: dirPath,
          files: [
            { name: "notlar.txt",       type: "file",      size: "2.4 KB",  modified: "2026-08-12" },
            { name: "proje_ozeti.md",   type: "file",      size: "14.1 KB", modified: "2026-08-11" },
            { name: "veri_analizi.csv", type: "file",      size: "88.0 KB", modified: "2026-08-10" },
            { name: "yedekler",         type: "directory", items: 3,        modified: "2026-08-01" },
          ],
        }, null, 2),
      });
    }

    case "read_file": {
      const fileName = args.fileName || "notlar.txt";
      return res.json({
        success: true, toolId,
        result: `[OKUNDU: ${fileName}]\n\nEDITH Sistem Notları:\n- Yerel Ollama LLM yapılandırması tamamlandı.\n- Bellek ve ses modülleri aktif.\n- Güvenli araç izinleri kullanıcı onayına bağlıdır.`,
      });
    }

    case "export_markdown": {
      return res.json({
        success: true, toolId,
        result: `# EDITH Sohbet Özeti\n\nTarih: ${new Date().toLocaleString("tr-TR")}\n\n## Özet\nSohbet oturumu başarıyla Markdown formatında dışa aktarıldı.`,
      });
    }

    case "schedule_reminder": {
      const text = args.reminderText || "EDITH Görev Takibi";
      const time = args.time || "10 dakika sonra";
      return res.json({
        success: true, toolId,
        result: `✅ Zamanlanmış Hatırlatıcı Oluşturuldu\n\nMesaj : "${text}"\nZaman : ${time}\nDurum : Aktif`,
      });
    }

    case "summarize_analytics": {
      return res.json({
        success: true, toolId,
        result: JSON.stringify({
          toplamSohbet: 42,
          toplamIstem: 189,
          ortalamaYanitSuresi: "1.2s",
          kullanilanModel: "llama3.2 (Yerel)",
          bellekOgesiSayisi: 8,
        }, null, 2),
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // MARK-L'DEN GELEN YENİ SKILL'LER
    // ════════════════════════════════════════════════════════════════════════

    // ── WEB SEARCH ──────────────────────────────────────────────────────────
    case "web_search": {
      const query  = (args.query || "").trim();
      const mode   = (args.mode  || "search").toLowerCase();
      if (!query) return res.json({ success: false, error: "Arama sorgusu boş olamaz." });

      try {
        let result = "";

        if (mode === "research") {
          // Gemini grounded research
          result = await geminiGenerate(
            `Comprehensive, detailed explanation of: "${query}". Include key facts, background context, and current state. Respond in Turkish.`
          );
        } else if (mode === "news") {
          // Gemini ile güncel haber
          try {
            result = await geminiGenerate(`Latest news today about: "${query}". Return 5 recent headlines with brief descriptions. Respond in Turkish.`);
          } catch {
            const hits = await ddgSearch(`${query} news`, 6);
            result = hits.length
              ? hits.map((h, i) => `${i + 1}. **${h.title}**\n   ${h.snippet}\n   ${h.url}`).join("\n\n")
              : `"${query}" için haber bulunamadı.`;
          }
        } else if (mode === "price") {
          result = await geminiGenerate(`Current price of "${query}" — how much does it cost today? Give specific prices if available. Respond in Turkish.`);
        } else if (mode === "compare") {
          const items = Array.isArray(args.items) && args.items.length ? args.items : [query];
          result = await geminiGenerate(`Compare these items: ${items.join(" vs ")}. Give key differences, pros/cons. Respond in Turkish.`);
        } else {
          // Default search — try Gemini first, DDG fallback
          try {
            result = await geminiGenerate(`Answer this search query in detail: "${query}". Be factual and concise. Respond in Turkish.`);
          } catch {
            const hits = await ddgSearch(query, 6);
            if (hits.length) {
              result = `🔍 "${query}" için arama sonuçları:\n\n` +
                hits.map((h, i) => `${i + 1}. **${h.title}**\n   ${h.snippet}\n   ${h.url}`).join("\n\n");
            } else {
              result = `Arama başarısız. Gemini API anahtarını kontrol edin veya farklı bir sorgu deneyin.`;
            }
          }
        }

        return res.json({ success: true, toolId, result });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Arama hatası: ${e.message}` });
      }
    }

    // ── SYSTEM MONITOR ──────────────────────────────────────────────────────
    case "system_monitor": {
      try {
        const metrics = getSystemMetrics();
        return res.json({
          success: true, toolId,
          result: JSON.stringify(metrics, null, 2),
        });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Sistem metrikleri alınamadı: ${e.message}` });
      }
    }

    // ── WEATHER REPORT ──────────────────────────────────────────────────────
    case "weather_report": {
      const city = (args.city || "Istanbul").trim();
      const lang = args.lang || "tr";
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 8000);
        const wttrRes = await fetch(
          `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=${lang}`,
          { signal: ctrl.signal }
        );
        clearTimeout(tid);

        if (wttrRes.ok) {
          const data = await wttrRes.json() as any;
          const cur  = data.current_condition?.[0] ?? {};
          const area = data.nearest_area?.[0];
          const loc  = area?.areaName?.[0]?.value ?? city;
          const country = area?.country?.[0]?.value ?? "";
          const desc = (lang === "tr"
            ? cur.lang_tr?.[0]?.value
            : cur.weatherDesc?.[0]?.value) ?? "Bilinmiyor";
          const tempC     = cur.temp_C      ?? "?";
          const feelsLike = cur.FeelsLikeC  ?? "?";
          const humidity  = cur.humidity    ?? "?";
          const wind      = cur.windspeedKmph ?? "?";
          const uv        = cur.uvIndex      ?? "?";

          const tomorrow = data.weather?.[1];
          const tomorrowHigh = tomorrow?.maxtempC ?? "?";
          const tomorrowLow  = tomorrow?.mintempC ?? "?";
          const tomorrowDesc = (lang === "tr"
            ? tomorrow?.hourly?.[4]?.lang_tr?.[0]?.value
            : tomorrow?.hourly?.[4]?.weatherDesc?.[0]?.value) ?? "";

          const result =
`📍 ${loc}, ${country}
🌡️  Sıcaklık    : ${tempC}°C  (Hissedilen: ${feelsLike}°C)
☁️  Durum       : ${desc}
💧 Nem          : %${humidity}
💨 Rüzgar       : ${wind} km/s
☀️  UV İndeksi  : ${uv}

📅 Yarın: ${tomorrowLow}°C – ${tomorrowHigh}°C${tomorrowDesc ? `  ${tomorrowDesc}` : ""}`;

          return res.json({ success: true, toolId, result });
        }
        throw new Error(`wttr.in HTTP ${wttrRes.status}`);
      } catch (e: any) {
        // Fallback: Gemini ile hava durumu
        try {
          const result = await geminiGenerate(`What is the current weather in ${city}? Give temperature, conditions, and tomorrow's forecast. Respond in Turkish.`);
          return res.json({ success: true, toolId, result });
        } catch {
          return res.json({ success: false, toolId, error: `Hava durumu alınamadı: ${e.message}` });
        }
      }
    }

    // ── FILE PROCESSOR ──────────────────────────────────────────────────────
    case "file_processor": {
      const filePath   = (args.file_path || "").trim();
      const action     = (args.action || "summarize").toLowerCase();
      const instruction = args.instruction || "";

      if (!filePath) return res.json({ success: false, error: "Dosya yolu boş olamaz." });

      try {
        const fs   = require("fs") as typeof import("fs");
        const path = require("path") as typeof import("path");

        if (!fs.existsSync(filePath)) {
          return res.json({ success: false, toolId, error: `Dosya bulunamadı: ${filePath}` });
        }

        const ext  = path.extname(filePath).toLowerCase().replace(".", "");
        const stat = fs.statSync(filePath);
        const sizeMB = (stat.size / 1024 / 1024).toFixed(2);

        // Metin tabanlı dosyalar — doğrudan oku + Gemini
        const textExts = ["txt", "md", "rst", "log", "csv", "json", "xml", "html", "css", "js", "ts", "py", "java", "cs", "go", "rs", "rb", "php"];
        const codeExts = ["py", "js", "ts", "jsx", "tsx", "java", "c", "cpp", "cs", "go", "rs", "rb", "php", "sh", "bash", "ps1", "sql"];

        if (textExts.includes(ext)) {
          const MAX_CHARS = 12000;
          const rawContent = fs.readFileSync(filePath, "utf-8").slice(0, MAX_CHARS);
          const isCode = codeExts.includes(ext);

          let prompt = "";
          if (instruction) {
            prompt = `${instruction}\n\nDosya içeriği (${ext.toUpperCase()}):\n\`\`\`\n${rawContent}\n\`\`\`\nTürkçe yanıt ver.`;
          } else {
            const actionPrompts: Record<string, string> = {
              summarize:    `Aşağıdaki ${isCode ? "kod" : "metin"} dosyasını Türkçe özetle:\n\n${rawContent}`,
              explain:      `Aşağıdaki kodu Türkçe satır satır açıkla:\n\n${rawContent}`,
              review:       `Aşağıdaki kodu incele, iyileştirme önerileri ve potansiyel hataları Türkçe listele:\n\n${rawContent}`,
              fix:          `Aşağıdaki koddaki hataları tespit et ve düzeltilmiş versiyonu yaz:\n\n${rawContent}`,
              word_count:   ``,
              extract_text: `Aşağıdaki içerikten tüm metni çıkar ve düzenle:\n\n${rawContent}`,
              analyze:      `Aşağıdaki veriyi detaylı analiz et, istatistikler ve önemli bulguları Türkçe sun:\n\n${rawContent}`,
              validate:     `Aşağıdaki ${ext.toUpperCase()} verisinin geçerliliğini kontrol et, hataları listele:\n\n${rawContent}`,
            };

            if (action === "word_count") {
              const words = rawContent.split(/\s+/).filter(Boolean).length;
              const chars = rawContent.length;
              const lines = rawContent.split("\n").length;
              return res.json({
                success: true, toolId,
                result: `📄 **${path.basename(filePath)}**\n\nKelime : ${words}\nKarakter: ${chars}\nSatır  : ${lines}\nBoyut  : ${sizeMB} MB`,
              });
            }

            prompt = actionPrompts[action] ?? `Bu dosyayı analiz et:\n\n${rawContent}`;
          }

          const aiResult = await geminiGenerate(prompt);
          return res.json({ success: true, toolId, result: `📄 **${path.basename(filePath)}** (${sizeMB} MB)\n\n${aiResult}` });
        }

        // İkili dosyalar — meta bilgi ver
        const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];
        const pdfExts   = ["pdf"];
        const audioExts = ["mp3", "wav", "ogg", "m4a", "aac", "flac"];
        const videoExts = ["mp4", "avi", "mov", "mkv", "webm"];
        const archiveExts = ["zip", "rar", "tar", "gz", "7z"];

        if (imageExts.includes(ext)) {
          return res.json({ success: true, toolId,
            result: `🖼️ **${path.basename(filePath)}** — Görüntü Dosyası\nBoyut: ${sizeMB} MB\nFormat: ${ext.toUpperCase()}\n\n⚠️ Görüntü analizi (OCR/describe) için Gemini Vision API gereklidir. GEMINI_API_KEY tanımlıysa tam destek sağlanır.` });
        }
        if (pdfExts.includes(ext)) {
          return res.json({ success: true, toolId,
            result: `📕 **${path.basename(filePath)}** — PDF Dosyası\nBoyut: ${sizeMB} MB\n\n⚠️ PDF özet/metin çıkarma için 'pdf-parse' npm paketi gereklidir: npm install pdf-parse` });
        }
        if (audioExts.includes(ext)) {
          return res.json({ success: true, toolId,
            result: `🎵 **${path.basename(filePath)}** — Ses Dosyası\nBoyut: ${sizeMB} MB\nFormat: ${ext.toUpperCase()}\n\n⚠️ Transkripsiyon için Whisper entegrasyonu gereklidir.` });
        }
        if (videoExts.includes(ext)) {
          return res.json({ success: true, toolId,
            result: `🎬 **${path.basename(filePath)}** — Video Dosyası\nBoyut: ${sizeMB} MB\nFormat: ${ext.toUpperCase()}\n\n⚠️ Video işleme için ffmpeg kurulu olmalı.` });
        }
        if (archiveExts.includes(ext)) {
          return res.json({ success: true, toolId,
            result: `📦 **${path.basename(filePath)}** — Arşiv Dosyası\nBoyut: ${sizeMB} MB\nFormat: ${ext.toUpperCase()}\n\n⚠️ Arşiv işleme için uygun npm paketi gereklidir.` });
        }

        return res.json({ success: false, toolId, error: `Desteklenmeyen dosya türü: .${ext}` });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Dosya işleme hatası: ${e.message}` });
      }
    }

    // ── CODE HELPER ─────────────────────────────────────────────────────────
    case "code_helper": {
      const action      = (args.action || "write").toLowerCase();
      const description = (args.description || "").trim();
      const language    = args.language || "python";
      const filePath    = (args.file_path || "").trim();
      const code        = (args.code || "").trim();

      if (!description && !filePath && !code) {
        return res.json({ success: false, error: "Açıklama, dosya yolu veya kod girilmedi." });
      }

      try {
        let prompt = "";
        let existingCode = code;

        // Dosya varsa oku
        if (filePath && !existingCode) {
          try {
            const fs = require("fs") as typeof import("fs");
            if (fs.existsSync(filePath)) existingCode = fs.readFileSync(filePath, "utf-8").slice(0, 12000);
          } catch { /* ignore */ }
        }

        const prompts: Record<string, string> = {
          write:    `Write clean, well-commented ${language} code for: "${description}". Return only the code with a brief explanation in Turkish.`,
          edit:     `Edit this ${language} code as instructed: "${description}"\n\nCode:\n\`\`\`${language}\n${existingCode}\n\`\`\`\nReturn the improved code and explain changes in Turkish.`,
          explain:  `Explain this ${language} code in detail in Turkish:\n\`\`\`${language}\n${existingCode || description}\n\`\`\``,
          review:   `Code review for this ${language} code. List bugs, improvements, security issues in Turkish:\n\`\`\`${language}\n${existingCode || description}\n\`\`\``,
          fix:      `Fix all bugs and errors in this ${language} code. Return fixed code and list what was fixed in Turkish:\n\`\`\`${language}\n${existingCode || description}\n\`\`\``,
          optimize: `Optimize this ${language} code for performance and readability. Return optimized code and explain changes in Turkish:\n\`\`\`${language}\n${existingCode || description}\n\`\`\``,
          run:      ``,
          build:    `Design and write a complete, working ${language} project for: "${description}". Include all necessary files and explain the structure in Turkish.`,
        };

        if (action === "run" && filePath) {
          // Dosyayı child_process ile çalıştır
          const { execFile } = require("child_process") as typeof import("child_process");
          const runners: Record<string, string> = {
            python: "python", javascript: "node", typescript: "npx ts-node", bash: "bash",
          };
          const runner = runners[language] || "python";
          const runnerArgs = language === "typescript" ? ["ts-node", filePath] : [filePath];
          const cmd = language === "typescript" ? "npx" : runner;

          return new Promise<void>((resolve) => {
            execFile(cmd, language === "typescript" ? runnerArgs : [filePath], { timeout: 30000 }, (err, stdout, stderr) => {
              const output = stdout || stderr || (err ? err.message : "Çıktı yok.");
              res.json({
                success: !err || !!stdout,
                toolId,
                result: `▶️ **Çalıştırıldı:** ${filePath}\n\n\`\`\`\n${output.slice(0, 4000)}\n\`\`\``,
              });
              resolve();
            });
          });
        }

        prompt = prompts[action] ?? `Help with this ${language} code request: "${description}"`;
        const aiResult = await geminiGenerate(prompt);
        return res.json({ success: true, toolId, result: aiResult });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Kod yardımcısı hatası: ${e.message}` });
      }
    }

    // ── DEV AGENT ───────────────────────────────────────────────────────────
    case "dev_agent": {
      const description = (args.description || "").trim();
      const language    = args.language || "python";
      const projectName = (args.project_name || "edith_project").trim().replace(/[^\w-]/g, "_");

      if (!description) return res.json({ success: false, error: "Proje açıklaması gereklidir." });

      try {
        // 1. Plan
        const planPrompt = `You are a senior software architect. Create a minimal project plan as JSON for:
Language: ${language}
Description: ${description}

Return ONLY valid JSON:
{
  "project_name": "snake_case_name",
  "entry_point": "main.py",
  "files": [
    { "path": "main.py", "description": "what it does", "imports": [] }
  ],
  "run_command": "python main.py",
  "dependencies": ["requests"]
}`;

        const planRaw = await geminiGenerate(planPrompt);
        const jsonMatch = planRaw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Plan JSON parse hatası");

        const plan = JSON.parse(jsonMatch[0]);
        const projName = plan.project_name || projectName;
        const files    = plan.files || [];
        const deps     = plan.dependencies || [];

        // 2. Her dosyayı yaz
        const os     = require("os") as typeof import("os");
        const fsNode = require("fs") as typeof import("fs");
        const pathNode = require("path") as typeof import("path");
        const projectDir = pathNode.join(os.homedir(), "Desktop", "EDITHProjects", projName);
        fsNode.mkdirSync(projectDir, { recursive: true });

        const writtenFiles: string[] = [];
        for (const fileInfo of files.slice(0, 6)) {
          const writePrompt = `Write the complete ${language} code for file "${fileInfo.path}" in project: "${description}".
File description: ${fileInfo.description}
Return only the code, no explanations.`;
          const fileCode = await geminiGenerate(writePrompt);
          const cleanCode = fileCode.replace(/^```[a-z]*\n?/, "").replace(/\n?```\s*$/, "").trim();
          const fullPath = pathNode.join(projectDir, fileInfo.path);
          fsNode.mkdirSync(pathNode.dirname(fullPath), { recursive: true });
          fsNode.writeFileSync(fullPath, cleanCode, "utf-8");
          writtenFiles.push(fileInfo.path);
        }

        const result = `✅ **Proje Oluşturuldu: ${projName}**

📁 Konum : ${projectDir}
📄 Dosyalar : ${writtenFiles.join(", ")}
📦 Bağımlılıklar : ${deps.length ? deps.join(", ") : "Yok"}
▶️  Çalıştırma : ${plan.run_command}

${deps.length ? `💡 Kurulum için: pip install ${deps.join(" ")}` : ""}`;

        return res.json({ success: true, toolId, result });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Dev Agent hatası: ${e.message}` });
      }
    }

    // ── YOUTUBE CONTROL ─────────────────────────────────────────────────────
    case "youtube_control": {
      const action = (args.action || "play").toLowerCase();
      const query  = (args.query || "").trim();

      if (!query) return res.json({ success: false, error: "Video/konu sorgusu gereklidir." });

      try {
        if (action === "play") {
          const encoded = encodeURIComponent(query);
          const ytUrl = `https://www.youtube.com/results?search_query=${encoded}`;
          return res.json({
            success: true, toolId,
            result: `▶️ YouTube arama açıldı: "${query}"\n\n🔗 ${ytUrl}\n\n💡 Bu linki tarayıcıda açarak videoyu izleyebilirsiniz.`,
          });
        }

        if (action === "trending") {
          const result = await geminiGenerate(`List the top 5 trending YouTube videos or topics right now in Turkey. For each give title and why it's trending. Respond in Turkish.`);
          return res.json({ success: true, toolId, result });
        }

        if (action === "summarize" || action === "get_info") {
          const result = await geminiGenerate(
            action === "summarize"
              ? `Summarize the content and key points of YouTube videos about: "${query}". If it's a specific video URL, summarize it. Respond in Turkish.`
              : `Provide information about YouTube videos related to: "${query}". Include typical duration, content type, popular channels. Respond in Turkish.`
          );
          return res.json({ success: true, toolId, result });
        }

        return res.json({ success: false, toolId, error: `Bilinmeyen YouTube aksiyonu: ${action}` });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `YouTube hatası: ${e.message}` });
      }
    }

    // ── BACKGROUND MONITOR ──────────────────────────────────────────────────
    case "background_monitor": {
      const action = (args.action || "list").toLowerCase();
      const topic  = (args.topic || "").trim();

      // Basit bellek dosyası: proje kökünde .edith_monitors.json
      const fsNode = require("fs") as typeof import("fs");
      const pathNode = require("path") as typeof import("path");
      const monitorsPath = pathNode.join(process.cwd(), ".edith_monitors.json");

      const loadMonitors = (): string[] => {
        try { return JSON.parse(fsNode.readFileSync(monitorsPath, "utf-8")); } catch { return []; }
      };
      const saveMonitors = (list: string[]) => {
        fsNode.writeFileSync(monitorsPath, JSON.stringify(list, null, 2), "utf-8");
      };

      const BLOCKED = ["crypto", "bitcoin", "ethereum", "borsa", "hisse", "forex", "trading"];
      const isBlocked = (t: string) => BLOCKED.some(b => t.toLowerCase().includes(b));

      if (action === "add") {
        if (!topic) return res.json({ success: false, error: "İzlenecek konu girilmedi." });
        if (isBlocked(topic)) return res.json({ success: false, error: "Kripto/finans konuları izleme listesine eklenemez." });
        const monitors = loadMonitors();
        if (monitors.includes(topic)) return res.json({ success: true, toolId, result: `"${topic}" zaten izleniyor.` });
        monitors.push(topic);
        saveMonitors(monitors);
        return res.json({ success: true, toolId, result: `✅ "${topic}" izleme listesine eklendi.\nToplam izlenen: ${monitors.length} konu.` });
      }

      if (action === "remove") {
        if (!topic) return res.json({ success: false, error: "Kaldırılacak konu girilmedi." });
        const monitors = loadMonitors().filter(m => m !== topic);
        saveMonitors(monitors);
        return res.json({ success: true, toolId, result: `🗑️ "${topic}" izleme listesinden kaldırıldı.` });
      }

      if (action === "list") {
        const monitors = loadMonitors();
        const result = monitors.length
          ? `👁️ **İzlenen Konular (${monitors.length})**\n\n${monitors.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
          : "İzlenen konu yok. Konu eklemek için 'add' aksiyonunu kullanın.";
        return res.json({ success: true, toolId, result });
      }

      if (action === "check") {
        const monitors = loadMonitors();
        if (!monitors.length) return res.json({ success: true, toolId, result: "İzlenecek konu bulunmuyor." });

        try {
          const checkPrompt = `Check for the latest news/developments on these topics: ${monitors.join(", ")}.
For each topic, give 1-2 new developments if any. Be concise. Respond in Turkish.`;
          const result = await geminiGenerate(checkPrompt);
          return res.json({ success: true, toolId, result: `🔔 **İzleme Raporu**\n\n${result}` });
        } catch (e: any) {
          return res.json({ success: false, toolId, error: `İzleme kontrolü başarısız: ${e.message}` });
        }
      }

      return res.json({ success: false, error: "Geçersiz aksiyon. add / remove / list / check seçin." });
    }

    // ── SCREEN PROCESSOR ────────────────────────────────────────────────────
    case "screen_processor": {
      const source   = (args.source || "screen").toLowerCase();
      const question = args.question || "Ne görüyorsun?";

      try {
        if (source === "camera") {
          // Webcam erişimi sunucu tarafında kısıtlı — browser'a yönlendir
          return res.json({
            success: true, toolId,
            result: `📷 **Kamera Analizi**\n\nKamera erişimi için tarayıcı API'si gereklidir.\n\n💡 Sohbet ekranında kameranızı açıp görüntüyü sürükleyip bırakabilirsiniz. Gemini Vision ile analiz edilecektir.\n\nSoru: "${question}"`,
          });
        }

        // Ekran görüntüsü alma girişimi (screenshot-desktop paketi yoksa bilgi mesajı)
        try {
          const screenshot = require("screenshot-desktop");
          const imgBuffer = await screenshot({ format: "png" }) as Buffer;
          const base64 = imgBuffer.toString("base64");

          // Gemini Vision ile analiz et
          const gemini = getGeminiClient();
          if (!gemini) {
            return res.json({ success: true, toolId, result: `🖥️ Ekran görüntüsü alındı (${(imgBuffer.length / 1024).toFixed(1)} KB). Analiz için GEMINI_API_KEY gereklidir.` });
          }

          const result = await (gemini as any).models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
              { role: "user", parts: [
                { text: question },
                { inlineData: { mimeType: "image/png", data: base64 } }
              ]}
            ],
          });

          const text = (result as any).text ?? "Görüntü analiz edildi.";
          return res.json({ success: true, toolId, result: `🖥️ **Ekran Analizi**\n\n${text}` });
        } catch {
          // screenshot-desktop yoksa
          return res.json({
            success: true, toolId,
            result: `🖥️ **Ekran Analizi**\n\nEkran yakalama için 'screenshot-desktop' paketi gereklidir:\nnpm install screenshot-desktop\n\nKurulduktan sonra bu araç ekranınızı gerçek zamanlı analiz edebilir.\n\nSoru: "${question}"`,
          });
        }
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Ekran işleme hatası: ${e.message}` });
      }
    }

    // ── FLIGHT FINDER ───────────────────────────────────────────────────────
    case "flight_finder": {
      const origin      = (args.origin || "").toUpperCase().trim();
      const destination = (args.destination || "").toUpperCase().trim();
      const date        = (args.date || "").trim();
      const returnDate  = (args.return_date || "").trim();
      const cabin       = args.cabin || "economy";
      const passengers  = args.passengers || 1;

      if (!origin || !destination || !date) {
        return res.json({ success: false, error: "Kalkış, varış ve tarih bilgisi gereklidir." });
      }

      try {
        // Google Flights URL oluştur
        const cabinMap: Record<string, string> = { economy: "1", premium_economy: "2", business: "3", first: "4" };
        const cabinCode = cabinMap[cabin] || "1";
        const gFlightsUrl = returnDate
          ? `https://www.google.com/travel/flights?q=Flights+from+${origin}+to+${destination}+on+${date}+returning+${returnDate}`
          : `https://www.google.com/travel/flights?q=Flights+from+${origin}+to+${destination}+on+${date}`;

        // Gemini ile uçuş bilgisi
        const flightPrompt = `Find flight information for:
- From: ${origin}
- To: ${destination}  
- Date: ${date}${returnDate ? `\n- Return: ${returnDate}` : ""}
- Cabin: ${cabin}
- Passengers: ${passengers}

Provide typical flight duration, airlines that usually operate this route, approximate price range in USD/TRY, and any layover information. Respond in Turkish.`;

        const aiResult = await geminiGenerate(flightPrompt);

        const result = `✈️ **Uçuş Arama: ${origin} → ${destination}**
📅 Tarih: ${date}${returnDate ? ` | Dönüş: ${returnDate}` : ""}
💺 Kabin: ${cabin} | 👤 Yolcu: ${passengers}

${aiResult}

🔗 **Google Flights'ta Gerçek Fiyatlar:**
${gFlightsUrl}`;

        return res.json({ success: true, toolId, result });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Uçuş arama hatası: ${e.message}` });
      }
    }

    // ── BROWSER CONTROL ─────────────────────────────────────────────────────
    case "browser_control": {
      const action = (args.action || "open").toLowerCase();
      const url    = (args.url || "").trim();
      const query  = (args.query || "").trim();

      try {
        if (action === "open" && url) {
          // OS'ta varsayılan tarayıcıda aç
          const { exec } = require("child_process") as typeof import("child_process");
          const os = require("os") as typeof import("os");
          const platform = os.platform();
          const openCmd = platform === "win32" ? `start "" "${url}"` : platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;

          return new Promise<void>((resolve) => {
            exec(openCmd, (err) => {
              res.json({
                success: !err,
                toolId,
                result: err
                  ? `⚠️ Tarayıcı açılamadı: ${err.message}\n🔗 Manuel olarak açın: ${url}`
                  : `🌐 Tarayıcıda açıldı: ${url}`,
              });
              resolve();
            });
          });
        }

        if (action === "search" && query) {
          const { exec } = require("child_process") as typeof import("child_process");
          const os = require("os") as typeof import("os");
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
          const platform = os.platform();
          const openCmd = platform === "win32" ? `start "" "${searchUrl}"` : platform === "darwin" ? `open "${searchUrl}"` : `xdg-open "${searchUrl}"`;

          return new Promise<void>((resolve) => {
            exec(openCmd, (err) => {
              res.json({
                success: !err,
                toolId,
                result: err
                  ? `⚠️ Tarayıcı açılamadı\n🔗 Link: ${searchUrl}`
                  : `🔍 Google'da arandı: "${query}"\n🔗 ${searchUrl}`,
              });
              resolve();
            });
          });
        }

        if (action === "screenshot") {
          return res.json({
            success: true, toolId,
            result: `📸 Tarayıcı ekran görüntüsü için 'screen_processor' aracını kullanın.\n\nTam tarayıcı otomasyonu için Playwright kurulumu önerilir:\nnpm install playwright`,
          });
        }

        return res.json({ success: false, error: "URL veya arama sorgusu girilmedi." });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Tarayıcı kontrol hatası: ${e.message}` });
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    default:
      return res.status(400).json({ success: false, error: `Bilinmeyen araç ID'si: ${toolId}` });
  }
});

// Start Express Server with Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  obsidianVaultService.startWatcher();
  if (process.env.EDITH_CRYPTO_AUTOSTART === "true") {
    cryptoService.start("EDITH server startup").then((status) => {
      const state = status.healthy || status.managedProcessRunning ? "online/starting" : "not started";
      console.log(`[EDITH Crypto] ${state}: ${status.dashboardUrl}${status.error ? ` (${status.error})` : ""}`);
    }).catch((error) => {
      console.warn("[EDITH Crypto] Autostart failed:", error);
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[EDITH Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
