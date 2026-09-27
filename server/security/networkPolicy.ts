import net from "node:net";

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  if (net.isIP(normalized) === 4) return normalized.startsWith("127.");
  return false;
}

export function resolveServerHost(env: NodeJS.ProcessEnv = process.env): string {
  const requested = env.EDITH_HOST?.trim() || "127.0.0.1";
  if (isLoopbackHost(requested)) return requested;
  if (env.EDITH_ALLOW_REMOTE_BIND === "true") return requested;
  throw new Error("Remote EDITH_HOST requires explicit EDITH_ALLOW_REMOTE_BIND=true opt-in.");
}

