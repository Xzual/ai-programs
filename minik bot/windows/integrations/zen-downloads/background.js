/* No URLs, referrers, full paths, cookies, browsing history or external network. */
const HOST = "fr.louisraille.coucou.downloads";
const samples = new Map();
const completed = new Map();
let port = null, polling = false, lastConnect = 0;
function connect() {
  if (port || Date.now() - lastConnect < 10000) return;
  lastConnect = Date.now();
  try {
    port = browser.runtime.connectNative(HOST);
    port.onDisconnect.addListener(disconnected => {
      // Native messaging errors are connection diagnostics, never download metadata.
      console.warn("Coucou native connection disconnected:", disconnected.error?.message || "closed");
      port = null; browser.browserAction.setBadgeText({ text: "!" });
    });
    port.onMessage.addListener(() => browser.browserAction.setBadgeText({ text: "" }));
  } catch { port = null; }
}
function convert(item, now) {
  const previous = samples.get(item.id);
  const state = item.state === "complete" ? "complete" : item.state === "interrupted" ? "interrupted" : item.paused ? "paused" : "downloading";
  if (!Number.isSafeInteger(item.bytesReceived) || item.bytesReceived < 0) throw new Error("Invalid browser byte counter");
  const received = item.bytesReceived;
  const total = Number.isSafeInteger(item.totalBytes) && item.totalBytes > 0 && item.totalBytes >= received ? item.totalBytes : null;
  const elapsed = previous ? (now - previous.at) / 1000 : 0;
  const speed = state === "downloading" && previous?.state === "downloading" && previous.total === total && received > previous.bytes && elapsed >= 0.5 && elapsed <= 10 ? (received - previous.bytes) / elapsed : null;
  const eta = total != null && speed > 0 ? (total - received) / speed : null;
  samples.set(item.id, { bytes: received, total, at: now, state });
  const name = String(item.filename || "İndirme").split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180) || "İndirme";
  return { id: item.id, name, state, received_bytes: received, total_bytes: total, bytes_per_second: speed, eta_seconds: eta, completion_id: state === "complete" ? `zen:${item.id}:${item.startTime || ""}` : null };
}
async function tick() {
  if (polling) return;
  polling = true;
  try {
    connect();
    const now = Date.now();
    const active = (await browser.downloads.search({ state: "in_progress" })).filter(item => !item.incognito);
    const ids = new Set(active.map(i => i.id));
    // Check only previously observed downloads for completion, never enumerate old browser history.
    for (const [id, sample] of samples) {
      if (!ids.has(id) && sample.state !== "complete") {
        const found = await browser.downloads.search({ id });
        if (found[0] && found[0].state !== "in_progress") {
          const value = convert(found[0], now);
          completed.set(id, { value, at: now });
        } else if (!found[0]) samples.delete(id);
      }
    }
    for (const [id, c] of completed) if (now - c.at > 120000) { completed.delete(id); samples.delete(id); }
    // Completion and final byte updates may arrive separately. Re-read only this
    // session's observed completions briefly; never invent received=total.
    for (const [id, c] of completed) {
      if (now - c.at > 10000) continue;
      const found = await browser.downloads.search({ id });
      if (found[0] && !found[0].incognito && found[0].state !== "in_progress") {
        c.value = convert(found[0], now);
      }
    }
    const items = [...active.slice(0, 96).map(i => convert(i, now)), ...[...completed.values()].map(c => c.value)].slice(0, 128);
    if (port) port.postMessage({ version: 1, sampled_at_ms: now, items });
  } catch { browser.browserAction.setBadgeText({ text: "!" }); }
  finally { polling = false; }
}
browser.downloads.onCreated.addListener(tick);
browser.downloads.onChanged.addListener(tick);
browser.browserAction.onClicked.addListener(() => { lastConnect = 0; tick(); });
setInterval(tick, 2000);
tick();
