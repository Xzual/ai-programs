import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../core/bridge";
import { State } from "../core/state";
import { h, clear } from "./dom";
import type { ViewActions, ViewHost } from "./views";
interface Notice {id:number;app:string;title:string;body:string;icon:string|null}
interface Snapshot {enabled:boolean;access:string;reason:string;items:Notice[];inlineReply:boolean}
export function buildNotifications(actions:ViewActions):ViewHost{
  const status=h("span",{class:"utility-status",text:"Kapalı"});
  const toggle=h("button",{class:"shortcut-small primary",text:"İzin ver ve aç"});
  const refresh=h("button",{class:"shortcut-small",text:"Yenile"});
  const privacy=h("input",{type:"checkbox",checked:true,"aria-label":"Mesaj önizlemelerini gizle"});
  const note=h("p",{class:"utility-note",text:"Windows bildirimlerini okumak için senin iznin gerekir. İçerik yalnız bellekte kalır; mesajlar kaydedilmez veya gönderilmez."});
  const list=h("div",{class:"clipboard-list"});
  const feedback=h("div",{class:"utility-feedback","aria-live":"polite"});
  const el=h("div",{class:"view"},h("div",{class:"card"},h("div",{class:"utility-body"},
    h("div",{class:"utility-heading"},h("b",{text:"Bildirimler"}),status,toggle,refresh),note,
    h("label",{class:"utility-note",style:"display:flex;align-items:center;gap:8px"},privacy,"Mesaj önizlemesini gizle"),list,feedback)));
  let data:Snapshot={enabled:false,access:"disabled",reason:"",items:[],inlineReply:false},busy=false,last=0,loaded=false;
  function render(){
    toggle.textContent=data.enabled?"Kapat":"İzin ver ve aç";status.textContent=data.enabled?"● Açık":data.access==="capability_required"?"Paket desteği gerekli":"Kapalı";
    note.textContent=data.reason||"Bildirimler yalnız bellekte tutulur. Açmak için Windows izni gereklidir.";clear(list);
    for(const item of data.items){
      const icon=item.icon?.startsWith("data:image/png;base64,")?h("img",{src:item.icon,alt:"",width:28,height:28}):h("span",{text:item.app.slice(0,1)||"●",style:"font-size:20px;color:#ad98ff"});
      const button=h("button",{class:"clipboard-entry",title:"İlgili uygulamayı aç",style:"display:flex;align-items:center;gap:10px;text-align:left"},icon,
        h("span",{style:"display:flex;flex-direction:column;min-width:0;gap:4px"},h("b",{text:item.app}),h("span",{text:privacy.checked?"Yeni bildirim · açmak için tıkla":item.title}),privacy.checked?null:h("small",{text:item.body})));
      button.addEventListener("click",()=>void run(()=>invoke<void>("notifications_open",{id:item.id}),false));list.append(button);
    }
    if(!data.items.length)list.append(h("div",{class:"utility-empty",text:data.enabled?"Windows'un sunduğu bildirimler burada görünür.":"Erişim kapalı. Henüz hiçbir bildirim okunmuyor."}));
  }
  async function run(work:()=>Promise<Snapshot|void>,update=true){if(busy||!IS_TAURI)return;busy=true;toggle.disabled=refresh.disabled=true;actions.holdOpen(true);feedback.textContent="";
    try{const result=await work();if(update&&result)data=result;render();}catch(e){feedback.textContent=String(e);}finally{busy=false;toggle.disabled=refresh.disabled=false;actions.holdOpen(el.contains(document.activeElement));}}
  toggle.addEventListener("click",()=>void run(()=>invoke<Snapshot>("notifications_enable",{enabled:!data.enabled})));
  refresh.addEventListener("click",()=>void run(()=>invoke<Snapshot>("notifications_snapshot")));
  privacy.addEventListener("change",()=>{render();void run(()=>invoke<void>("notifications_privacy",{hidden:privacy.checked}),false);});
  el.addEventListener("focusin",()=>actions.holdOpen(true));el.addEventListener("focusout",()=>setTimeout(()=>actions.holdOpen(busy||el.contains(document.activeElement)),0));
  render();if(!IS_TAURI){toggle.disabled=refresh.disabled=true;feedback.textContent="Windows masaüstü uygulamasında çalışır.";}
  return{el,sync(){if(!loaded){loaded=true;void run(()=>invoke<Snapshot>("notifications_snapshot"));}},tick(now){if(data.enabled&&State.mode==="expanded"&&!State.paused&&now-last>5000){last=now;void run(()=>invoke<Snapshot>("notifications_snapshot"));}}};
}
