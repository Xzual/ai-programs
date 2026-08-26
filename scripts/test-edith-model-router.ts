import assert from 'node:assert/strict';
import { modelRouterService } from '../src/edith/modelRouter';
import { modelCapabilityRegistry } from '../src/edith/modelCapabilities';

const localFirst = modelRouterService.route({
  requestedProvider: 'ollama',
  model: 'llama3.2',
  providerHealth: {
    ollama: 'unknown',
    gemini: 'available',
    mock: 'available',
  },
});

const geminiFirst = modelRouterService.route({
  requestedProvider: 'gemini',
  providerHealth: {
    gemini: 'available',
    mock: 'available',
  },
});

const mockOnly = modelRouterService.route({
  requestedProvider: 'mock',
});

const offlineOnly = modelRouterService.route({
  requestedProvider: 'gemini',
  privacyPreference: 'offline_only',
  providerHealth: {
    ollama: 'available',
    gemini: 'available',
    mock: 'available',
  },
});

const unavailableGemini = modelRouterService.route({
  requestedProvider: 'gemini',
  providerHealth: {
    gemini: 'unavailable',
    mock: 'available',
  },
});

const openAiUnavailable = modelRouterService.route({
  requestedProvider: 'openai',
  model: 'gpt-5',
  providerHealth: {
    openai: 'unavailable',
    gemini: 'available',
    ollama: 'available',
    mock: 'available',
  },
});

const visionRoute = modelRouterService.route({
  requestedProvider: 'gemini',
  taskType: 'vision',
  modality: 'image',
  providerHealth: {
    gemini: 'available',
    mock: 'available',
  },
});

const offlineOpenAi = modelRouterService.route({
  requestedProvider: 'openai',
  privacyPreference: 'offline_only',
  providerHealth: {
    openai: 'available',
    ollama: 'available',
    mock: 'available',
  },
});

const capabilities = modelCapabilityRegistry.list({
  ollama: 'available',
  gemini: 'available',
  openai: 'unavailable',
  anthropic: 'unavailable',
  openrouter: 'unavailable',
  local: 'unknown',
  mock: 'available',
});

assert.deepEqual(localFirst.fallbackOrder, ['ollama', 'gemini', 'mock']);
assert.equal(localFirst.selectedProvider, 'ollama');
assert.equal(modelRouterService.shouldAttempt(localFirst, 'ollama'), true);
assert.equal(modelRouterService.shouldAttempt(localFirst, 'mock'), true);

assert.deepEqual(geminiFirst.fallbackOrder, ['gemini', 'ollama', 'mock']);
assert.equal(geminiFirst.selectedProvider, 'gemini');

assert.deepEqual(mockOnly.fallbackOrder, ['mock']);
assert.equal(mockOnly.selectedProvider, 'mock');

assert.deepEqual(offlineOnly.fallbackOrder, ['ollama', 'mock']);
assert.equal(offlineOnly.candidates.some((candidate) => candidate.provider === 'gemini'), false);

assert.equal(unavailableGemini.selectedProvider, 'ollama');
assert.equal(unavailableGemini.candidates[0].skippedReason?.includes('provider unavailable'), true);

assert.deepEqual(openAiUnavailable.fallbackOrder, ['openai', 'gemini', 'ollama', 'mock']);
assert.equal(openAiUnavailable.selectedProvider, 'gemini');
assert.equal(openAiUnavailable.candidates[0].skippedReason?.includes('provider unavailable'), true);

assert.equal(visionRoute.selectedProvider, 'gemini');
assert.equal(visionRoute.candidates[0].modelCapabilities.includes('vision'), true);

assert.deepEqual(offlineOpenAi.fallbackOrder, ['ollama', 'mock']);
assert.equal(offlineOpenAi.candidates.some((candidate) => candidate.provider === 'openai'), false);

assert.equal(capabilities.some((profile) => profile.provider === 'openai' && profile.capabilities.includes('tools')), true);
assert.equal(capabilities.some((profile) => profile.provider === 'anthropic'), true);
assert.equal(capabilities.find((profile) => profile.provider === 'mock')?.status, 'available');

console.log(JSON.stringify({
  success: true,
  scenarios: [
    'ollama_gemini_mock_order',
    'gemini_ollama_mock_order',
    'mock_only',
    'offline_only_excludes_cloud',
    'unavailable_provider_fallback',
    'future_cloud_provider_registered_but_not_selected_when_unavailable',
    'vision_capability_route',
    'capability_registry',
  ],
  routes: {
    localFirst: localFirst.fallbackOrder,
    geminiFirst: geminiFirst.fallbackOrder,
    mockOnly: mockOnly.fallbackOrder,
    offlineOnly: offlineOnly.fallbackOrder,
  },
}, null, 2));
