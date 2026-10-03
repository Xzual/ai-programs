import { Bridge, IS_TAURI, type ClipboardSnapshot, type SpotifySnapshot } from "../core/bridge";
import { State } from "../core/state";
import { h, clear, svg } from "./dom";
import { ICONS } from "./icons";
import type { ViewActions, ViewHost } from "./views";

export function mediaTime(seconds: number) { const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`; }
export function buildClipboard(actions: ViewActions): ViewHost {
  const toggle = h("button", { class: "shortcut-small primary", text: "Başlat" });
  const wipe = h("button", { class: "shortcut-small", text: "Temizle" });
  const search = h("input", { class: "shortcut-input", placeholder: "Geçmişte ara…", "aria-label": "Pano geçmişinde ara" });
  const list = h("div", { class: "clipboard-list" });
  const feedback = h("div", { class: "utility-feedback", "aria-live": "polite" });
  const status = h("span", { class: "utility-status", text: "Kayıt kapalı" });
  const el = h("div", { class: "view" }, h("div", { class: "card" }, h("div", { class: "utility-body" },
    h("div", { class: "utility-heading" }, h("b", { text: "Pano geçmişi" }), status, toggle, wipe),
    h("p", { class: "utility-note", text: "Yalnız metin · son 50 kayıt · bellekte · kapanınca silinir. Hassas metinleri kopyalarken duraklat; filtre her sırrı tanıyamaz." }), search, list, feedback)));
  let data: ClipboardSnapshot = { enabled:false, entries:[] }, busy=false, last=0, signature="", loaded=false;
  async function refresh() {
    if (busy || !IS_TAURI) return; busy=true;
    try { data=await Bridge.clipboardSnapshot(); toggle.textContent=data.enabled ? "Duraklat" : "Başlat"; status.textContent=data.enabled ? "● Kayıt açık" : "Kayıt kapalı"; const sig=JSON.stringify(data); if(sig!==signature) { signature=sig; render(); } }
    catch(e) { feedback.textContent=String(e); } finally { busy=false; }
  }
  async function act(work:()=>Promise<void>, message:string) { if(busy) return; busy=true; actions.holdOpen(true); try { await work(); feedback.textContent=message; } catch(e) { feedback.textContent=String(e); } finally { busy=false; actions.holdOpen(el.contains(document.activeElement)); await refresh(); } }
  function render() {
    clear(list); const query=search.value.toLocaleLowerCase("tr");
    for(const entry of data.entries.filter(e=>e.text.toLocaleLowerCase("tr").includes(query))) {
      const copy=h("button", { class:"clipboard-entry", title:"Panoya kopyala" },h("span",{text:entry.text}),h("small",{text:new Date(entry.timestamp*1000).toLocaleTimeString("tr",{hour:"2-digit",minute:"2-digit"})}));
      copy.addEventListener("click",()=>void act(()=>Bridge.clipboardCopy(entry.id),"Panoya kopyalandı; otomatik yapıştırılmaz."));
      const remove=h("button",{class:"shortcut-small",text:"×", "aria-label":"Pano kaydını kaldır"}); remove.addEventListener("click",()=>void act(()=>Bridge.clipboardRemove(entry.id),"Kayıt kaldırıldı."));
      list.append(h("div",{class:"clipboard-row"},copy,remove));
    }
    if(!list.childElementCount) list.append(h("div",{class:"utility-empty",text:data.enabled ? "Kopyaladığın metinler burada görünecek." : "Başlat ile bu oturum için pano geçmişini aç."}));
  }
  toggle.addEventListener("click",()=>void act(()=>Bridge.clipboardEnabled(!data.enabled),data.enabled ? "Kayıt duraklatıldı." : "Yeni kopyalanan metinler kaydedilecek."));
  wipe.addEventListener("click",()=> { if(wipe.dataset.confirm!=="yes") {wipe.dataset.confirm="yes";wipe.textContent="Evet, temizle";return;} wipe.dataset.confirm="";wipe.textContent="Temizle";void act(()=>Bridge.clipboardRemove(null),"Geçmiş temizlendi."); });
  search.addEventListener("input",render);
  el.addEventListener("focusin",()=>actions.holdOpen(true)); el.addEventListener("focusout",()=>setTimeout(()=>actions.holdOpen(busy || el.contains(document.activeElement)),0));
  if(!IS_TAURI) {toggle.disabled=true;wipe.disabled=true;feedback.textContent="Pano geçmişi masaüstü uygulamasında çalışır.";}
  render();
  return {el,sync(){if(!loaded){loaded=true;void refresh();}},tick(now){ if(State.mode==="expanded" && !State.paused && now-last>1000) {last=now;void refresh();} }};
}

export function buildSpotify(actions: ViewActions): ViewHost {
  const status=h("span",{class:"spotify-status",text:"Bağlantı bekleniyor"});
  const cover=h("div",{class:"spotify-cover",text:"♫"});
  const title=h("b",{class:"spotify-title",text:"Spotify"});
  const artist=h("span",{class:"spotify-artist",text:"Müziğin, küçük bir panelde."});
  const album=h("span",{class:"spotify-album"});
  const previous=h("button",{class:"media-button",text:"⏮",title:"Önceki parça"});
  const play=h("button",{class:"media-button play",text:"▶",title:"Oynat"});
  const next=h("button",{class:"media-button",text:"⏭",title:"Sonraki parça"});
  const seek=h("input",{type:"range",min:"0",max:"0",step:"1",value:"0",class:"spotify-seek", "aria-label":"Spotify parça konumu"});
  const volume=h("input",{type:"range",min:"0",max:"100",step:"1",value:"0",class:"spotify-volume", "aria-label":"Yalnız Spotify ses düzeyi"});
  const volumeLabel=h("span",{class:"spotify-volume-label",text:"—"});
  seek.style.accentColor="#1ed760";seek.style.minWidth="0";seek.style.width="100%";
  const position=h("span",{text:"0:00"}), duration=h("span",{text:"0:00"});
  const feedback=h("div",{class:"utility-feedback", "aria-live":"polite"});
  const refreshButton=h("button",{class:"link-btn",text:"Yenile"});
  const el=h("div",{class:"view"},h("div",{class:"card spotify-card"},h("div",{class:"utility-body"},
    h("div",{class:"utility-heading"},h("b",{class:"spotify-brand",text:"● Spotify"}),status,refreshButton),
    h("div",{class:"spotify-track"},cover,h("div",{class:"spotify-metadata"},title,artist,album)),
    h("div",{class:"spotify-timeline"},position,seek,duration),
    h("div",{class:"media-controls"},previous,play,next),
    h("div",{class:"spotify-timeline spotify-volume-row",title:"Yalnız Spotify uygulamasının sesi"},svg(ICONS.speakerOn,14),volume,volumeLabel),feedback)));
  let data:SpotifySnapshot|null=null,busy=false,last=0,art="",loaded=false,editingSeek=false,editingVolume=false,refreshing=false,revision=0;
  function render(){ const connected=!!data?.connected; status.textContent=connected ? data?.playing ? "● Çalıyor" : "Duraklatıldı" : "Spotify oturumu yok";
    title.textContent=connected ? data?.title || "Parça bilgisi yok" : "Spotify'da bir parça aç";
    artist.textContent=connected ? data?.artist || "" : "Yalnız masaüstü Spotify kontrol edilir.";album.textContent=data?.album || "";
    const artwork=data?.artwork || ""; if(artwork!==art){art=artwork;clear(cover);if(artwork.startsWith("data:image/")){const image=h("img",{src:artwork,alt:"Albüm kapağı"});image.addEventListener("error",()=>{cover.textContent="♫";});cover.append(image);}else cover.textContent="♫";}
    play.textContent=data?.playing ? "Ⅱ" : "▶";play.title=data?.playing ? "Duraklat" : "Oynat";
    previous.disabled=busy || !data?.canPrevious; next.disabled=busy || !data?.canNext; play.disabled=busy || !(data?.playing ? data.canPause : data?.canPlay);
    seek.disabled=busy || !data?.canSeek; volume.disabled=busy || !data?.canVolume;
    seek.max=String(Math.max(0,data?.duration || 0));
    if(!editingSeek){seek.value=String(data?.position || 0);position.textContent=mediaTime(data?.position || 0);}
    duration.textContent=mediaTime(data?.duration || 0);
    if(!editingVolume){volume.value=String(Math.round((data?.volume ?? 0)*100));volumeLabel.textContent=data?.volume==null ? "—" : `${Math.round(data.volume*100)}%`;volume.style.setProperty("--volume-fill",`${volume.value}%`);}
    seek.title=data?.canSeek ? "Sürükle, bırakınca parçanın bu konumuna geç" : "Bu oturumda zaman değiştirme kullanılamıyor";
    volume.title=data?.canVolume ? "Yalnız Spotify uygulamasının sesi" : "Spotify ses oturumu bulunamadı";
    refreshButton.disabled=busy;
  }
  async function refresh(){if(busy || refreshing || editingSeek || editingVolume || !IS_TAURI)return;refreshing=true;const generation=revision;try{const snapshot=await Bridge.spotifySnapshot();if(generation===revision && !busy)data=snapshot;}catch(e){if(generation===revision && !busy){feedback.textContent=String(e);data=null;}}finally{refreshing=false;render();}}
  async function command(work:()=>Promise<SpotifySnapshot>){if(busy)return;busy=true;revision++;feedback.textContent="";actions.holdOpen(true);render();try{data=await work();}catch(e){feedback.textContent=String(e);}finally{busy=false;actions.holdOpen(el.contains(document.activeElement));render();last=0;}}
  previous.addEventListener("click",()=>void command(()=>Bridge.spotifyAction("previous")));next.addEventListener("click",()=>void command(()=>Bridge.spotifyAction("next")));play.addEventListener("click",()=>{const action=data?.playing ? "pause" : "play";void command(()=>Bridge.spotifyAction(action));});refreshButton.addEventListener("click",()=>void refresh());
  seek.addEventListener("input",()=>{editingSeek=true;actions.holdOpen(true);position.textContent=mediaTime(Number(seek.value));});
  seek.addEventListener("change",()=>{const value=Number(seek.value);editingSeek=false;void command(()=>Bridge.spotifySeek(value));});
  volume.addEventListener("input",()=>{editingVolume=true;actions.holdOpen(true);volumeLabel.textContent=`${volume.value}%`;volume.style.setProperty("--volume-fill",`${volume.value}%`);});
  volume.addEventListener("change",()=>{const value=Number(volume.value)/100;editingVolume=false;void command(()=>Bridge.spotifyVolume(value));});
  for(const slider of [seek,volume]){slider.addEventListener("pointercancel",()=>{editingSeek=false;editingVolume=false;actions.holdOpen(busy || el.contains(document.activeElement));render();});slider.addEventListener("keydown",event=>{if(event.key==="Escape"){editingSeek=false;editingVolume=false;render();}});}
  el.addEventListener("focusin",()=>actions.holdOpen(true));el.addEventListener("focusout",()=>setTimeout(()=>{editingSeek=false;editingVolume=false;actions.holdOpen(busy || el.contains(document.activeElement));render();},0));
  if(!IS_TAURI) feedback.textContent="Spotify paneli masaüstü uygulamasında çalışır.";
  render();return {el,sync(){if(!loaded){loaded=true;void refresh();}},tick(now){if(State.mode==="expanded" && !State.paused && now-last>2000){last=now;void refresh();}}};
}
