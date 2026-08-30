import type { MemoryScope, MemoryType } from "../../src/types";

const MEMORY_TYPES = new Set<MemoryType>(["working", "episodic", "semantic", "preference", "project", "procedural", "failure"]);
const MEMORY_SCOPES = new Set<MemoryScope>(["global", "user", "project", "task", "conversation"]);

export function parseMemoryType(value: unknown): MemoryType | undefined {
  return typeof value === "string" && MEMORY_TYPES.has(value as MemoryType) ? value as MemoryType : undefined;
}

export function parseMemoryScope(value: unknown): MemoryScope | undefined {
  return typeof value === "string" && MEMORY_SCOPES.has(value as MemoryScope) ? value as MemoryScope : undefined;
}

export function parseMemoryLimit(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 200) : fallback;
}
