import assert from "node:assert/strict";
import express from "express";
import { geminiProvider, setGeminiRuntimeApiKey } from "../server/providers/gemini";
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

await assert.rejects(
  () => geminiProvider.generate({ messages: [{ role: "user", content: "hello" }] }),
  (error) => error instanceof ProviderError && error.code === "configuration_required",
);

setGeminiRuntimeApiKey("test-runtime-gemini-key");
const configuredGeminiMetadata = geminiProvider.metadata();
assert.equal(configuredGeminiMetadata.configured, true);
assert.equal(configuredGeminiMetadata.status, "unknown");
assert.equal(JSON.stringify(configuredGeminiMetadata).includes("test-runtime-gemini-key"), false);

const app = express();
app.use(express.json());
app.use(createProvidersRouter());
const server = app.listen(0);
try {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const devKeyResponse = await fetch(`${baseUrl}/api/providers/dev-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "gemini", apiKey: "test-runtime-route-key" }),
  });
  assert.equal(devKeyResponse.ok, true);
  const devKeyPayload = await devKeyResponse.json();
  assert.equal(JSON.stringify(devKeyPayload).includes("test-runtime-route-key"), false);

  const providersPayload = await (await fetch(`${baseUrl}/api/providers`)).json();
  assert.equal(JSON.stringify(providersPayload).includes("test-runtime-route-key"), false);

  const modelsPayload = await (await fetch(`${baseUrl}/api/models`)).json();
  assert.equal(JSON.stringify(modelsPayload).includes("test-runtime-route-key"), false);
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

const mockResult = await mock.generate({ messages: [{ role: "user", content: "hello" }] });
assert.equal(mockResult.provider, "mock");
assert.equal(mockResult.model, "edith-mock");

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
    "mock_provider_is_explicit",
    "provider_resolution_keeps_provider_separate_from_persona",
  ],
}, null, 2));
