import React from 'react';
import { nativeMobileConsumerClient, type CurrentMobileTaskStatus } from '../../edith/nativeMobileConsumerClient';

export function CrossDeviceTaskStatus({taskId,revision,current}:{taskId:string;revision:number;current:boolean}){
  const [status,setStatus]=React.useState<CurrentMobileTaskStatus>();
  React.useEffect(()=>{
    setStatus(undefined);if(!current)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    void nativeMobileConsumerClient.readCurrentTask(taskId,revision,controller.signal).then(value=>{if(!controller.signal.aborted){setStatus(value);timer=setTimeout(()=>setStatus(undefined),5000);}}).catch(()=>{if(!controller.signal.aborted)setStatus(undefined);});
    const clear=()=>{controller.abort();setStatus(undefined);};window.addEventListener('edith-owner-logout',clear);window.addEventListener('edith-computer-stop',clear);
    return()=>{controller.abort();clearTimeout(timer);window.removeEventListener('edith-owner-logout',clear);window.removeEventListener('edith-computer-stop',clear);};
  },[taskId,revision,current]);
  return <div role="status" aria-label="Current task cross-device status" className="break-words text-[10px] text-slate-400">
    <p>{taskId} · rev {revision} · kontrol kanalı: {status?.control??'unverified'}</p>
    <p>Transfer / Live View / STOP görev ilişkisi: configuration_required. Global durum bu görevin doğrulama kanıtı değildir.</p>
  </div>;
}
