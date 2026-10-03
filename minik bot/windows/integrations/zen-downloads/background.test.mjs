import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const source = readFileSync(new URL("./background.js", import.meta.url), "utf8");
let now = 100000, active = [], stored = new Map(), interval;
const messages = [];
const event = () => ({ addListener() {} });
const port = { onDisconnect: event(), onMessage: event(), postMessage: value => messages.push(value) };
const browser = {
  runtime: { connectNative(name) { assert.equal(name, "fr.louisraille.coucou.downloads"); return port; } },
  browserAction: { setBadgeText() {}, onClicked: event() },
  downloads: { onCreated: event(), onChanged: event(), async search(query) { return query.id !== undefined ? [stored.get(query.id)].filter(Boolean) : active; } },
};
vm.runInNewContext(source, { browser, Date: { now: () => now }, setInterval: fn => { interval = fn; }, Map, Set, Number, String, Error });
const settle = () => new Promise(resolve => setImmediate(resolve));
await settle();
assert.equal(messages.at(-1).items.length, 0);
const item = { id: 42, filename: "C:\\private\\sensitive-name.zip", url: "https://private.example/secret", referrer: "https://private.example/", startTime: "2026-10-01T10:00:00Z", state: "in_progress", paused: false, bytesReceived: 10, totalBytes: 100 };
active = [item]; stored.set(42, item); now += 2000; await interval();
assert.equal(messages.at(-1).items[0].bytes_per_second, null);
item.bytesReceived = 50; now += 2000; await interval();
const sample = messages.at(-1).items[0];
assert.equal(sample.name, "sensitive-name.zip"); assert.equal(sample.bytes_per_second, 20); assert.equal(sample.eta_seconds, 2.5);
assert(!JSON.stringify(messages).includes("private.example")); assert(!JSON.stringify(messages).includes("C:"));
item.paused = true; now += 2000; await interval(); assert.equal(messages.at(-1).items[0].state, "paused"); assert.equal(messages.at(-1).items[0].bytes_per_second, null);
item.state = "complete"; item.bytesReceived = 90; active = []; now += 2000; await interval();
assert.equal(messages.at(-1).items[0].completion_id, "zen:42:2026-10-01T10:00:00Z");
assert.equal(messages.at(-1).items[0].received_bytes, 90); // Never fake final counters.
item.bytesReceived = 100; now += 2000; await interval();
assert.equal(messages.at(-1).items[0].received_bytes, 100); // Late real final update.
now += 121000; await interval(); assert.equal(messages.at(-1).items.length, 0);
console.log("Zen adapter tests passed: real counters, sampled speed/ETA, pause, completion, expiry, no URLs/full paths.");
