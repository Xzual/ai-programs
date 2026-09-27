const SENSITIVE_KEY = /(?:api[_-]?key|token|secret|password|authorization|credential|private[_-]?key|cookie|webhook[_-]?url)/i;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const SECRET_ASSIGNMENT = /\b(api[_-]?key|token|secret|password|authorization|cookie|credential|private[_-]?key|webhook[_-]?url)\b\s*[:=]\s*([^\s,;]+)/gi;

export function redactSensitiveString(value: string): string {
  return value
    .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
    .replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=[REDACTED]`);
}

export function sanitizeSensitiveValue<T>(value: T): T {
  if (typeof value === 'string') return redactSensitiveString(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeSensitiveValue(item)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, item]) => [key, sanitizeSensitiveValue(item)]),
  ) as T;
}

