import assert from 'node:assert/strict';
import { modelRouterService } from '../src/edith/modelRouter';

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

assert.deepEqual(localFirst.fallbackOrder, ['ollama', 'gemini', 'mock']);
assert.equal(localFirst.selectedProvider, 'ollama');
assert.equal(modelRouterService.shouldAttempt(localFirst, 'ollama'), true);
assert.equal(modelRouterService.shouldAttempt(localFirst, 'mock'), true);

assert.deepEqual(geminiFirst.fallbackOrder, ['gemini', 'mock']);
assert.equal(geminiFirst.selectedProvider, 'gemini');

assert.deepEqual(mockOnly.fallbackOrder, ['mock']);
assert.equal(mockOnly.selectedProvider, 'mock');

assert.deepEqual(offlineOnly.fallbackOrder, ['ollama', 'mock']);
assert.equal(offlineOnly.candidates.some((candidate) => candidate.provider === 'gemini'), false);

assert.equal(unavailableGemini.selectedProvider, 'mock');
assert.equal(unavailableGemini.candidates[0].skippedReason?.includes('provider unavailable'), true);

console.log(JSON.stringify({
  success: true,
  scenarios: [
    'ollama_gemini_mock_order',
    'gemini_mock_order',
    'mock_only',
    'offline_only_excludes_cloud',
    'unavailable_provider_fallback',
  ],
  routes: {
    localFirst: localFirst.fallbackOrder,
    geminiFirst: geminiFirst.fallbackOrder,
    mockOnly: mockOnly.fallbackOrder,
    offlineOnly: offlineOnly.fallbackOrder,
  },
}, null, 2));
