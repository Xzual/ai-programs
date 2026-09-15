import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const model = process.argv[2] || 'gemini-3.6-flash';

const placeholders = new Set([
  'MY_GEMINI_API_KEY',
  'your_key_here',
  'undefined',
  '',
]);

const envFound = existsSync(envPath);
dotenv.config({ path: envPath, quiet: true });

const key = process.env.GEMINI_API_KEY ?? '';
const trimmedKey = key.trim();
const keyFound = trimmedKey.length > 0;
const isPlaceholder = placeholders.has(trimmedKey);

const result = {
  projectRoot,
  envFound,
  geminiApiKeyFound: keyFound,
  geminiApiKeyLength: trimmedKey.length,
  geminiApiKeyPlaceholder: isPlaceholder,
  model,
  httpStatus: null,
  geminiOk: false,
  errorCategory: null,
  responseSummary: null,
};

function sanitize(value) {
  if (value == null) return value;
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (trimmedKey) {
    text = text.split(trimmedKey).join('[REDACTED_GEMINI_API_KEY]');
  }
  return text;
}

function summarizeResponse(body) {
  if (!body) return null;
  const candidates = body.candidates ?? [];
  const text = candidates
    .flatMap((candidate) => candidate?.content?.parts ?? [])
    .map((part) => part?.text ?? '')
    .join('')
    .trim();

  if (text) {
    return { text: sanitize(text) };
  }

  if (body.error) {
    return {
      errorCode: sanitize(body.error.code),
      errorStatus: sanitize(body.error.status),
      errorMessage: sanitize(body.error.message),
    };
  }

  return sanitize(body);
}

if (!envFound) {
  result.errorCategory = 'ENV_NOT_FOUND';
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}

if (!keyFound) {
  result.errorCategory = 'GEMINI_API_KEY_NOT_FOUND';
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}

if (isPlaceholder) {
  result.errorCategory = 'PLACEHOLDER_KEY';
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}

try {
  const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`);
  endpoint.searchParams.set('key', trimmedKey);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: 'Reply with exactly: GEMINI_OK',
            },
          ],
        },
      ],
    }),
  });

  result.httpStatus = response.status;

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  result.responseSummary = summarizeResponse(body);
  const responseText = sanitize(result.responseSummary?.text ?? '');
  result.geminiOk = response.ok && /\bGEMINI_OK\b/.test(responseText);

  if (!response.ok) {
    if (response.status === 400) result.errorCategory = 'BAD_REQUEST';
    else if (response.status === 403) result.errorCategory = 'FORBIDDEN_OR_INVALID_KEY';
    else if (response.status === 404) result.errorCategory = 'MODEL_NOT_FOUND';
    else if (response.status === 429) result.errorCategory = 'RATE_LIMITED';
    else result.errorCategory = `HTTP_${response.status}`;
  } else if (!result.geminiOk) {
    result.errorCategory = 'UNEXPECTED_RESPONSE';
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.geminiOk ? 0 : 1);
} catch (error) {
  result.errorCategory = 'NETWORK_DNS_TLS_OR_FETCH_ERROR';
  result.responseSummary = {
    name: sanitize(error?.name ?? 'Error'),
    message: sanitize(error?.message ?? String(error)),
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}
