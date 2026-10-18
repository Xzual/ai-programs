import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MobileRegistryStore} from '../server/mobile/registryStore';
import type {MobileCredentialRecord} from '../server/mobile/types';

// Actual product class, isolated files, scoped injected I/O faults. No provider/native/runtime imports.
assert.equal(process.env.EDITH_TEST_MODE,'true');
assert.ok(process.env.EDITH_TEST_DATA_DIR,'Guarded runner must set disposable data before import');
const data=path.resolve(process.env.EDITH_TEST_DATA_DIR!);
const relative=path.relative(path.resolve(os.tmpdir()),data);
assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Owned temp descendant required');
const root=fs.mkdtempSync(path.join(data,'registry-atomic-'));
const ioNames=['openSync','writeSync','fsyncSync','closeSync','renameSync','unlinkSync','existsSync','writeFileSync'] as const;
const original=Object.fromEntries(ioNames.map(name=>[name,fs[name]])) as Record<typeof ioNames[number],any>;
const originalWait=Atomics.wait,originalNow=Date.now,originalPlatform=Object.getOwnPropertyDescriptor(process,'platform')!;
assert.equal(originalPlatform.configurable,true,'Platform simulation must be reversibly configurable');
const observations:Array<Record<string,unknown>>=[];
let assertions=0;
const equal=(a:unknown,b:unknown,message:string)=>{assert.deepEqual(a,b,message);assertions++;};
const same=(a:unknown,b:unknown,message:string)=>{assert.equal(a,b,message);assertions++;};
const fault=(code:string)=>Object.assign(new Error('OWNED_ATOMIC_FAULT_'+code),{code});
type Plan={platform?:string;renameFaults?:unknown[];maxWrite?:number;zeroWrite?:boolean;writeFault?:unknown;fsyncFault?:unknown;closeFault?:unknown;cleanupCloseFault?:unknown;unlinkFault?:unknown;openFault?:unknown;preexistingTemp?:boolean;freezeTime?:boolean;serializationProbe?:boolean};
function scenario(name:string,plan:Plan,verify:(result:{store:MobileRegistryStore;before:Buffer;after:Buffer;error:unknown;events:string[];waits:number[];renames:number;temps:string[];record:MobileCredentialRecord;writeCalls:number;serializeReads:number;openDescriptors:number})=>void){
 const dir=path.join(root,name);fs.mkdirSync(dir);const store=new MobileRegistryStore(dir);store.initialize();
 const record:MobileCredentialRecord={credentialId:'credential-'+name,credentialHash:'1'.repeat(64),credentialFingerprint:'2'.repeat(64),deviceId:'device-'+name,sessionId:'session-'+name,workspaceId:'atomic-SIM',issuedAt:'2026-10-08T00:00:00.000Z',expiresAt:'2026-10-09T00:00:00.000Z',lastCommandSequence:0};
 const before=fs.readFileSync(store.filePath),events:string[]=[],waits:number[]=[],temps:string[]=[],fds=new Set<number>();
 let renames=0,writeCalls=0,serializeReads=0,renameSucceeded=false,closeFaultSent=false,error:unknown,active=false;
 if(plan.serializationProbe)Object.defineProperty(record,'credentialHash',{enumerable:true,get(){serializeReads++;return '1'.repeat(64);}});
 const owned=(value:unknown)=>typeof value==='string'&&path.dirname(path.resolve(value))===dir&&value!==store.filePath;
 try{
  Object.defineProperty(process,'platform',{...originalPlatform,value:plan.platform??'win32'});
  if(plan.freezeTime)Date.now=()=>1791476000000;
  (fs as any).openSync=function(file:unknown,flags:unknown,mode:unknown){if(!owned(file))return original.openSync.apply(fs,arguments);events.push('open');temps.push(String(file));equal(flags,'wx','Exclusive same-directory temp');equal(mode,0o600,'Private temporary mode');if(plan.openFault)throw plan.openFault;if(plan.preexistingTemp){const sentinelFd=original.openSync(String(file),'wx',0o600);try{const sentinel=Buffer.from('OWNED_PREEXISTING_SENTINEL');original.writeSync(sentinelFd,sentinel,0,sentinel.length,0);}finally{original.closeSync(sentinelFd);}}const fd=original.openSync.apply(fs,arguments);fds.add(fd);return fd;};
  (fs as any).writeSync=function(fd:number,buffer:Buffer,offset:number,length:number,position:number){if(!fds.has(fd))return original.writeSync.apply(fs,arguments);events.push('write');writeCalls++;if(plan.writeFault)throw plan.writeFault;if(plan.zeroWrite)return 0;return original.writeSync.call(fs,fd,buffer,offset,Math.min(length,plan.maxWrite??length),position);};
  (fs as any).fsyncSync=function(fd:number){if(!fds.has(fd))return original.fsyncSync.apply(fs,arguments);events.push('fsync');if(plan.fsyncFault)throw plan.fsyncFault;return original.fsyncSync.call(fs,fd);};
  (fs as any).closeSync=function(fd:number){if(!fds.has(fd))return original.closeSync.apply(fs,arguments);events.push('close');if((plan.closeFault||plan.cleanupCloseFault)&&!closeFaultSent){closeFaultSent=true;throw plan.closeFault??plan.cleanupCloseFault;}const result=original.closeSync.call(fs,fd);fds.delete(fd);return result;};
  (fs as any).renameSync=function(from:string,to:string){if(!owned(from)||to!==store.filePath)return original.renameSync.apply(fs,arguments);events.push('rename');renames++;equal(fs.readFileSync(store.filePath),before,'Destination preserved before publication');equal(fds.size,0,'Temporary descriptor closed before publication');if(renames<=(plan.renameFaults?.length??0))throw plan.renameFaults![renames-1];const result=original.renameSync.call(fs,from,to);renameSucceeded=true;return result;};
  (fs as any).unlinkSync=function(file:string){if(file===store.filePath)throw Error('DESTINATION_UNLINK_FORBIDDEN');if(!owned(file))return original.unlinkSync.apply(fs,arguments);events.push('unlink');if(plan.unlinkFault)throw plan.unlinkFault;return original.unlinkSync.call(fs,file);};
  (Atomics as any).wait=function(array:Int32Array,index:number,value:number,timeout:number){if(!active)return originalWait.apply(Atomics,arguments as any);events.push('wait');waits.push(timeout);return 'timed-out';};
  active=true;try{store.saveCredential(record);}catch(caught){error=caught;}finally{active=false;}
  verify({store,before,after:fs.readFileSync(store.filePath),error,events,waits,renames,temps,record,writeCalls,serializeReads,openDescriptors:fds.size});
  observations.push({name,platform:plan.platform??'win32',renames,renameSucceeded,requestedWaits:waits,writeCalls,tempCount:temps.length,errorCode:error&&typeof error==='object'?(error as any).code:typeof error,restored:false});
 }finally{
  active=false;
  for(const name of ioNames)(fs as any)[name]=original[name];
  Atomics.wait=originalWait;Date.now=originalNow;Object.defineProperty(process,'platform',originalPlatform);
  // Test cleanup uses original guarded functions, only tracked owned descriptors/files.
  for(const fd of fds){try{original.closeSync(fd);}catch{/* Product primary failure remains the tested result. */}}
  for(const file of temps){if(original.existsSync(file))original.unlinkSync(file);}
  for(const name of ioNames)equal(fs[name],original[name],'I/O restored: '+name);
  equal(Atomics.wait,originalWait,'Atomics restored');equal(Date.now,originalNow,'Clock restored');equal(Object.getOwnPropertyDescriptor(process,'platform'),originalPlatform,'Platform descriptor restored');
  if(observations.at(-1)?.name===name)observations.at(-1)!.restored=true;
 }
}
const healthy=(r:Parameters<Parameters<typeof scenario>[2]>[0])=>{
 same(r.error,undefined,'Successful publication');equal(r.store.getCredential(r.record.credentialId),r.record,'Actual store reads complete published record');
 const doc=JSON.parse(r.after.toString('utf8'));equal(doc.schemaVersion,1,'Whole valid document');equal(doc.credentials.length,1,'One exact committed credential');
 assert.ok(r.events.indexOf('fsync')>r.events.indexOf('write'));assertions++;assert.ok(r.events.indexOf('close')<r.events.indexOf('rename'));assertions++;
 for(const file of r.temps)equal(original.existsSync(file),false,'Successful temp absent');
};
const unchanged=(r:Parameters<Parameters<typeof scenario>[2]>[0])=>{
 equal(r.after,r.before,'Failure preserves original destination bytes');equal(r.store.getCredential(r.record.credentialId),undefined,'No failed authority record published');
};
scenario('healthy-partial-writes',{maxWrite:17,serializationProbe:true},r=>{equal(r.serializeReads,1,'Serialize document once despite partial writes');healthy(r);assert.ok(r.writeCalls>1);assertions++;equal(r.renames,1,'One atomic publication');equal(r.waits,[],'No healthy waits');equal(r.openDescriptors,0,'No healthy descriptor retained');});
for(const code of ['EPERM','EBUSY'])scenario('temporary-'+code,{renameFaults:[fault(code),fault(code)]},r=>{healthy(r);equal(r.renames,3,'Third rename actually succeeds');equal(r.waits,[10,20],'Exact requested backoff');});
const first=fault('EPERM');scenario('permanent-retryable',{renameFaults:[first,fault('EBUSY'),fault('EPERM'),fault('EBUSY')]},r=>{unchanged(r);same(r.error,first,'First retryable identity preserved after exhaustion');equal(r.renames,4,'Four total attempts');equal(r.waits,[10,20,40],'Exact bounded schedule');for(const file of r.temps)equal(original.existsSync(file),false,'Exhausted temp cleaned');});
const denied=fault('EACCES');scenario('immediate-EACCES',{renameFaults:[denied]},r=>{unchanged(r);same(r.error,denied,'Immediate nonretryable identity');equal(r.renames,1,'No permission retry');equal(r.waits,[],'No permission wait');});
const linux=fault('EPERM');scenario('non-windows-no-retry',{platform:'linux',renameFaults:[linux]},r=>{unchanged(r);same(r.error,linux,'NonWindows original identity');equal(r.renames,1,'NonWindows single call');equal(r.waits,[],'NonWindows no wait');});
const later=fault('EACCES');scenario('later-nonretryable',{renameFaults:[fault('EPERM'),later]},r=>{unchanged(r);same(r.error,later,'Later nonretryable becomes primary');equal(r.renames,2,'Stop after later nonretryable');equal(r.waits,[10],'Only first retry wait');});
scenario('zero-write',{zeroWrite:true},r=>{unchanged(r);equal((r.error as any)?.code,'EIO','Zero write fails explicitly');equal(r.renames,0,'No incomplete publication');for(const file of r.temps)equal(original.existsSync(file),false,'Zero-write temp cleaned');});
for(const stage of ['open','write','fsync','close'] as const){const primary=fault('EIO');scenario('stage-'+stage,{[stage+'Fault']:primary},r=>{unchanged(r);same(r.error,primary,'Stage primary identity '+stage);equal(r.renames,0,'No publication after '+stage);equal(r.waits,[],'No rename backoff after '+stage);equal(r.openDescriptors,0,'Stage descriptor released '+stage);if(stage==='close')equal(r.events.filter(e=>e==='close').length,2,'Failed close retried in finally');for(const file of r.temps)equal(original.existsSync(file),false,'Stage temp cleanup '+stage);});}
scenario('exclusive-open-preserves-existing',{preexistingTemp:true},r=>{unchanged(r);equal((r.error as any)?.code,'EEXIST','Actual exclusive-open collision');equal(r.events.includes('unlink'),false,'Product must not unlink unowned temp');equal(fs.readFileSync(r.temps[0],'utf8'),'OWNED_PREEXISTING_SENTINEL','Preexisting contents retained');equal(r.renames,0,'No collision publication');equal(r.waits,[],'No collision retry');});
const cleanupPrimary=fault('EPERM');scenario('cleanup-secondary',{renameFaults:[cleanupPrimary,cleanupPrimary,cleanupPrimary,cleanupPrimary],unlinkFault:fault('EACCES')},r=>{unchanged(r);same(r.error,cleanupPrimary,'Cleanup cannot replace primary');equal((r.error as any).registryCleanupErrorCode,'EACCES','Metadata-only cleanup code');equal(r.renames,4,'Cleanup failure does not retry publication');equal(r.waits,[10,20,40],'Bounded cleanup-error backoff');});
const frozen=Object.freeze(fault('EIO'));scenario('frozen-primary',{writeFault:frozen,unlinkFault:fault('EACCES')},r=>{unchanged(r);same(r.error,frozen,'Frozen primary preserved');equal(Object.hasOwn(frozen,'registryCleanupErrorCode'),false,'Frozen error not mutated');});
scenario('primitive-primary',{writeFault:'OWNED_PRIMITIVE_FAULT',unlinkFault:fault('EACCES')},r=>{unchanged(r);same(r.error,'OWNED_PRIMITIVE_FAULT','Primitive primary preserved');});
const writePrimary=fault('EIO');scenario('close-cleanup-secondary',{writeFault:writePrimary,cleanupCloseFault:fault('EBADF')},r=>{unchanged(r);same(r.error,writePrimary,'Cleanup close cannot mask write primary');equal((r.error as any).registryCleanupErrorCode,'EBADF','Cleanup close recorded without payload');equal(r.renames,0,'No rename after failed write/cleanup');equal(r.openDescriptors,1,'Injected failed close retained only until test finally releases original descriptor');});
const afterPublishCleanup=fault('EACCES');scenario('postpublication-cleanup-error',{unlinkFault:afterPublishCleanup},r=>{same(r.error,afterPublishCleanup,'Cleanup failure without primary is reported');equal(r.store.getCredential(r.record.credentialId),r.record,'Rename already published before cleanup failure; no false rollback claim');equal(r.renames,1,'Exactly one publication before cleanup error');equal(r.waits,[],'No cleanup publication retry');});
const uuidTemps:string[]=[];
scenario('uuid-frozen-clock-a',{freezeTime:true},r=>{healthy(r);uuidTemps.push(...r.temps);});
scenario('uuid-frozen-clock-b',{freezeTime:true},r=>{healthy(r);uuidTemps.push(...r.temps);});
for(const file of uuidTemps){assert.match(path.basename(file),/^mobile-registry\.json\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i);assertions++;}
equal(new Set(uuidTemps.map(file=>path.basename(file))).size,2,'UUIDs differ under same frozen time/process');
// Two writes to the SAME actual store with frozen time: no PID/timestamp filename reuse.
const sameDir=path.join(root,'same-store-clock');fs.mkdirSync(sameDir);const sameStore=new MobileRegistryStore(sameDir);sameStore.initialize();
const sameTemps:string[]=[];try{Date.now=()=>1791476000000;(fs as any).openSync=function(file:string,...args:any[]){if(path.dirname(file)===sameDir&&file!==sameStore.filePath)sameTemps.push(file);return original.openSync.call(fs,file,...args);};sameStore.initialize();sameStore.initialize();}finally{fs.openSync=original.openSync;Date.now=originalNow;}
equal(sameTemps.length,2,'Two real same-store writes');equal(new Set(sameTemps).size,2,'Same-store UUID names unique with frozen clock');
for(const name of ioNames)equal(fs[name],original[name],'Final restoration '+name);equal(Atomics.wait,originalWait,'Final Atomics restoration');equal(Date.now,originalNow,'Final clock restoration');equal(Object.getOwnPropertyDescriptor(process,'platform'),originalPlatform,'Final platform restoration');
console.log(JSON.stringify({suite:'mobile-registry-atomic-write',classification:'ACTUAL_PRODUCT_CLASS_WITH_SCOPED_SIM_IO_FAULTS',groups:observations.length,assertions,observations,scenarioRealRenameSuccesses:observations.filter(o=>o.renameSucceeded).length,sameStoreUniquePublicationWrites:2,backoffWaits:'REQUESTED_SCHEDULE_SIM_ONLY',productionOSFaultCause:'NOT_DIAGNOSED',nativeProviderNetwork:'NOT_RUN',allProtectedHooksRestored:true}));
