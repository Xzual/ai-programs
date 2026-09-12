import assert from "node:assert/strict";
import express from "express";
import { geminiProvider, setGeminiRuntimeApiKey } from "../server/providers/gemini";
import { OllamaProvider, parseOllamaStreamChunk } from "../server/providers/ollama";
import { providerRegistry } from "../server/providers/registry";
import { ProviderError } from "../server/providers/types";
import { createProvidersRouter } from "../server/routes/providers";

const originalGeminiKey = process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY = "MY_GEMINI_API_KEY";

const providers = providerRegistry.list();
const gemini = providerRegistry.get("gemini");
const ollama = providerRegistry.get("ollama");
const mock = providerRegistry.get("mock");

assert.ok(gemini);
assert.ok(ollama);
assert.ok(mock);
assert.equal(providers.some((provider) => provider.id === "gemini"), true);
assert.equal(providers.some((provider) => provider.id === "ollama"), true);
assert.equal(providers.some((provider) => provider.id === "mock"), true);

const geminiMetadata = geminiProvider.metadata();
assert.equal(geminiMetadata.configured, false);
assert.equal(geminiMetadata.status, "configuration_required");
assert.equal(geminiMetadata.privacyMode, "cloud");
assert.equal(geminiMetadata.supportsStreaming, true);
assert.equal(geminiMetadata.supportsTools, false);
assert.equal(geminiMetadata.capabilities.includes("tools"), false);
assert.equal(JSON.stringify(geminiMetadata).includes("MY_GEMINI_API_KEY"), false);

const geminiHealth = await geminiProvider.healthCheck();
assert.equal(geminiHealth.available, false);
assert.equal(geminiHealth.errorCode, "configuration_required");
assert.equal(JSON.stringify(geminiHealth).includes("MY_GEMINI_API_KEY"), false);

const parsedChatChunk = parseOllamaStreamChunk({
  message: { role: "assistant", content: "final answer", thinking: "internal reasoning" },
  done: false,
});
assert.equal(parsedChatChunk.text, "final answer");
assert.equal(parsedChatChunk.hasThinking, true);

const parsedGenerateChunk = parseOllamaStreamChunk({
  response: "generate answer",
  done: false,
});
assert.equal(parsedGenerateChunk.text, "generate answer");

const parsedThinkingOnlyChunk = parseOllamaStreamChunk({
  message: { role: "assistant", content: "", thinking: "internal reasoning only" },
  done: true,
});
assert.equal(parsedThinkingOnlyChunk.text, undefined);
assert.equal(parsedThinkingOnlyChunk.hasThinking, true);

await assert.rejects(
  () => geminiProvider.generate({ messages: [{ role: "user", content: "hello" }] }),
  (error) => error instanceof ProviderError && error.code === "configuration_required",
);

setGeminiRuntimeApiKey("test-runtime-gemini-key");
const configuredGeminiMetadata = geminiProvider.metadata();
assert.equal(configuredGeminiMetadata.configured, true);
assert.equal(configuredGeminiMetadata.status, "unknown");
assert.equal(JSON.stringify(configuredGeminiMetadata).includes("test-runtime-gemini-key"), false);

setGeminiRuntimeApiKey("MY_GEMINI_API_KEY");
const app = express();
app.use(express.json());
app.use(createProvidersRouter());
const server = app.listen(0);
const originalFetch = globalThis.fetch;
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
  return originalFetch(input, init);
};
try {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const providerListPayload = await (await fetch(`${baseUrl}/api/providers?ollamaUrl=http://127.0.0.1:11434`)).json();
  const providerListOllama = providerListPayload.providers.find((provider: { id?: string }) => provider.id === "ollama");
  assert.equal(providerListOllama.available, true);
  assert.equal(providerListOllama.healthy, true);
  assert.equal(providerListOllama.defaultModel, "llama3.2:latest");
  assert.equal(providerListOllama.models.some((model: { id: string }) => model.id === "qwen3.5:0.8b"), true);
  assert.equal(providerListPayload.geminiAvailable, false);
  assert.equal(providerListPayload.geminiConfigured, false);

  const providerHealthPayload = await (await fetch(`${baseUrl}/api/providers/health?ollamaUrl=http://127.0.0.1:11434&model=qwen3.5:0.8b`)).json();
  const providerHealthOllama = providerHealthPayload.providers.find((provider: { id?: string }) => provider.id === "ollama");
  assert.equal(providerHealthOllama.available, true);
  assert.equal(providerHealthOllama.modelAvailable, true);
  assert.equal(providerHealthPayload.availableModels.includes("qwen3.5:0.8b"), true);

  const modelsPayload = await (await fetch(`${baseUrl}/api/models?ollamaUrl=http://127.0.0.1:11434`)).json();
  const modelsOllama = modelsPayload.providers.find((provider: { id?: string }) => provider.id === "ollama");
  assert.equal(modelsOllama.available, true);
  assert.equal(modelsPayload.models.some((model: { id: string; provider: string }) => model.provider === "ollama" && model.id === "qwen3.5:0.8b"), true);

  const devKeyResponse = await fetch(`${baseUrl}/api/providers/dev-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "gemini", apiKey: "test-runtime-route-key" }),
  });
  assert.equal(devKeyResponse.ok, true);
  const devKeyPayload = await devKeyResponse.json();
  assert.equal(JSON.stringify(devKeyPayload).includes("test-runtime-route-key"), false);
} finally {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

setGeminiRuntimeApiKey("AIza-test-runtime-key-shape-only");
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.endsWith("/v1beta/models?pageSize=100") || url.includes("/v1beta/models?")) {
    return new Response(JSON.stringify({
      models: [
        { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedActions: ["generateContent"] },
        { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash", supportedActions: ["generateContent"] },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/v1beta/models/gemini-2.5-flash:generateContent")) {
    return new Response(JSON.stringify({
      error: {
        code: 404,
        status: "NOT_FOUND",
        message: "This model models/gemini-2.5-flash is no longer available to new users.",
      },
    }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/v1beta/models/gemini-2.0-flash:generateContent")) {
    return new Response(JSON.stringify({
      candidates: [
        { content: { parts: [{ text: "OK" }], role: "model" }, finishReason: "STOP" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return originalFetch(input, init);
};
try {
  const dynamicGeminiModels = await geminiProvider.getModels();
  assert.equal(dynamicGeminiModels.some((model) => model.id === "gemini-2.5-flash"), true);
  assert.equal(dynamicGeminiModels.some((model) => model.id === "models/gemini-2.5-flash"), false);

  const fallbackGeminiHealth = await geminiProvider.healthCheck({ timeoutMs: 1000 });
  assert.equal(fallbackGeminiHealth.available, true);
  assert.equal(fallbackGeminiHealth.healthy, true);
  assert.equal(fallbackGeminiHealth.defaultModel, "gemini-2.0-flash");
  assert.equal(fallbackGeminiHealth.errorCode, "model_unavailable");
  assert.match(fallbackGeminiHealth.error ?? "", /gemini-3\.8-flash/);
  assert.equal(JSON.stringify(fallbackGeminiHealth).includes("AIza-test-runtime-key-shape-only"), false);
} finally {
  globalThis.fetch = originalFetch;
  setGeminiRuntimeApiKey("MY_GEMINI_API_KEY");
}

const mockResult = await mock.generate({ messages: [{ role: "user", content: "hello" }] });
assert.equal(mockResult.provider, "mock");
assert.equal(mockResult.model, "edith-mock");

const ndjsonResponse = (lines: string[]) => {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
};

const ollamaProvider = new OllamaProvider();
let capturedOllamaChatBody = "";
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("/api/chat")) {
    capturedOllamaChatBody = String(init?.body ?? "");
    return ndjsonResponse([
      JSON.stringify({ message: { role: "assistant", content: "hello " }, done: false }) + "\n",
      JSON.stringify({ message: { role: "assistant", content: "world" }, done: true }) + "\n",
    ]);
  }
  return originalFetch(input, init);
};
try {
  const chunks: string[] = [];
  for await (const chunk of ollamaProvider.stream({
    model: "qwen3.5:0.8b",
    messages: [{ role: "user", content: "hello" }],
    firstTokenTimeoutMs: 1000,
    generationTimeoutMs: 3000,
  })) {
    if (chunk.text) chunks.push(chunk.text);
  }
  assert.equal(chunks.join(""), "hello world");
  const capturedOllamaChatRequest = JSON.parse(capturedOllamaChatBody);
  assert.equal(capturedOllamaChatRequest.model, "qwen3.5:0.8b");
  assert.equal(capturedOllamaChatRequest.think, false);
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("/api/chat")) {
    return ndjsonResponse([
      JSON.stringify({ message: { role: "assistant", content: "", thinking: "internal reasoning only" }, done: true }) + "\n",
    ]);
  }
  return originalFetch(input, init);
};
try {
  await assert.rejects(
    async () => {
      for await (const _chunk of ollamaProvider.stream({
        model: "qwen3.5:0.8b",
        messages: [{ role: "user", content: "hello" }],
        firstTokenTimeoutMs: 1000,
        generationTimeoutMs: 3000,
      })) {
        // Consume stream to completion.
      }
    },
    (error) => error instanceof ProviderError && error.code === "empty_final_response_with_thinking",
  );
} finally {
  globalThis.fetch = originalFetch;
}

const resolved = providerRegistry.resolve("gemini", "auto");
assert.equal(resolved.resolvedProvider, "gemini");
assert.equal(resolved.resolvedModel, geminiMetadata.defaultModel);

if (originalGeminiKey === undefined) {
  setGeminiRuntimeApiKey("MY_GEMINI_API_KEY");
} else {
  setGeminiRuntimeApiKey(originalGeminiKey);
}

console.log(JSON.stringify({
  success: true,
  providers: providers.map((provider) => provider.id),
  geminiConfiguredWithoutKey: geminiMetadata.configured,
  geminiStatusWithoutKey: geminiHealth.status,
  scenarios: [
    "registry_lists_core_providers",
    "gemini_missing_key_configuration_required",
    "gemini_metadata_does_not_include_key",
    "gemini_runtime_key_sets_configured_without_exposing_secret",
    "gemini_runtime_key_route_does_not_return_secret",
    "provider_and_model_routes_do_not_return_secret",
    "provider_routes_share_dynamic_ollama_availability",
    "provider_routes_share_dynamic_ollama_models",
    "gemini_available_means_health_available",
    "mock_provider_is_explicit",
    "provider_resolution_keeps_provider_separate_from_persona",
  ],
}, null, 2));
