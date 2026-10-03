import { Bridge, IS_TAURI, type ShelfCatalog } from "../core/bridge";
import { h, clear } from "./dom";
import type { ViewActions, ViewHost } from "./views";

export function shelfSize(bytes:number|null):string{if(bytes==null)return "Klasör";if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/1024/1024).toFixed(1)} MB`;}
export function buildShelf(actions:ViewActions):ViewHost{
  const counter=h("span",{class:"utility-status",text:"0 / 32"});
  const refresh=h("button",{class:"link-btn",text:"Yenile"});
  const list=h("div",{class:"shelf-grid",style:"display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px;overflow-y:auto;min-height:0;flex:1;padding:2px"});
  const feedback=h("div",{class:"utility-feedback","aria-live":"polite"});
  const note=h("p",{class:"utility-note",text:"Dosyayı buraya bırak · tutamacı basılı tutup başka uygulamaya sürükle. Yalnız referans saklanır; dışarı sürükleme kopyadır."});
  const el=h("div",{class:"view"},h("div",{class:"card"},h("div",{class:"utility-body shelf-body"},h("div",{class:"utility-heading"},h("b",{text:"Dosya rafı"}),counter,refresh),note,list,feedback)));
  let catalog:ShelfCatalog={items:[]},busy=false,loaded=false;
  const hold=()=>actions.holdOpen(busy||el.contains(document.activeElement));
  async function run(work:()=>Promise<ShelfCatalog|void|boolean>){if(busy)return;busy=true;hold();feedback.textContent="";render();try{const result=await work();if(result&&typeof result==="object")catalog=result;}catch(error){feedback.textContent=String(error);}finally{busy=false;hold();render();}}
  function render(){
    counter.textContent=`${catalog.items.length} / 32`;refresh.disabled=busy||!IS_TAURI;clear(list);
    if(!catalog.items.length){list.append(h("div",{class:"utility-empty",style:"grid-column:1/-1;border:1px dashed rgba(154,130,255,.38);border-radius:14px;padding:24px;display:flex;flex-direction:column;gap:8px;text-align:center"},h("span",{text:"▧",style:"font-size:28px;color:#aa91ff"}),h("b",{text:"Dosyaların için geçici bir durak"}),h("span",{text:"PDF, görsel, belge veya klasörünü bara bırak."})));return;}
    for(const item of catalog.items){
      const ext=item.name.includes(".")?item.name.split(".").pop()?.slice(0,5).toUpperCase():"FILE";
      const open=h("button",{class:"shortcut-small",text:"Aç",title:item.path});
      const reveal=h("button",{class:"shortcut-small",text:"Konum",title:"Dosyayı Explorer'da göster"});
      const remove=h("button",{class:"shortcut-small",text:"×","aria-label":`${item.name} referansını raftan kaldır`,title:"Yalnız raftan kaldır; dosyan silinmez"});
      const handle=h("button",{class:"shortcut-small shelf-drag",text:"⠿ Sürükle",title:"Basılı tut ve hedef uygulamaya sürükle · yalnız kopyala","aria-label":`${item.name} dosyasını kopya olarak sürükle`,style:"cursor:grab;touch-action:none;color:#bbabff"});
      for(const button of [open,reveal,handle])button.disabled=busy||!IS_TAURI||!item.exists;remove.disabled=busy||!IS_TAURI;
      open.addEventListener("click",()=>void run(()=>Bridge.shelfOpen(item.id)));
      reveal.addEventListener("click",()=>void run(()=>Bridge.shelfReveal(item.id)));
      remove.addEventListener("click",()=>void run(()=>Bridge.shelfRemove(item.id)));
      handle.addEventListener("pointerdown",event=>{if(event.button!==0||handle.disabled)return;event.preventDefault();void run(async()=>{const copied=await Bridge.shelfDrag(item.id);if(copied)feedback.textContent="Kopya hedef uygulamaya bırakıldı; özgün dosya yerinde.";});});
      const card=h("div",{class:"shelf-item",style:`border:1px solid rgba(255,255,255,.09);background:linear-gradient(145deg,rgba(121,83,255,.12),rgba(255,255,255,.02));border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px;min-width:0;opacity:${item.exists?1:.6}`},
        h("div",{style:"display:flex;align-items:center;gap:8px"},h("span",{text:item.kind==="folder"?"▰":ext||"FILE",style:"display:grid;place-items:center;min-width:34px;height:34px;background:rgba(130,95,255,.2);border-radius:9px;font-size:10px;font-weight:700;color:#cbbfff"}),h("b",{text:item.name,title:item.path,style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;font-size:11px"}),remove),
        h("small",{text:item.exists?shelfSize(item.size):"Dosya taşınmış veya silinmiş",style:"color:var(--text-secondary,#999);font-size:10px"}),
        h("div",{style:"display:flex;gap:5px;flex-wrap:wrap"},open,reveal,handle));list.append(card);
    }
  }
  refresh.addEventListener("click",()=>void run(()=>Bridge.shelfList()));
  el.addEventListener("focusin",hold);el.addEventListener("focusout",()=>setTimeout(hold,0));
  if(!IS_TAURI)feedback.textContent="Dosya rafı masaüstü uygulamasında çalışır.";
  render();return{el,sync(){if(!loaded){loaded=true;if(IS_TAURI)void run(()=>Bridge.shelfList());}},dropPaths(paths){void run(async()=>{const next=await Bridge.shelfAdd(paths);feedback.textContent="Rafa eklendi; özgün dosyalar yerinde.";return next;});}};
}
