const SECRET_ASSIGNMENT = /\b(api[_-]?key|token|secret|password|authorization|cookie|credential|private[_-]?key|webhook[_-]?url)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

export function redactSensitiveText(value: unknown, maxLength = 1000): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=[REDACTED]`)
    .slice(0, maxLength);
}

