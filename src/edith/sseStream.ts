export interface SseChunkResult<T = unknown> {
  events: T[];
  remainder: string;
}

export function consumeSseChunk<T = unknown>(previous: string, chunk: string, flush = false): SseChunkResult<T> {
  const normalized = `${previous}${chunk}`.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const remainder = flush ? '' : blocks.pop() ?? '';
  const completeBlocks = blocks;
  const events: T[] = [];

  for (const block of completeBlocks) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as T);
    } catch {
      // Malformed SSE payloads are ignored without discarding the buffered next event.
    }
  }

  return { events, remainder };
}
