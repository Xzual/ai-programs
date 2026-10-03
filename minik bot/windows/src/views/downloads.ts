import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../core/bridge";
import { State } from "../core/state";
import { h, clear } from "./dom";
import type { ViewActions, ViewHost } from "./views";
import "./downloads.css";

export interface DownloadItem {
  id: string; source: string; name: string; state: string;
  received_bytes: number | null; total_bytes: number | null;
  bytes_per_second: number | null; eta_seconds: number | null; completion_id: string | null;
  artwork?: string | null;
}
export interface DownloadSnapshot { items: DownloadItem[]; sources: { source: string; state: string; detail: string }[] }
export function downloadBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toLocaleString("tr", { maximumFractionDigits: 2 })} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("tr", { maximumFractionDigits: 1 })} MB`;
  if (value >= 1000) return `${(value / 1000).toLocaleString("tr", { maximumFractionDigits: 1 })} KB`;
  return `${Math.floor(value)} B`;
}
export function downloadEta(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "Süre bilinmiyor";
  if (value < 60) return `~${Math.ceil(value)} sn`;
  if (value < 3600) return `~${Math.ceil(value / 60)} dk`;
  return `~${Math.floor(value / 3600)} sa ${Math.ceil((value % 3600) / 60)} dk`;
}
export function downloadPercent(item: DownloadItem): number | null {
  if (item.received_bytes == null || item.total_bytes == null || !Number.isFinite(item.received_bytes) || !Number.isFinite(item.total_bytes) || item.received_bytes < 0 || item.total_bytes <= 0 || item.received_bytes > item.total_bytes) return null;
  return 100 * item.received_bytes / item.total_bytes;
}
const labels: Record<string, string> = { downloading: "İndiriliyor", installing: "Kuruluyor / işleniyor", queued: "Bekliyor", paused: "Duraklatıldı", complete: "Tamamlandı", interrupted: "Kesildi" };
const sourceLabels: Record<string, string> = { connected: "Bağlı", degraded: "Kısmen okunuyor", unavailable: "Bulunamadı", bridge_required: "Köprü kurulmalı", disconnected: "Bağlantı yok" };

export function buildDownloads(_actions: ViewActions): ViewHost {
  const list = h("div", { class: "download-list" });
  const sources = h("div", { class: "download-sources" });
  const feedback = h("div", { class: "utility-feedback", "aria-live": "polite" });
  const refreshButton = h("button", { class: "link-btn", text: "Yenile" });
  const el = h("div", { class: "view" }, h("div", { class: "card download-card" }, h("div", { class: "download-body" },
    h("div", { class: "utility-heading" }, h("b", { text: "İndirmeler" }), h("span", { class: "utility-status", text: "Steam · Zen Browser" }), refreshButton), sources,
    h("p", { class: "download-note", text: "Gerçek byte sayaçları · MB/s · ağ aktarımı için tahmini süre. Steam atölye indirmeleri hariç." }), list, feedback)));
  let data: DownloadSnapshot | null = null, busy = false, last = -Infinity, signature = "";
  const visible = () => State.mode === "expanded" && !State.paused && String(State.view) === "downloads";
  function render() {
    clear(sources); clear(list);
    for (const source of data?.sources || []) {
      const label = source.source === "steam" ? "Steam" : source.source === "zen" ? "Zen" : source.source;
      sources.append(h("div", { class: `download-source ${source.state === "connected" ? "ready" : "not-ready"}`, title: source.detail },
        h("b", { text: label }), h("span", { text: sourceLabels[source.state] || "Bilinmiyor" }), h("small", { text: source.detail })));
    }
    for (const item of data?.items || []) {
      const percent = downloadPercent(item);
      const progress = h("div", { class: `download-progress${percent == null ? " unknown" : ""}`, role: "progressbar", "aria-label": `${item.name} indirilen veri`, "aria-valuemin": "0", "aria-valuemax": "100" });
      if (percent != null) {
        progress.setAttribute("aria-valuenow", String(Math.round(percent)));
        progress.append(h("i", { style: `width:${percent}%` }));
      } else progress.setAttribute("aria-valuetext", "Toplam boyut bilinmiyor");
      const speed = item.bytes_per_second == null || !Number.isFinite(item.bytes_per_second) || item.bytes_per_second < 0 ? "Hız bilinmiyor" : `${(item.bytes_per_second / 1_000_000).toLocaleString("tr", { maximumFractionDigits: 2 })} MB/s`;
      const source = item.source === "steam" ? "Steam" : "Zen";
      const artwork = h("span", { class: "download-app", text: item.source === "steam" ? "S" : "Z", "aria-hidden": "true" });
      if (item.artwork?.startsWith("data:image/jpeg;base64,")) {
        const image = h("img", { src: item.artwork, alt: `${item.name} oyun kapağı`, class: "download-cover" });
        image.addEventListener("error", () => { artwork.textContent = "S"; });
        artwork.replaceChildren(image); artwork.classList.add("has-cover");
      }
      list.append(h("article", { class: `download-item ${item.state === "complete" ? "complete" : ""}` },
        h("div", { class: "download-title" }, artwork,
          h("div", { class: "download-name" }, h("b", { text: item.name, title: item.name }), h("small", { text: `${source} · ${labels[item.state] || "Durum bilinmiyor"}` })),
          h("span", { class: "download-percent", text: percent == null ? "—" : `${Math.floor(percent)}%` })), progress,
        h("div", { class: "download-stats" }, h("span", { text: `${downloadBytes(item.received_bytes)} / ${downloadBytes(item.total_bytes)}` }),
          h("span", { text: item.state === "complete" ? "Tamamlandı" : speed }), h("span", { text: item.state === "complete" ? "✓" : item.state === "downloading" ? downloadEta(item.eta_seconds) : "Süre bilinmiyor" }))));
    }
    if (!list.childElementCount) list.append(h("div", { class: "download-empty", text: data ? "Etkin indirme yok. Steam oyun veya bağlı Zen indirmesi başladığında burada görünür." : IS_TAURI ? "İndirme kaynakları okunuyor…" : "İndirme takibi yalnız masaüstü botta çalışır." }));
  }
  async function refresh() {
    if (busy || !IS_TAURI || !visible()) return;
    busy = true; refreshButton.disabled = true;
    try {
      const snapshot = await invoke<DownloadSnapshot>("downloads_snapshot");
      if (!visible()) return;
      const sig = JSON.stringify(snapshot); data = snapshot; feedback.textContent = "";
      if (sig !== signature) { signature = sig; render(); }
    } catch (error) { data = null; signature = ""; render(); feedback.textContent = String(error); }
    finally { busy = false; refreshButton.disabled = false; }
  }
  refreshButton.addEventListener("click", () => void refresh());
  if (!IS_TAURI) refreshButton.disabled = true;
  render();
  function poll(now: number) { if (visible() && now - last >= 2000) { last = now; void refresh(); } }
  return { el, sync() { poll(performance.now()); }, tick(now) { poll(now); } };
}
