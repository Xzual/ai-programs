import { Bridge } from "../core/bridge";

// Per-session drafts survive card redraws and never move to another chat.
export interface ComposerDraft { text: string; busy: boolean; status: string }
const drafts = new Map<string, ComposerDraft>();
export function codexDraft(sessionId: string): ComposerDraft {
  let draft = drafts.get(sessionId);
  if (!draft) { draft = { text: "", busy: false, status: "" }; drafts.set(sessionId, draft); }
  return draft;
}
export async function sendCodexDraft(sessionId: string, draft: ComposerDraft): Promise<boolean> {
  if (!sessionId || draft.busy || !draft.text.trim()) return false;
  const text = draft.text;
  draft.busy = true; draft.status = "Gönderiliyor…";
  try {
    const receipt = await Bridge.codexSendMessage(sessionId, text);
    if (receipt.status !== "queued") throw new Error("Gönderim doğrulanamadı.");
    draft.text = ""; draft.status = "Codex kuyruğuna eklendi";
    return true;
  } catch (error) {
    draft.status = String(error instanceof Error ? error.message : error);
    return false;
  } finally { draft.busy = false; }
}
