import { Router } from "express";
import assistantProfiles from "../../src/config/assistantProfiles.json";
import { buildChatSystemPrompt } from "../../src/edith/chatContext";
import { providerRegistry } from "../providers/registry";
import { ProviderError } from "../providers/types";
import type { ProviderMessage, ProviderRouteResult, RuntimeProviderId } from "../providers/types";

interface ChatBodyMessage {
  sender?: "user" | "assistant" | "system";
  role?: "user" | "assistant" | "system";
  text?: string;
  content?: string;
}

function runtimeErrorCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (code === "timeout") return "PROVIDER_TIMEOUT";
  if (code === "model_unavailable") return "MODEL_NOT_AVAILABLE";
  if (code === "configuration_required") return "CONFIGURATION_REQUIRED";
  if (code === "invalid_api_key") return "INVALID_API_KEY";
  if (code === "empty_final_response_with_thinking") return "EMPTY_FINAL_RESPONSE_WITH_THINKING";
  if (code === "empty_response") return "EMPTY_RESPONSE";
  return code.toUpperCase();
}

function normalizeMessages(messages: unknown): ChatBodyMessage[] {
  return Array.isArray(messages) ? messages : [];
}

function toProviderMessages(system: string, messages: ChatBodyMessage[]): ProviderMessage[] {
  return [
    { role: "system", content: system },
    ...messages.map((message): ProviderMessage => ({
      role: message.role ?? (message.sender === "assistant" ? "assistant" : message.sender === "system" ? "system" : "user"),
      content: String(message.content ?? message.text ?? ""),
    })).filter((message) => message.content.trim().length > 0),
  ];
}

function finalStateFor(route: ProviderRouteResult, failed: boolean): "completed" | "fallback_completed" | "failed" | "timeout" {
  if (failed && route.errorCode === "PROVIDER_TIMEOUT") return "timeout";
  if (failed) return "failed";
  return route.fallbackUsed ? "fallback_completed" : "completed";
}

function mockText(userText: string): string {
  return userText.trim()
    ? `EDITH mock fallback is responding in degraded mode. I received: "${userText.trim()}".`
    : "EDITH mock fallback is responding in degraded mode.";
}

function maybeForceManualGeminiAttempt(route: ProviderRouteResult, health: Awaited<ReturnType<typeof providerRegistry.health>>): ProviderRouteResult {
  if (route.requestedProvider !== "gemini") return route;
  if (route.resolvedProvider === "gemini" && route.modelAvailable) return route;

  const gemini = health.find((provider) => provider.id === "gemini");
  if (!gemini?.configured) return route;
  if (gemini.errorCode === "configuration_required" || gemini.errorCode === "invalid_api_key" || gemini.status === "invalid_api_key") return route;

  const requestedModel = route.requestedModel && route.requestedModel !== "auto"
    ? route.requestedModel
    : gemini.defaultModel;
  const modelAvailable = gemini.models.some((model) => model.id === requestedModel);
  if (!modelAvailable) return route;

  return {
    ...route,
    resolvedProvider: "gemini",
    resolvedModel: requestedModel,
    providerStatus: "attempting",
    fallbackUsed: false,
    fallbackProvider: undefined,
    fallbackModel: undefined,
    errorCode: undefined,
    errorMessage: undefined,
    modelAvailable: true,
    configured: true,
    available: false,
  };
}

export function createChatRouter(): Router {
  const router = Router();

  router.post("/api/chat", async (req, res) => {
    const messages = normalizeMessages(req.body?.messages);
    const requestedProvider = String(req.body?.provider ?? process.env.AI_DEFAULT_PROVIDER ?? "auto");
    const requestedMode = req.body?.mode === "manual" ? "manual" : requestedProvider === "auto" ? "auto" : process.env.AI_PROVIDER_MODE === "auto" ? "auto" : "manual";
    const requestedModel = requestedMode === "auto" ? "auto" : String(req.body?.model ?? "auto");
    const fallbackEnabled = req.body?.fallbackEnabled === undefined
      ? process.env.AI_FALLBACK_ENABLED !== "false"
      : req.body.fallbackEnabled !== false;
    const ollamaUrl = String(req.body?.ollamaUrl ?? process.env.OLLAMA_HOST ?? "http://localhost:11434");
    const temperature = typeof req.body?.temperature === "number" ? req.body.temperature : 0.7;
    const memoryEnabled = req.body?.memoryEnabled !== false;
    const userName = String(req.body?.userName ?? "Kullanici");
    const assistantPersona = String(req.body?.assistantPersona ?? "jarvis");
    const activeAssistant = (assistantProfiles as Array<{ id: string; name: string; systemPrompt?: string }>).find((profile) => profile.id === assistantPersona) ??
      (assistantProfiles as Array<{ id: string; name: string; systemPrompt?: string }>)[0];
    const lastUserMessage = [...messages].reverse().find((message) => (message.sender ?? message.role) === "user");
    const lastUserText = String(lastUserMessage?.text ?? lastUserMessage?.content ?? "");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let disconnected = false;
    res.on("close", () => {
      disconnected = true;
    });

    const sendEvent = (data: object, event?: string) => {
      if (disconnected || res.writableEnded) return;
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let finalSent = false;
    const sendDone = (route: ProviderRouteResult, failed: boolean, extra: Record<string, unknown> = {}) => {
      if (finalSent) return;
      finalSent = true;
      sendEvent({
        type: "done",
        completed: !failed,
        finalState: finalStateFor(route, failed),
        requestedProvider: route.requestedProvider,
        requestedModel: route.requestedModel,
        resolvedProvider: route.resolvedProvider,
        resolvedModel: route.resolvedModel,
        providerStatus: route.providerStatus,
        fallbackUsed: route.fallbackUsed,
        errorCode: failed ? route.errorCode ?? "PROVIDER_ERROR" : null,
        modelAvailable: route.modelAvailable,
        configured: route.configured,
        available: route.available,
        ...extra,
      }, "done");
    };

    const systemPrompt = String(req.body?.systemPrompt ?? activeAssistant?.systemPrompt ?? "You are EDITH. Be concise and helpful.");
    const { fullSystem } = buildChatSystemPrompt({
      systemPrompt,
      userName,
      memories: Array.isArray(req.body?.memories) ? req.body.memories : [],
      memoryEnabled,
      lastUserMessage: lastUserText,
    });
    const providerMessages = toProviderMessages(fullSystem, messages);
    const health = await providerRegistry.health({
      ollamaUrl,
      timeoutMs: Number.parseInt(process.env.OLLAMA_HEALTH_TIMEOUT_MS || "3000", 10),
    });
    let route = providerRegistry.route({
      requestedProvider,
      requestedModel,
      mode: requestedMode,
      fallbackEnabled,
      health,
    });
    route = maybeForceManualGeminiAttempt(route, health);

    sendEvent({
      type: "route",
      requestedProvider: route.requestedProvider,
      requestedModel: route.requestedModel,
      resolvedProvider: route.resolvedProvider,
      resolvedModel: route.resolvedModel,
      providerStatus: route.providerStatus,
      fallbackUsed: route.fallbackUsed,
      modelAvailable: route.modelAvailable,
      configured: route.configured,
      available: route.available,
      candidates: route.candidates,
    });

    async function streamProvider(providerId: RuntimeProviderId): Promise<void> {
      const provider = providerRegistry.get(providerId);
      if (!provider) throw new ProviderError("provider_unavailable", `Provider is not registered: ${providerId}`, 503);
      for await (const chunk of provider.stream({
        model: route.resolvedModel,
        messages: providerMessages,
        temperature,
        ollamaUrl,
        timeoutMs: providerId === "gemini" ? Number.parseInt(process.env.GEMINI_TIMEOUT_MS || "30000", 10) : undefined,
        firstTokenTimeoutMs: Number.parseInt(process.env.OLLAMA_FIRST_TOKEN_TIMEOUT_MS || "15000", 10),
        generationTimeoutMs: Number.parseInt(process.env.OLLAMA_GENERATION_TIMEOUT_MS || "60000", 10),
      })) {
        if (chunk.status) {
          sendEvent({ type: "status", provider: providerId, status: chunk.status });
        }
        if (chunk.text) {
          sendEvent({
            type: "chunk",
            text: chunk.text,
            done: false,
            provider: providerId,
            model: route.resolvedModel,
          });
        }
      }
    }

    try {
      const attemptingManualGemini = route.resolvedProvider === "gemini" && route.providerStatus === "attempting";
      if ((!route.available || !route.modelAvailable) && !attemptingManualGemini) {
        throw new ProviderError(
          route.errorCode === "MODEL_NOT_AVAILABLE" ? "model_unavailable" : "provider_unavailable",
          route.errorMessage ?? "Selected provider/model is unavailable.",
          503,
        );
      }

      if (route.resolvedProvider === "mock") {
        sendEvent({
          type: "chunk",
          text: mockText(lastUserText),
          done: false,
          provider: "mock",
          model: "edith-mock",
          fallbackUsed: route.fallbackUsed,
          providerStatus: "degraded",
        });
      } else {
        await streamProvider(route.resolvedProvider);
        route = {
          ...route,
          providerStatus: "available",
          available: true,
          configured: true,
          modelAvailable: true,
        };
      }
      sendDone(route, false);
    } catch (error) {
      const providerError = error instanceof ProviderError
        ? error
        : new ProviderError("unknown_error", error instanceof Error ? error.message : "Provider request failed.", 502);
      sendEvent({
        type: providerError.code === "timeout" ? "timeout" : "error",
        error: providerError.message,
        errorCode: runtimeErrorCode(providerError.code),
        requestedProvider: route.requestedProvider,
        resolvedProvider: route.resolvedProvider,
        fallbackUsed: route.fallbackUsed,
      }, providerError.code === "timeout" ? "timeout" : "error");

      if (fallbackEnabled && route.resolvedProvider !== "mock") {
        const mockHealth = health.find((provider) => provider.id === "mock");
        route = {
          ...route,
          resolvedProvider: "mock",
          resolvedModel: "edith-mock",
          providerStatus: "degraded",
          fallbackUsed: true,
          fallbackProvider: "mock",
          fallbackModel: "edith-mock",
          errorCode: runtimeErrorCode(providerError.code),
          errorMessage: providerError.message,
          modelAvailable: true,
          configured: Boolean(mockHealth?.configured),
          available: Boolean(mockHealth?.available),
        };
        sendEvent({
          type: "fallback_start",
          requestedProvider: route.requestedProvider,
          resolvedProvider: "mock",
          resolvedModel: "edith-mock",
          fallbackUsed: true,
          providerStatus: "degraded",
          errorCode: route.errorCode,
        });
        sendEvent({
          type: "chunk",
          text: mockText(lastUserText),
          done: false,
          provider: "mock",
          model: "edith-mock",
          fallbackUsed: true,
          providerStatus: "degraded",
        });
        sendDone(route, false);
      } else {
        route = {
          ...route,
          errorCode: runtimeErrorCode(providerError.code),
          errorMessage: providerError.message,
        };
        sendDone(route, true, { error: providerError.message });
      }
    } finally {
      if (!finalSent) {
        sendDone(route, true, { error: "Chat stream ended without a provider result." });
      }
      if (!res.writableEnded) res.end();
    }
  });

  return router;
}
