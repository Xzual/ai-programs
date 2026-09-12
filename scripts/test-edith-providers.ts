import assert from "node:assert/strict";
import express from "express";
import { geminiProvider } from "../server/providers/gemini";
import { OllamaProvider, parseOllamaStreamChunk } from "../server/providers/ollama";
import { providerRegistry } from "../server/providers/registry";
import { routeProvider } from "../server/providers/router";
import { ProviderError } from "../server/providers/types";
import { createChatRouter } from "../server/routes/chat";
import { createHealthRouter } from "../server/routes/health";
import { createProvidersRouter } from "../server/routes/providers";

const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalFetch = globalThis.fetch;

function restoreGeminiKey() {
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
}

function ndjsonResponse(lines: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

try {
  process.env.GEMINI_API_KEY = "";
  let geminiMetadata = geminiProvider.metadata();
  assert.equal(geminiMetadata.configured, false);
  assert.equal(geminiMetadata.status, "configuration_required");

  process.env.GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";
  geminiMetadata = geminiProvider.metadata();
  assert.equal(geminiMetadata.configured, false);
  const missingGeminiHealth = await geminiProvider.healthCheck();
  assert.equal(missingGeminiHealth.status, "configuration_required");
  assert.equal(missingGeminiHealth.available, false);

  await assert.rejects(
    () => geminiProvider.generate({ messages: [{ role: "user", content: "hello" }] }),
    (error) => error instanceof ProviderError && error.code === "configuration_required",
  );

  const parsedThinkingOnlyChunk = parseOllamaStreamChunk({
    message: { role: "assistant", content: "", thinking: "internal reasoning only" },
    done: true,
  });
  assert.equal(parsedThinkingOnlyChunk.text, undefined);
  assert.equal(parsedThinkingOnlyChunk.hasThinking, true);

  const providers = providerRegistry.list();
  assert.deepEqual(providers.map((provider) => provider.id).sort(), ["gemini", "mock", "ollama"]);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("127.0.0.1:11434/api/tags")) {
      return new Response(JSON.stringify({
        models: [
          { name: "qwen3.5:0.8b" },
          { name: "llama3.2:latest" },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("127.0.0.2:11434/api/tags")) {
      return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("127.0.0.1:11434/api/chat")) {
      const request = JSON.parse(String(init?.body ?? "{}"));
      return ndjsonResponse([
        JSON.stringify({ message: { role: "assistant", content: `${request.model}:hello ` }, done: false }) + "\n",
        JSON.stringify({ message: { role: "assistant", content: "world" }, done: true }) + "\n",
      ]);
    }
    return originalFetch(input, init);
  };

  const ollamaProvider = new OllamaProvider();
  const healthyOllama = await ollamaProvider.healthCheck({ ollamaUrl: "http://127.0.0.1:11434" });
  assert.equal(healthyOllama.available, true);
  assert.equal(healthyOllama.healthy, true);
  assert.equal(healthyOllama.models.some((model) => model.id === "qwen3.5:0.8b"), true);

  const emptyOllama = await ollamaProvider.healthCheck({ ollamaUrl: "http://127.0.0.2:11434" });
  assert.equal(emptyOllama.available, false);
  assert.equal(emptyOllama.status, "degraded");
  assert.deepEqual(emptyOllama.models, []);

  const invalidGemini = {
    ...missingGeminiHealth,
    configured: true,
    status: "invalid_api_key" as const,
    errorCode: "invalid_api_key" as const,
  };
  const route = routeProvider({
    requestedProvider: "auto",
    requestedModel: "auto",
    mode: "auto",
    fallbackEnabled: true,
    health: [healthyOllama, invalidGemini, await providerRegistry.get("mock")!.healthCheck()],
  });
  assert.equal(route.resolvedProvider, "ollama");
  assert.equal(route.fallbackUsed, false);

  const missingModelRoute = routeProvider({
    requestedProvider: "ollama",
    requestedModel: "missing-model",
    mode: "manual",
    fallbackEnabled: false,
    health: [healthyOllama, await providerRegistry.get("mock")!.healthCheck()],
  });
  assert.equal(missingModelRoute.resolvedProvider, "ollama");
  assert.equal(missingModelRoute.modelAvailable, false);
  assert.equal(missingModelRoute.errorCode, "MODEL_NOT_AVAILABLE");

  const app = express();
  app.use(express.json());
  app.use(createChatRouter());
  app.use(createProvidersRouter());
  app.use(createHealthRouter());
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const providersPayload = await (await fetch(`${baseUrl}/api/providers?ollamaUrl=http://127.0.0.1:11434`)).json();
    const providersText = JSON.stringify(providersPayload);
    assert.equal(providersText.includes(process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY"), false);
    assert.equal(providersPayload.geminiConfigured, false);
    assert.equal(providersPayload.geminiStatus, "configuration_required");

    const modelsPayload = await (await fetch(`${baseUrl}/api/models?ollamaUrl=http://127.0.0.1:11434`)).json();
    assert.equal(modelsPayload.models.some((model: { id: string; provider: string }) => model.provider === "ollama" && model.id === "qwen3.5:0.8b"), true);

    const ollamaModelsPayload = await (await fetch(`${baseUrl}/api/ollama/models?ollamaUrl=http://127.0.0.1:11434`)).json();
    assert.equal(ollamaModelsPayload.available, true);
    assert.equal(ollamaModelsPayload.models.some((model: { id: string }) => model.id === "qwen3.5:0.8b"), true);

    const chatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "ollama",
        model: "qwen3.5:0.8b",
        ollamaUrl: "http://127.0.0.1:11434",
        messages: [{ sender: "user", text: "hello" }],
      }),
    });
    assert.equal(chatResponse.ok, true);
    const chatText = await chatResponse.text();
    assert.match(chatText, /event: done/);
    assert.match(chatText, /"resolvedProvider":"ollama"/);
    assert.match(chatText, /"finalState":"completed"/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  console.log(JSON.stringify({
    success: true,
    scenarios: [
      "gemini_missing_key_configuration_required",
      "gemini_placeholder_key_configuration_required",
      "provider_responses_do_not_include_key",
      "ollama_available_requires_local_model",
      "ollama_empty_model_list_degraded_unavailable",
      "invalid_gemini_does_not_beat_healthy_ollama",
      "missing_ollama_model_reports_model_not_available",
      "ollama_models_endpoint_delegates_to_provider",
      "chat_stream_emits_done",
      "mock_provider_registered",
    ],
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  restoreGeminiKey();
}
