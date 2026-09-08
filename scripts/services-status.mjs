import process from 'node:process';

const EDITH_URL = process.env.EDITH_SERVICE_URL || 'http://localhost:3000';
const CRYPTO_URL = process.env.EDITH_CRYPTO_SERVICE_URL || process.env.EDITH_CRYPTO_DASHBOARD_URL || 'http://localhost:5000';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

async function fetchJson(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'offline',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function cryptoHealth() {
  const primary = await fetchJson(`${CRYPTO_URL}/api/health`);
  if (primary.ok) return primary;
  const fallback = await fetchJson(`${CRYPTO_URL}/health`);
  return fallback.ok ? fallback : primary;
}

function line(label, value) {
  console.log(`- ${label}: ${value}`);
}

function providerSummary(payload) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  if (!providers.length) return 'unavailable';
  return providers.map((provider) => `${provider.id}=${provider.status}`).join(', ');
}

console.log('');
console.log('E.D.I.T.H. Service Status');
console.log('=========================');

const [edithHealth, providerHealth, obsidianStatus, cryptoStatus, ollamaStatus] = await Promise.all([
  fetchJson(`${EDITH_URL}/api/health`),
  fetchJson(`${EDITH_URL}/api/providers/health`),
  fetchJson(`${EDITH_URL}/api/edith/obsidian/status`),
  cryptoHealth(),
  fetchJson(`${OLLAMA_HOST}/api/tags`),
]);

line('EDITH backend', edithHealth.ok ? `online (${EDITH_URL})` : `${edithHealth.status}`);
line('Providers', providerHealth.ok ? providerSummary(providerHealth.body) : `${providerHealth.status}`);

const obsidian = obsidianStatus.body?.status;
line('Obsidian', obsidianStatus.ok
  ? `${obsidian?.connectionStatus ?? 'unknown'} (${obsidian?.settings?.vaultPath ?? obsidian?.vaultPath ?? 'path unavailable'})`
  : `${obsidianStatus.status}`);

const cryptoBody = cryptoStatus.body;
line('Crypto service', cryptoStatus.ok
  ? `online (${CRYPTO_URL}) mode=${cryptoBody?.mode ?? 'unknown'} observer=${cryptoBody?.observerRunning ?? cryptoBody?.runtime?.observerRunning ?? 'unknown'}`
  : `${cryptoStatus.status}`);
line('Crypto trading', cryptoStatus.ok
  ? `trading=${Boolean(cryptoBody?.tradingEnabled)} paper=${Boolean(cryptoBody?.paperTradingEnabled)} live=${Boolean(cryptoBody?.liveTradingEnabled)}`
  : 'unavailable');

const ollamaModels = Array.isArray(ollamaStatus.body?.models) ? ollamaStatus.body.models.length : 0;
line('Ollama', ollamaStatus.ok ? `available (${ollamaModels} model(s))` : `${ollamaStatus.status}`);
console.log('');
