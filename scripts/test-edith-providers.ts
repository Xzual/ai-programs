import assert from "node:assert/strict";
import { geminiProvider } from "../server/providers/gemini";
import { providerRegistry } from "../server/providers/registry";
import { ProviderError } from "../server/providers/types";

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

const mockResult = await mock.generate({ messages: [{ role: "user", content: "hello" }] });
assert.equal(mockResult.provider, "mock");
assert.equal(mockResult.model, "edith-mock");

const resolved = providerRegistry.resolve("gemini", "auto");
assert.equal(resolved.resolvedProvider, "gemini");
assert.equal(resolved.resolvedModel, geminiMetadata.defaultModel);

if (originalGeminiKey === undefined) {
  delete process.env.GEMINI_API_KEY;
} else {
  process.env.GEMINI_API_KEY = originalGeminiKey;
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
    "mock_provider_is_explicit",
    "provider_resolution_keeps_provider_separate_from_persona",
  ],
}, null, 2));
