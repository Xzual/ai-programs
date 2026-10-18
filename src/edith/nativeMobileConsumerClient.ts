import { crossDeviceDesktopBridge, decodedBytesSha256, type CrossDeviceDesktopBridge, type CrossDeviceFrame } from './crossDeviceDesktopBridge';
import type { NativeComputerStopResult } from './computerDesktopClient';

export interface CurrentMobileTaskStatus {
  taskId:string; revision:number; checkedAt:number;
  control:'authenticated'|'offline'|'configuration_required'|'stopped';
  association:'configuration_required';
  transfer:'unassociated'; stop:'unknown'; liveView:'unassociated';
}
export interface FilteredFrameDisplay { url:string; frameId:string; sequence:number; expiresAt:number; width:number; height:number }
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(value);

/** These are original session receipts, never canonical task verification. */
export function currentNativeStopState(value:NativeComputerStopResult,sessionId:string|null,now=Date.now()):NativeComputerStopResult['state'] {
  return sessionId&&value.nativeSessionId===sessionId&&Number.isSafeInteger(value.originalGeneration)&&Number(value.originalGeneration)>=0
    &&Number.isSafeInteger(value.latchedGeneration)&&value.latchedGeneration===Number(value.originalGeneration)+1&&typeof value.observedAt==='string'
    &&Number.isFinite(Date.parse(value.observedAt))&&new Date(value.observedAt).toISOString()===value.observedAt&&Date.parse(value.observedAt)<=now
    &&['native_latched','native_quiescent'].includes(value.state)?value.state:'unknown';
}
function crc32(bytes:Uint8Array):number {let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}

/** Decode pixels before presentation. Metadata/HTTP status never establishes streaming. */
export async function validateFilteredPng(bytes:Uint8Array,width:number,height:number):Promise<void>{
  if(bytes.length>49152||bytes.length<57||!Number.isInteger(width)||!Number.isInteger(height)||width<1||width>1280||height<1||height>720
    ||[137,80,78,71,13,10,26,10].some((v,i)=>bytes[i]!==v))throw Error('FILTERED_PNG_INVALID');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),compressed:Uint8Array[]=[];
  let offset=8,header=false,ended=false,color=0,idatEnded=false;
  while(offset<bytes.length){
    if(offset+12>bytes.length)throw Error('FILTERED_PNG_INVALID');
    const size=view.getUint32(offset),end=offset+12+size;if(end>bytes.length)throw Error('FILTERED_PNG_INVALID');
    const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
    if(crc32(bytes.subarray(offset+4,offset+8+size))!==view.getUint32(offset+8+size))throw Error('FILTERED_PNG_CRC');
    if(type==='IHDR'){
      if(header||offset!==8||size!==13||view.getUint32(offset+8)!==width||view.getUint32(offset+12)!==height
        ||bytes[offset+16]!==8||![2,6].includes(bytes[offset+17])||bytes[offset+18]!==0||bytes[offset+19]!==0||bytes[offset+20]!==0)throw Error('FILTERED_PNG_INVALID');
      header=true;color=bytes[offset+17];
    }else if(type==='IDAT'){
      if(!header||idatEnded||ended)throw Error('FILTERED_PNG_INVALID');compressed.push(Uint8Array.from(bytes.subarray(offset+8,offset+8+size)));
    }else if(type==='IEND'){
      if(!header||!compressed.length||size!==0||end!==bytes.length)throw Error('FILTERED_PNG_INVALID');ended=true;
    }else{
      if(!header||!(type.charCodeAt(0)&32)||ended)throw Error('FILTERED_PNG_INVALID');if(compressed.length)idatEnded=true;
    }
    offset=end;
  }
  if(!ended)throw Error('FILTERED_PNG_INVALID');
  const expected=height*(1+width*(color===6?4:3));
  const packed=new Uint8Array(compressed.reduce((n,b)=>n+b.length,0));let at=0;for(const b of compressed){packed.set(b,at);at+=b.length;b.fill(0);}
  const reader=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();let count=0;
  try{while(true){const next=await reader.read();if(next.done)break;for(const b of next.value){if(count>=expected||(count%(expected/height)===0&&b>4))throw Error('FILTERED_PNG_PIXELS');count++;}next.value.fill(0);}if(count!==expected)throw Error('FILTERED_PNG_PIXELS');}
  finally{await reader.cancel().catch(()=>undefined);packed.fill(0);}
}

export class NativeMobileConsumerClient {
  private epoch=0;
  private frameAttempt=0;
  private frame?:FilteredFrameDisplay;
  private pixels?:Uint8Array;
  private expiry?:ReturnType<typeof setTimeout>;
  private sequence=new Map<string,number>();
  private observed=new Map<string,number>();
  constructor(private readonly bridge:CrossDeviceDesktopBridge=crossDeviceDesktopBridge,private readonly now=Date.now){}
  clear():void{this.epoch++;this.clearFrame();this.sequence.clear();this.observed.clear();}
  clearFrame():void{this.frameAttempt++;clearTimeout(this.expiry);if(this.frame)URL.revokeObjectURL(this.frame.url);this.frame=undefined;this.pixels?.fill(0);this.pixels=undefined;}
  get currentFrame():FilteredFrameDisplay|undefined {if(this.frame&&this.frame.expiresAt<=this.now())this.clearFrame();return this.frame;}
  hasRegisteredLiveView():boolean {const lease=this.bridge.activeLiveView;return Boolean(lease&&lease.ownerApproved&&Date.parse(lease.expiresAt)>this.now());}
  async readCurrentTask(taskId:string,revision:number,signal?:AbortSignal):Promise<CurrentMobileTaskStatus>{
    if(!id(taskId)||!Number.isSafeInteger(revision)||revision<0)throw Error('CURRENT_TASK_REQUIRED');
    const epoch=this.epoch;
    const result:CurrentMobileTaskStatus={taskId,revision,checkedAt:this.now(),control:'configuration_required',association:'configuration_required',transfer:'unassociated',stop:'unknown',liveView:'unassociated'};
    try{const state=await this.bridge.refresh();if(signal?.aborted||epoch!==this.epoch)throw Error('CONSUMER_SCOPE_ENDED');
      result.checkedAt=this.now();result.control=state.killSwitchActive?'stopped':!state.backendAvailable?'offline':state.ownerAuthorized&&state.native?.controlPlaneConnected?'authenticated':'configuration_required';
    }catch(error){if(signal?.aborted||epoch!==this.epoch)throw error;result.control='offline';}
    // Frozen producers have no canonical taskId association. Global counts are never attached to this task.
    return result;
  }
  async showRegisteredFrame():Promise<FilteredFrameDisplay>{
    const lease=this.bridge.activeLiveView,epoch=this.epoch;
    if(!lease||!this.hasRegisteredLiveView())throw Error('REGISTERED_LIVE_VIEW_REQUIRED');
    if(!this.sequence.has(lease.liveViewId)&&this.sequence.size>=64)throw Error('LIVE_VIEW_SCOPE_CAPACITY');
    this.clearFrame();const attempt=this.frameAttempt;
    const current=()=>{if(attempt!==this.frameAttempt||epoch!==this.epoch||this.bridge.activeLiveView!==lease||Date.parse(lease.expiresAt)<=this.now())throw Error('LIVE_VIEW_SCOPE_ENDED');};
    let bytes:Uint8Array|undefined;
    try{
      const frame:CrossDeviceFrame=await this.bridge.pullLiveViewFrame();current();
      const m=frame.metadata,t=frame.transport,observed=Date.parse(m.observedAt),expires=Math.min(observed+2000,Date.parse(lease.expiresAt));
      if(m.liveViewId!==lease.liveViewId||m.ownerSessionBindingId!==lease.ownerSessionBindingId||m.workspaceId!==lease.workspaceId||m.sessionId!==lease.sessionId
        ||m.sourceDeviceId!==lease.targetDeviceId||m.targetDeviceId!==lease.sourceDeviceId||!id(m.frameId)||!Number.isSafeInteger(m.sequence)||m.sequence<1
        ||m.sequence<=(this.sequence.get(lease.liveViewId)??0)||!Number.isFinite(observed)||new Date(observed).toISOString()!==m.observedAt||observed>this.now()||expires<=this.now()
        ||(this.observed.has(lease.liveViewId)&&observed<(this.observed.get(lease.liveViewId)!+500))
        ||t.mimeType!=='image/png'||await decodedBytesSha256(t.bytesBase64,49152)!==t.sha256)throw Error('LIVE_VIEW_FRAME_INVALID');
      bytes=Uint8Array.from(atob(t.bytesBase64),c=>c.charCodeAt(0));if(bytes.length!==t.sizeBytes)throw Error('LIVE_VIEW_FRAME_INVALID');
      await validateFilteredPng(bytes,m.width,m.height);current();if(expires<=this.now())throw Error('LIVE_VIEW_FRAME_EXPIRED');
      const display={url:URL.createObjectURL(new Blob([bytes],{type:'image/png'})),frameId:m.frameId,sequence:m.sequence,expiresAt:expires,width:m.width,height:m.height};
      this.pixels=bytes;this.frame=display;this.sequence.set(lease.liveViewId,m.sequence);this.observed.set(lease.liveViewId,observed);
      this.expiry=setTimeout(()=>{if(this.frame===display)this.clearFrame();},Math.max(0,expires-this.now()));return display;
    }catch(error){bytes?.fill(0);if(attempt===this.frameAttempt)this.clearFrame();throw error;}
  }
}
export const nativeMobileConsumerClient=new NativeMobileConsumerClient();
