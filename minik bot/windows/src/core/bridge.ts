// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Settings } from "./state";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[coucou] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
}

export interface ShortcutApp { id: string; name: string; path: string; icon: string | null }
export interface ShortcutGroup { id: string; name: string; apps: ShortcutApp[] }
export interface ShortcutCatalog { groups: ShortcutGroup[] }
export interface ShortcutLaunchResult { name: string; opened: boolean; error: string | null }
export interface ClipboardSnapshot { enabled: boolean; entries: { id: number; text: string; timestamp: number }[] }
export interface ShelfItem { id: string; name: string; path: string; kind: "file" | "folder"; size: number | null; exists: boolean }
export interface ShelfCatalog { items: ShelfItem[] }
export interface NotificationPreview { id: number; app: string; title: string; body: string; icon: string | null }
export interface SpotifySnapshot { connected: boolean; title: string; artist: string; album: string; playing: boolean; position: number; duration: number; canSeek: boolean; volume: number | null; canVolume: boolean; canPlay: boolean; canPause: boolean; canNext: boolean; canPrevious: boolean; artwork: string | null }

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),

  openUrl: (url: string) => call<void>("open_url", { url }),

  /** Opens actual Microsoft VS Code, independently of PATH's `code` alias. */
  openInVSCode: (path: string | null) => callOrThrow<void>("open_in_vscode", { path }),
  openInCodex: (sessionId: string | null) => callOrThrow<void>("open_in_codex", { sessionId }),
  codexSendMessage: (sessionId: string, message: string) => callOrThrow<{ status: "queued" }>("codex_send_message", { sessionId, message }),
  shortcutsList: () => callOrThrow<ShortcutCatalog>("shortcuts_list"),
  shortcutsCreateGroup: (id: string, label: string) => callOrThrow<ShortcutCatalog>("shortcuts_create_group", { id, label }),
  shortcutsRenameGroup: (id: string, label: string) => callOrThrow<ShortcutCatalog>("shortcuts_rename_group", { id, label }),
  shortcutsRemoveGroup: (id: string) => callOrThrow<ShortcutCatalog>("shortcuts_remove_group", { id }),
  shortcutsRemoveApp: (groupId: string, appId: string) => callOrThrow<ShortcutCatalog>("shortcuts_remove_app", { groupId, appId }),
  shortcutsPickApp: (groupId: string) => callOrThrow<ShortcutCatalog>("shortcuts_pick_app", { groupId }),
  shortcutsAddPaths: (groupId: string, paths: string[]) => callOrThrow<ShortcutCatalog>("shortcuts_add_paths", { groupId, paths }),
  shortcutsReorder: (groupId: string, appId: string, beforeId: string) => callOrThrow<ShortcutCatalog>("shortcuts_reorder", { groupId, appId, beforeId }),
  shortcutsLaunch: (groupId: string, appId: string | null) => callOrThrow<ShortcutLaunchResult[]>("shortcuts_launch", { groupId, appId }),
  clipboardSnapshot: () => callOrThrow<ClipboardSnapshot>("clipboard_snapshot"),
  shelfList: () => callOrThrow<ShelfCatalog>("shelf_list"),
  shelfAdd: (paths: string[]) => callOrThrow<ShelfCatalog>("shelf_add", { paths }),
  shelfRemove: (id: string) => callOrThrow<ShelfCatalog>("shelf_remove", { id }),
  shelfOpen: (id: string) => callOrThrow<void>("shelf_open", { id }),
  shelfReveal: (id: string) => callOrThrow<void>("shelf_reveal", { id }),
  shelfDrag: (id: string) => callOrThrow<boolean>("shelf_drag", { id }),
  notificationsOpen: (id: number) => callOrThrow<void>("notifications_open", { id }),
  clipboardEnabled: (enabled: boolean) => callOrThrow<void>("clipboard_enabled", { enabled }),
  clipboardRemove: (id: number | null) => callOrThrow<void>("clipboard_remove", { id }),
  clipboardCopy: (id: number) => callOrThrow<void>("clipboard_copy", { id }),
  spotifySnapshot: () => callOrThrow<SpotifySnapshot>("spotify_snapshot"),
  spotifyAction: (action: string) => callOrThrow<SpotifySnapshot>("spotify_action", { action }),
  spotifySeek: (position: number) => callOrThrow<SpotifySnapshot>("spotify_seek", { position }),
  spotifyVolume: (volume: number) => callOrThrow<SpotifySnapshot>("spotify_volume", { volume }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),

  /** Writes to %LOCALAPPDATA%\Coucou\coucou.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),
  codexLiveSnapshot: () => call<import("../island/hooks").CodexLiveUpdate>("codex_live_snapshot"),

  // ── Claude Code hooks ─────────────────────────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  /**
   * Writes ~/.claude/settings.json — only ever after an explicit click, and only
   * when the file still matches the preview the user looked at.
   */
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),

  approvalDecision: (requestId: string, decision: "allow" | "deny") =>
    call<void>("approval_decision", { requestId, decision }),
  /** "The card is up" — until this lands the relay only waits a moment. */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  /** "Nobody can act on this" — Claude Code asks in the terminal right away. */
  approvalDecline: (requestId: string) => call<void>("approval_decline", { requestId }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One chat turn. The API key and any file bytes never leave Rust. */
  chatSend: (query: string, context: ChatContext | null) =>
    callOrThrow<{ text: string }>("chat_send", { query, context }),
  geminiModels: () => callOrThrow<Array<{ id: string; name: string }>>("gemini_models"),
  codexHooksStatus: () => call<HookStatus>("codex_hooks_status"),
  codexHooksPreview: (install: boolean) => callOrThrow<HookPreview>("codex_hooks_preview", { install }),
  codexHooksApply: (install: boolean, fingerprint: string) => callOrThrow<string>("codex_hooks_apply", { install, fingerprint }),
  chatReset: () => call<void>("chat_reset"),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  /** Opens the configured n8n instance in the browser. */
  openN8n: () => call<void>("open_n8n"),

  /** Tray → Pause. Stops the integration pollers, not just the island. */
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),
};

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "window"; appName: string; title: string; url?: string };

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export interface HookStatus {
  installed: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to hooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside Coucou");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "hook"; payload: Record<string, unknown> }
  | { name: "screen-changed"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/** Files dragged onto the island. Only reaches us when the window takes the mouse. */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  const native = await listen<DragDropPayload>("native-file-drop", event => handler(event.payload));
  const tauri = await getCurrentWebview().onDragDropEvent((event) => {
    handler(event.payload as DragDropPayload);
  });
  return () => { native(); tauri(); };
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}
