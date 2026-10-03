import { Bridge, IS_TAURI, type ShortcutApp, type ShortcutCatalog, type ShortcutLaunchResult } from "../core/bridge";
import { h, clear, svg } from "./dom";
import { ICONS } from "./icons";
import type { ViewActions, ViewHost } from "./views";

export function launchSummary(results: ShortcutLaunchResult[]): string {
  const opened = results.filter(r => r.opened).length;
  const failed = results.filter(r => !r.opened);
  return `${opened}/${results.length} uygulamaya açma isteği gönderildi${failed.length ? ` · ${failed.map(r => `${r.name}: ${r.error}`).join("; ")}` : ""}`;
}

function icon(app: ShortcutApp, small = false): HTMLElement {
  if (app.icon?.startsWith("data:image/png;base64,")) {
    const image = h("img", { class: small ? "shortcut-icon mini" : "shortcut-icon", src: app.icon, alt: app.name });
    image.addEventListener("error", () => { image.replaceWith(h("span", { class: "shortcut-fallback", text: app.name.slice(0, 1).toUpperCase() })); });
    return image;
  }
  return h("span", { class: small ? "shortcut-fallback mini" : "shortcut-fallback", text: app.name.slice(0, 1).toUpperCase() });
}

export function buildShortcuts(actions: ViewActions): ViewHost {
  const groupList = h("div", { class: "shortcut-groups" });
  const apps = h("div", { class: "shortcut-apps" });
  const feedback = h("div", { class: "shortcut-feedback", "aria-live": "polite" });
  const groupName = h("input", { class: "shortcut-input", placeholder: "Yeni grup adı…", maxlength: 40, "aria-label": "Yeni grup adı" });
  const create = h("button", { class: "shortcut-small primary", text: "+ Grup" });
  const refresh = h("button", { class: "link-btn", text: "Yenile", title: "Kısayolları yenile" });
  const el = h("div", { class: "view" }, h("div", { class: "card" },
    h("div", { class: "shortcut-body" },
      h("div", { class: "shortcut-heading" }, h("b", { text: "Kısayollar" }), h("span", { text: "Bir grup · tüm uygulamaların" }), refresh),
      h("div", { class: "shortcut-columns" },
        h("div", { class: "shortcut-sidebar" }, h("div", { class: "shortcut-create" }, groupName, create), groupList),
        apps,
      ), feedback,
    )));
  let catalog: ShortcutCatalog = { groups: [] };
  let selected = "", busy = false, loaded = false;
  let dragged = "";
  const hold = () => actions.holdOpen(busy || el.contains(document.activeElement));
  el.addEventListener("focusin", hold);
  el.addEventListener("focusout", () => window.setTimeout(hold, 0));
  async function run(work: () => Promise<ShortcutCatalog | void>) {
    if (busy) return;
    busy = true; hold(); feedback.textContent = "İşlem yapılıyor…"; render();
    try { const next = await work(); if (next) catalog = next; if (feedback.textContent === "İşlem yapılıyor…") feedback.textContent = "Kaydedildi"; }
    catch (error) { feedback.textContent = String(error); }
    finally { busy = false; hold(); render(); }
  }
  function render() {
    create.disabled = busy || !IS_TAURI;
    groupName.disabled = busy || !IS_TAURI;
    refresh.disabled = busy || !IS_TAURI;
    clear(groupList); clear(apps);
    if (!catalog.groups.some(g => g.id === selected)) selected = catalog.groups[0]?.id ?? "";
    for (const group of catalog.groups) {
      const mosaic = h("div", { class: "shortcut-mosaic" }, ...group.apps.slice(0, 4).map(a => icon(a, true)));
      if (!group.apps.length) mosaic.append(svg(ICONS.stack, 19));
      const launch = h("button", { class: "shortcut-group-launch", title: `${group.name} grubundaki tüm uygulamaları aç`, "aria-label": `${group.name} grubunu aç` },
        mosaic, h("span", {}, h("b", { text: group.name }), h("small", { text: `${group.apps.length} uygulama` })));
      launch.disabled = busy || !group.apps.length;
      launch.addEventListener("click", () => { void run(async () => { feedback.textContent = launchSummary(await Bridge.shortcutsLaunch(group.id, null)); }); });
      const edit = h("button", { class: "shortcut-group-edit", title: `${group.name} grubunu düzenle`, "aria-label": `${group.name} grubunu düzenle`, text: "⋯" });
      edit.disabled = busy; edit.addEventListener("click", () => { selected = group.id; feedback.textContent = ""; render(); });
      groupList.append(h("div", { class: `shortcut-group${selected === group.id ? " selected" : ""}` }, launch, edit));
    }
    const group = catalog.groups.find(g => g.id === selected);
    if (!group) {
      apps.append(h("div", { class: "shortcut-empty" }, svg(ICONS.stack, 28), h("b", { text: "Uygulamalarını grupla" }), h("p", { text: "Örneğin İş, Oyun veya Tasarım. Grubu oluştur, uygulamaları ekle; sonra gruba tıklayıp hepsini aç." })));
      return;
    }
    const label = h("input", { class: "shortcut-input rename", value: group.name, maxlength: 40, "aria-label": "Grup adı" });
    label.value = group.name;
    const rename = h("button", { class: "shortcut-small", text: "Kaydet", title: "Grup adını kaydet" });
    const add = h("button", { class: "shortcut-small primary", text: "+ Uygulama" });
    const remove = h("button", { class: "shortcut-small", text: "Grubu kaldır", title: "Programları silmez; sadece bu grubu kaldırır" });
    for (const control of [label, rename, add, remove]) control.disabled = busy;
    add.disabled ||= group.apps.length >= 12;
    rename.addEventListener("click", () => { void run(() => Bridge.shortcutsRenameGroup(group.id, label.value)); });
    add.addEventListener("click", () => { void run(() => Bridge.shortcutsPickApp(group.id)); });
    remove.addEventListener("click", () => {
      if (remove.dataset.confirm !== "yes") { remove.dataset.confirm = "yes"; remove.textContent = "Evet, kaldır"; feedback.textContent = "Yalnız grup kaldırılır; programlar bilgisayarında kalır."; return; }
      void run(() => Bridge.shortcutsRemoveGroup(group.id));
    });
    apps.append(h("div", { class: "shortcut-edit-heading" }, label, rename), h("div", { class: "shortcut-toolbar" }, add, remove));
    const grid = h("div", { class: "shortcut-app-grid" });
    for (const app of group.apps) {
      const launch = h("button", { class: "shortcut-app-launch", title: `${app.name} · ${app.path}` }, icon(app), h("span", { text: app.name }));
      launch.disabled = busy;
      launch.addEventListener("click", () => { void run(async () => { feedback.textContent = launchSummary(await Bridge.shortcutsLaunch(group.id, app.id)); }); });
      const removeApp = h("button", { class: "shortcut-app-remove", text: "×", title: `${app.name} kısayolunu gruptan kaldır`, "aria-label": `${app.name} kısayolunu kaldır` });
      removeApp.disabled = busy; removeApp.addEventListener("click", () => { void run(() => Bridge.shortcutsRemoveApp(group.id, app.id)); });
      const handle = h("span", {class:"shortcut-drag-handle", text:"⠿", title:"Sürükleyerek sırala"});
      const tile = h("div", { class: "shortcut-app-tile" }, launch, removeApp, handle);
      tile.dataset.appId = app.id;
      // Tauri's native OLE drop handler captures HTML5 drag events on Windows.
      // Pointer capture keeps internal ordering independent of external file drops.
      handle.addEventListener("pointerdown", event => {
        if (busy || event.button !== 0) return;
        event.preventDefault(); dragged=app.id; handle.setPointerCapture(event.pointerId); tile.classList.add("dragging"); actions.holdOpen(true);
      });
      handle.addEventListener("pointerup", event => {
        if (!dragged) return;
        const id=dragged; dragged=""; tile.classList.remove("dragging");
        if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
        const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>(".shortcut-app-tile")?.dataset.appId;
        if(target && target!==id) void run(()=>Bridge.shortcutsReorder(group.id,id,target)); else hold();
      });
      handle.addEventListener("pointercancel",()=>{dragged="";tile.classList.remove("dragging");hold();});
      tile.addEventListener("dragstart", event => { if (busy) { event.preventDefault(); return; } dragged = app.id; event.dataTransfer?.setData("text/plain", app.id); tile.classList.add("dragging"); actions.holdOpen(true); });
      tile.addEventListener("dragend", () => { dragged = ""; tile.classList.remove("dragging"); hold(); });
      tile.addEventListener("dragover", event => { if (dragged) { event.preventDefault(); if(event.dataTransfer) event.dataTransfer.dropEffect = "move"; } });
      tile.addEventListener("drop", event => { if (!dragged) return; event.preventDefault(); const id = dragged; dragged = ""; void run(() => Bridge.shortcutsReorder(group.id, id, app.id)); });
      grid.append(tile);
    }
    if (!group.apps.length) grid.append(h("p", { class: "shortcut-empty-apps", text: ".exe veya Windows kısayolunu buraya bırak ya da Uygulama ekle'yi kullan. İkonları ⠿ tutamacından sürükleyerek sırala." }));
    apps.append(grid);
  }
  const createGroup = () => {
    const label = groupName.value.trim(); if (!label) { feedback.textContent = "Önce grup adı yaz."; return; }
    const id = crypto.randomUUID();
    void run(async () => { const next = await Bridge.shortcutsCreateGroup(id, label); selected = id; groupName.value = ""; return next; });
  };
  create.addEventListener("click", createGroup);
  groupName.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); createGroup(); } });
  refresh.addEventListener("click", () => { void run(() => Bridge.shortcutsList()); });
  render();
  return {
    el,
    dropPaths(paths: string[]) {
      if (!selected) { feedback.textContent = "Önce bir grup oluştur veya seç."; return; }
      void run(() => Bridge.shortcutsAddPaths(selected, paths));
    },
    sync() {
      if (loaded) return; loaded = true;
      if (!IS_TAURI) { feedback.textContent = "Önizleme: uygulama eklemek ve açmak için masaüstü botunu kullan."; return; }
      void run(() => Bridge.shortcutsList());
    },
  };
}
