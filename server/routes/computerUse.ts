import crypto from 'node:crypto';
import { nativeStopReceipts, NativeStopReceiptError, type NativeStopReceiptRegistry } from '../computer/nativeStopReceipts';
import { Router, type Request, type Response } from 'express';
import { killSwitchService } from '../../src/edith/killSwitch';
import {
  parseRealtimeEnvelopeV2_1,
  type TypedRealtimeEnvelopeV2,
  type DesktopVerificationContextV2,
  type DesktopActionV2,
  type ActionDispatchV2,
  type DesktopObservationV2,
  parseDesktopActionV2,
} from '../../src/edith/contracts';
import { createComputerOperatorEvent, isComputerOperatorEvent, type ComputerOperatorEvent } from '../../src/edith/computerOperatorEvents';
import { requireProtectedMutation,getOwnerSession,ownerSessionBindingActive,requireOwnerSession,requireSameOrigin,getSoleActiveOwnerSession } from '../security/ownerSession';
import {getNativeTaskBinding} from '../computer/nativeTaskBinding';
import {claimNativeFind,nativeFindSource,checkNativeFind,finishNativeFind,cancelNativeFind} from '../files/nativeExplorerFind';
import { claimNativeFileOpen, nativeFileOpenSource, finishNativeFileOpen } from '../files/nativeFileActions';
import { FileServiceError } from '../files/fileService';
import { claimNativeExplorer, nativeExplorerSource, checkNativeExplorer, readbackNativeExplorer, finishNativeExplorer, cancelNativeExplorer, registerNativeExplorerQuarantine } from '../files/nativeExplorerActions';
import { browserNativeAuthority, BrowserNativeAuthorityError, NATIVE_BROWSER_PRIVATE_BASE, NATIVE_PRIVATE_ACTIONS, type BrowserNativeAuthority } from '../browser/browserNativeAuthority';

const RUNTIME_TTL_MS = 15_000;
const EVENT_LIMIT = 100;

type RuntimeCapabilityState = 'ready' | 'missing' | 'permission_required' | 'error';
type RuntimeMode = 'read_only' | 'owner_command' | 'disabled' | 'error';

interface DesktopRuntimeReport {
  runtime: 'tauri';
  mode: RuntimeMode;
  available: boolean;
  screenCapture: RuntimeCapabilityState;
  mouseControl: RuntimeCapabilityState;
  keyboardControl: RuntimeCapabilityState;
  ownerCommandMode: boolean;
  killSwitch: 'active' | 'inactive' | 'unknown';
  overlay: 'in_app' | 'missing';
  nativeOverlayReady?: boolean;
  targeting?: 'window_relative_fallback' | 'uia_first';
  uia?: 'ready' | 'missing';
  ocr?: 'ready' | 'missing';
  multiMonitor?: 'virtual_desktop' | 'missing';
  verification?: 'post_observation_required' | 'unavailable';
  sessionExpiresAt?: number;
  safeMessage: string;
  lastError?: string | null;
  reportedAt: number;
}

interface ComputerUseRouterOptions {
  activateStop?: () => void;
  stopReceipts?: NativeStopReceiptRegistry;
  nativeBrowserAuthority?:BrowserNativeAuthority;
}

let desktopRuntime: DesktopRuntimeReport | undefined;
const eventJournal: ComputerOperatorEvent[] = [];
let eventSequence = 0;
const realtimeJournal: TypedRealtimeEnvelopeV2[] = [];
const realtimeCursorByStream = new Map<string, number>();
const desktopContextJournal=new Map<string,{ownerBindingId:string;expiresAt:number;value:DesktopActionV2|DesktopObservationV2|ActionDispatchV2}>();
function pruneDesktopContext(){for(const [id,row] of desktopContextJournal)if(row.expiresAt<=Date.now()||!ownerSessionBindingActive(row.ownerBindingId))desktopContextJournal.delete(id);while(desktopContextJournal.size>100)desktopContextJournal.delete(desktopContextJournal.keys().next().value!);}

function currentDesktopRuntime(now = Date.now()): DesktopRuntimeReport | undefined {
  if (!desktopRuntime || now - desktopRuntime.reportedAt > RUNTIME_TTL_MS) return undefined;
  return desktopRuntime;
}

function loopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function desktopBridgeAuthorized(req: Request): boolean {
  if (!loopbackRequest(req)) return false;
  const configured = process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
  const supplied = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '')?.[1]?.trim();
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const candidate = Buffer.from(supplied);
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function desktopReporter(req: Request): boolean {
  return loopbackRequest(req) && req.header('x-edith-desktop-runtime') === 'tauri-v1';
}

function runtimeReport(value: unknown): Omit<DesktopRuntimeReport, 'reportedAt'> | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const capability = (state: unknown): state is RuntimeCapabilityState => ['ready', 'missing', 'permission_required', 'error'].includes(String(state));
  if (input.runtime !== 'tauri'
    || !['read_only', 'owner_command', 'disabled', 'error'].includes(String(input.mode))
    || typeof input.available !== 'boolean'
    || !capability(input.screenCapture)
    || !capability(input.mouseControl)
    || !capability(input.keyboardControl)
    || typeof input.ownerCommandMode !== 'boolean'
    || !['active', 'inactive', 'unknown'].includes(String(input.killSwitch))
    || !['in_app', 'missing'].includes(String(input.overlay))
    || typeof input.safeMessage !== 'string') return null;
  return {
    runtime: 'tauri',
    mode: input.mode as RuntimeMode,
    available: input.available,
    screenCapture: input.screenCapture,
    mouseControl: input.mouseControl,
    keyboardControl: input.keyboardControl,
    ownerCommandMode: input.ownerCommandMode,
    killSwitch: input.killSwitch as DesktopRuntimeReport['killSwitch'],
    overlay: input.overlay as DesktopRuntimeReport['overlay'],
    nativeOverlayReady: input.nativeOverlayReady===true,
    targeting: input.targeting === 'uia_first' ? 'uia_first' : 'window_relative_fallback',
    uia: input.uia === 'ready' ? 'ready' : 'missing',
    ocr: input.ocr === 'ready' ? 'ready' : 'missing',
    multiMonitor: input.multiMonitor === 'virtual_desktop' ? 'virtual_desktop' : 'missing',
    verification: input.verification === 'post_observation_required' ? 'post_observation_required' : 'unavailable',
    sessionExpiresAt: typeof input.sessionExpiresAt === 'number' ? input.sessionExpiresAt : undefined,
    safeMessage: input.safeMessage.slice(0, 500),
    lastError: typeof input.lastError === 'string' ? input.lastError.slice(0, 500) : null,
  };
}

function addEvent(event: ComputerOperatorEvent): void {
  eventJournal.push({ ...event, sequence: ++eventSequence });
  if (eventJournal.length > EVENT_LIMIT) eventJournal.splice(0, eventJournal.length - EVENT_LIMIT);
}

function safeEvent(value: unknown): ComputerOperatorEvent | null {
  if (!isComputerOperatorEvent(value)) return null;
  const event: ComputerOperatorEvent = {
    contractVersion: value.contractVersion,
    id: value.id.slice(0, 80),
    sequence: value.sequence,
    type: value.type,
    createdAt: value.createdAt,
  };
  if (typeof value.message === 'string') event.message = value.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
  if (typeof value.safeMessage === 'string') event.safeMessage = value.safeMessage.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
  if (Number.isInteger(value.x) && Number.isInteger(value.y)
    && Math.abs(Number(value.x)) <= 32768 && Math.abs(Number(value.y)) <= 32768) {
    event.x = Number(value.x);
    event.y = Number(value.y);
  }
  if (typeof value.textPreview === 'string') {
    const preview = value.textPreview.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
    event.textPreview = preview === 'EDITH_COMPUTER_USE_OK' || /^\[redacted \d+ chars\]$/.test(preview)
      ? preview
      : `[redacted ${Array.from(preview).length} chars]`;
  }
  for (const key of ['sessionId', 'planId', 'stepId', 'observationId', 'actionId'] as const) {
    const field = value[key];
    if (typeof field === 'string') event[key] = field.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120);
  }
  if (value.verificationStatus && ['verified', 'partial', 'pending_post_observation'].includes(value.verificationStatus)) {
    event.verificationStatus = value.verificationStatus;
  }
  return event;
}

function containsForbiddenDesktopEventMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenDesktopEventMaterial);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) =>
    ['imageDataUrl', 'pixels', 'pixelData', 'base64', 'rawText', 'typedText'].includes(key)
    || containsForbiddenDesktopEventMaterial(child));
}

function safeRealtimeEvent(value: unknown,ownerBindingId:string): TypedRealtimeEnvelopeV2 | null {
  if (containsForbiddenDesktopEventMaterial(value)) return null;
  pruneDesktopContext();
  const payload=(value as any)?.payload;
  const get=(kind:string,id:string)=>{const row=desktopContextJournal.get(`${kind}:${id}`);return row?.ownerBindingId===ownerBindingId?row.value:undefined;};
  const action=get('action',payload?.actionId) as DesktopActionV2|undefined,preObservation=get('observation',payload?.preObservationId) as DesktopObservationV2|undefined,postObservation=get('observation',payload?.postObservationId) as DesktopObservationV2|undefined;
  const context:DesktopVerificationContextV2|undefined=action&&preObservation&&postObservation?{action,preObservation,postObservation,dispatch:get('dispatch',payload?.dispatchId) as ActionDispatchV2|undefined}:undefined;
  const parsed = parseRealtimeEnvelopeV2_1(value,{desktopVerificationContext:context});
  if (!parsed.success || !parsed.value.event.startsWith('desktop.')) return null;
  if(parsed.value.event==='desktop.action.requested.v2' && ['text_inserted','foreground_window_focused'].includes((parsed.value.payload as DesktopActionV2).expectedEffect)){
    const requested=parsed.value.payload as DesktopActionV2;
    const pre=get('observation',requested.observationId) as DesktopObservationV2|undefined;
    if(!pre||parseDesktopActionV2(requested,{observation:pre}).success===false)return null;
  }
  return parsed.value as TypedRealtimeEnvelopeV2;
}

export function resetComputerUseRuntimeForTests(): void {
  desktopRuntime = undefined;
  eventJournal.splice(0, eventJournal.length);
  eventSequence = 0;
  realtimeJournal.splice(0, realtimeJournal.length);
  realtimeCursorByStream.clear();
  desktopContextJournal.clear();
}

export function computerUseStatus(options: { killSwitchActive?: boolean } = {}) {
  const blocked = options.killSwitchActive ?? killSwitchService.status().active;
  const reported = currentDesktopRuntime();
  const checkedAt = new Date().toISOString();
  const ownerCommandMode = Boolean(reported?.ownerCommandMode && !blocked);
  const ready = Boolean(ownerCommandMode
    && reported?.screenCapture === 'ready'
    && reported.mouseControl === 'ready'
    && reported.keyboardControl === 'ready');
  const runtime = reported?.runtime ?? 'browser_only';
  const mode = blocked ? 'disabled' : reported?.mode ?? 'read_only';
  const available = Boolean(reported?.available && !blocked);
  const limitations = reported
    ? [
      ready ? 'Owner-approved local session is active.' : 'Screen and input actions require an active owner-approved desktop session.',
      'HTTP endpoints never inject mouse or keyboard input.',
      reported.multiMonitor === 'virtual_desktop'
        ? 'Native capture uses Windows virtual-desktop physical coordinates; per-monitor DPI metadata is included in observations.'
        : 'Multi-monitor capture is unavailable.',
      reported.uia === 'ready' ? 'Accessibility targeting is available.' : 'UIA and OCR semantic targeting are not connected; actions are restricted to the observed foreground window.',
      reported.nativeOverlayReady ? 'Native physical-coordinate overlay and emergency hotkey are active.' : 'Native overlay is unavailable in the current session.',
      'Only Notepad and Calculator are allowed through the local app launcher.',
    ]
    : ['No native desktop heartbeat is active.', 'Open the Tauri desktop app; browser mode cannot observe or control devices.'];
  return {
    available,
    mode,
    runtime,
    screenCapture: blocked ? 'error' : reported?.screenCapture ?? 'missing',
    mouseControl: blocked ? 'error' : reported?.mouseControl ?? 'missing',
    keyboardControl: blocked ? 'error' : reported?.keyboardControl ?? 'missing',
    overlay: !blocked && (reported?.nativeOverlayReady || reported?.overlay === 'in_app') ? 'ready' : 'disabled',
    ownerCommandMode,
    killSwitch: blocked,
    lastError: reported?.lastError ?? (reported?.mode === 'error' ? reported.safeMessage : null),
    safeMessage: blocked
      ? 'Emergency stop is active.'
      : reported?.safeMessage ?? 'The HTTP backend has no native device control. Open the Tauri desktop app for an owner-approved local session.',
    skillId: 'computer_use',
    status: blocked ? 'blocked' : ready ? 'ready' : 'configuration_required',
    capabilities: reported
      ? ['observeScreen', 'getScreenshot', 'moveMouse', 'clickMouse', 'typeText', 'pressKey', 'hotkey', 'scroll', 'launchApprovedApp', 'stop']
      : ['status', 'stop'],
    limitations,
    requiredPermissions: ready ? [] : ['owner_approval', 'computer:control'],
    endpoints: ['/api/computer-use/status', '/api/computer-use/observe', '/api/computer-use/action', '/api/computer-use/stop', '/api/computer-use/events', '/api/computer-use/realtime-events'],
    lastChecked: checkedAt,
  } as const;
}

export function validateComputerUseAction(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Action payload must be an object.';
  const input = value as Record<string, unknown>;
  const action = input.action;
  if (typeof action !== 'string') return 'Action name is required.';
  if (action === 'moveMouse' || action === 'clickMouse' || action === 'click') {
    if (!Number.isInteger(input.x) || !Number.isInteger(input.y)) return 'Mouse coordinates must be integers.';
    if (Math.abs(input.x as number) > 32768 || Math.abs(input.y as number) > 32768) return 'Mouse coordinates exceed the virtual desktop safety range.';
    if ((action === 'clickMouse' || action === 'click') && input.button !== undefined && !['left', 'right'].includes(String(input.button))) return 'Unsupported mouse button.';
    return null;
  }
  if (action === 'typeText') return typeof input.text === 'string' && input.text.length > 0 && input.text.length <= 200 && !/[\x00-\x1f\x7f]/.test(input.text) ? null : 'Text must contain 1 to 200 printable characters.';
  const allowedKey = (key: unknown) => typeof key === 'string' && /^(?:[A-Z]|CTRL|SHIFT|ALT|ESC|TAB|ENTER|LEFT|RIGHT|UP|DOWN|F5)$/.test(key.toUpperCase());
  if (action === 'pressKey') return allowedKey(input.key) ? null : 'Unsupported key.';
  if (action === 'hotkey') {
    const keys = Array.isArray(input.keys) ? input.keys.map((key) => String(key).toUpperCase()) : [];
    return keys.length >= 2 && keys.length <= 3
      && keys.every(allowedKey)
      && ['CTRL', 'SHIFT'].includes(keys[0])
      && !keys.includes('ALT')
      && !keys.includes('ESC')
      ? null
      : 'Hotkey requires 2 or 3 approved keys, Ctrl or Shift first, and cannot include Alt or Escape.';
  }
  if (action === 'scroll') return Number.isInteger(input.delta) && Math.abs(input.delta as number) <= 1200 && input.delta !== 0 ? null : 'Scroll delta must be between -1200 and 1200.';
  if (action === 'launchApp') return ['notepad', 'calculator'].includes(String(input.app)) ? null : 'Application is outside the approved local allowlist.';
  return 'Unsupported or unsafe Computer Use action.';
}

export function createComputerUseRouter(options: ComputerUseRouterOptions = {}): Router {
  const router = Router();
  const nativeBrowser=options.nativeBrowserAuthority??browserNativeAuthority;
  // Independent private namespace: no owner/body/native report can mint an original attempt.
  for(const action of NATIVE_PRIVATE_ACTIONS)router.all(NATIVE_BROWSER_PRIVATE_BASE+'/'+action,async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try {return res.json({success:true,result:await nativeBrowser.handlePrivate(req,action)});}
    catch(error){return res.status(error instanceof BrowserNativeAuthorityError?error.status:503).json({success:false,errorCode:error instanceof BrowserNativeAuthorityError?error.code:'NATIVE_BROWSER_UNAVAILABLE'});}
  });
  // Paths are returned only to the private native bearer transport, never to
  // the owner UI or public Files response. Owner/kill/source are checked again.
  const nativeFilesFailure = (res: Response,error: unknown) => res.status(error instanceof FileServiceError?error.status:503).json({success:false,errorCode:error instanceof FileServiceError?error.code:'FILES_NATIVE_UNAVAILABLE'});
  const native=getNativeTaskBinding();native.recover();
  router.use('/api/computer-use/workflows',requireOwnerSession,requireSameOrigin,(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  router.post('/api/computer-use/workflows',...requireProtectedMutation,(req,res)=>{try{return res.json({success:true,...native.create(getOwnerSession(req)!,req.body,req.get('x-idempotency-key')??'')});}catch(error){return nativeFilesFailure(res,error);}});
  router.get('/api/computer-use/workflows/:bindingId',(req,res)=>{try{return res.json({success:true,...native.read(req.params.bindingId,getOwnerSession(req)!.bindingId)});}catch(error){return nativeFilesFailure(res,error);}});
  router.post('/api/computer-use/workflows/:bindingId/cancel',...requireProtectedMutation,(req,res)=>{try{if(req.body!==undefined&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length))throw new FileServiceError('NATIVE_BINDING_INPUT_INVALID');const b=native.read(req.params.bindingId,getOwnerSession(req)!.bindingId);native.cancelTask(b.taskId,'cancel');return res.json({success:true,...native.read(req.params.bindingId,getOwnerSession(req)!.bindingId)});}catch(error){return nativeFilesFailure(res,error);}});
  for(const namespace of ['native-workflows','native-explorer-find'])router.use('/api/computer-use/'+namespace,(req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!desktopBridgeAuthorized(req)||(req.get('origin')&&req.get('origin')!==`${req.protocol}://${req.get('host')}`))return res.status(401).json({success:false,errorCode:'native_bridge_unauthorized'});if(Object.keys(req.query).length)return res.status(400).json({success:false,errorCode:'NATIVE_QUERY_INVALID'});next();});
  router.get('/api/computer-use/native-workflows/owner-context',(req,res)=>{
    if(req.body!==undefined&&(req.body===null||typeof req.body!=='object'||Object.keys(req.body).length>0)||Number(req.get('content-length')??0)>0||req.get('transfer-encoding'))return res.status(400).json({success:false,errorCode:'NATIVE_OWNER_CONTEXT_INPUT_INVALID'});
    if(killSwitchService.status().active)return res.status(423).json({success:false,errorCode:'KILL_SWITCH_ACTIVE'});
    const owner=getSoleActiveOwnerSession();
    if(!owner)return res.status(501).json({success:false,errorCode:'NATIVE_OWNER_CONTEXT_UNAVAILABLE'});
    return res.json({success:true,context:{ownerBindingId:owner.bindingId,ownerExpiresAt:owner.expiresAt}});
  });
  router.post('/api/computer-use/native-workflows/session',(req,res)=>{try{return res.json({success:true,...native.registerSession(req.body)});}catch(error){return nativeFilesFailure(res,error);}});
  router.post('/api/computer-use/native-workflows/associate',(req,res)=>{try{return res.json({success:true,source:native.associate(req.body)});}catch(error){return nativeFilesFailure(res,error);}});
  router.get('/api/computer-use/native-workflows/:bindingId/source',(req,res)=>{try{return res.json({success:true,source:native.source(req.params.bindingId)});}catch(error){return nativeFilesFailure(res,error);}});
  router.post('/api/computer-use/native-workflows/:bindingId/target',(req,res)=>{try{return res.json({success:true,...native.bindTarget(req.params.bindingId,req.body)});}catch(error){return nativeFilesFailure(res,error);}});
  for(const action of ['check','step','finish','cancel'] as const)router.post('/api/computer-use/native-workflows/:bindingId/'+action,(req,res)=>{try{const id=req.params.bindingId,result=action==='check'?native.check(id,req.body):action==='step'?native.step(id,req.body):action==='finish'?native.finish(id,req.body):native.cancelPrivate(id,req.body);return res.json({success:true,result});}catch(error){return nativeFilesFailure(res,error);}});
  router.get('/api/computer-use/native-explorer-find/next',(_req,res)=>{try{return res.json({success:true,job:claimNativeFind()});}catch(error){return nativeFilesFailure(res,error);}});
  router.get('/api/computer-use/native-explorer-find/:operationId/source',(req,res)=>{try{return res.json({success:true,source:nativeFindSource(req.params.operationId,req.get('x-edith-find-claim')??'')});}catch(error){return nativeFilesFailure(res,error);}});
  for(const action of ['check','finish','cancel'] as const)router.post('/api/computer-use/native-explorer-find/:operationId/'+action,(req,res)=>{try{const result=action==='check'?checkNativeFind(req.params.operationId,req.body):action==='finish'?finishNativeFind(req.params.operationId,req.body):cancelNativeFind(req.params.operationId,req.body);return res.json({success:true,...(action==='check'?{permit:result}:{})});}catch(error){return nativeFilesFailure(res,error);}});
  // Separate private Explorer queue. The existing native-files and desktop
  // context/action guards remain unchanged. Forwarded headers cannot authorize.
  router.use('/api/computer-use/native-explorer',(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(!desktopBridgeAuthorized(req)||(req.get('origin')&&req.get('origin')!==`${req.protocol}://${req.get('host')}`))return res.status(401).json({success:false,errorCode:'native_bridge_unauthorized'});
    if(Object.keys(req.query).length)return res.status(400).json({success:false,errorCode:'EXPLORER_NATIVE_QUERY_INVALID'});
    next();
  });
  router.get('/api/computer-use/native-explorer/next',(_req,res)=>{
    try{return res.json({success:true,job:claimNativeExplorer()});}catch(error){return nativeFilesFailure(res,error);}
  });
  router.get('/api/computer-use/native-explorer/:operationId/source',(req,res)=>{
    try{const claim=req.get('x-edith-explorer-claim');if(!claim)throw new FileServiceError('EXPLORER_NATIVE_CLAIM_INVALID',409);return res.json({success:true,source:nativeExplorerSource(req.params.operationId,claim)});}catch(error){return nativeFilesFailure(res,error);}
  });
  for(const action of ['check','readback','finish','cancel','quarantine'] as const)router.post('/api/computer-use/native-explorer/:operationId/'+action,(req,res)=>{
    try {
      const result=action==='check'?checkNativeExplorer(req.params.operationId,req.body):action==='readback'?readbackNativeExplorer(req.params.operationId,req.body):action==='finish'?finishNativeExplorer(req.params.operationId,req.body):action==='quarantine'?registerNativeExplorerQuarantine(req.params.operationId,req.body):cancelNativeExplorer(req.params.operationId,req.body);
      return res.json({success:true,...(action==='check'?{permit:result}:action==='readback'?{readback:result}:action==='quarantine'?{quarantine:result}:{})});
    }catch(error){return nativeFilesFailure(res,error);}
  });
  router.get('/api/computer-use/native-files/next',(req,res)=>{
    if(!desktopBridgeAuthorized(req))return res.status(401).json({success:false,errorCode:'native_bridge_unauthorized'});
    res.setHeader('Cache-Control','no-store');
    try{return res.json({success:true,job:claimNativeFileOpen()});}catch(error){return nativeFilesFailure(res,error);}
  });
  router.get('/api/computer-use/native-files/:operationId/source',(req,res)=>{
    if(!desktopBridgeAuthorized(req))return res.status(401).json({success:false,errorCode:'native_bridge_unauthorized'});
    res.setHeader('Cache-Control','no-store');
    try{return res.json({success:true,source:nativeFileOpenSource(req.params.operationId)});}catch(error){return nativeFilesFailure(res,error);}
  });
  router.post('/api/computer-use/native-files/:operationId/receipt',(req,res)=>{
    if(!desktopBridgeAuthorized(req))return res.status(401).json({success:false,errorCode:'native_bridge_unauthorized'});
    try{finishNativeFileOpen(req.params.operationId,req.body?.receipt);return res.json({success:true});}catch(error){return nativeFilesFailure(res,error);}
  });
  router.get('/api/computer-use/status', (_req, res) => res.json(computerUseStatus()));

  const stopReceipts = options.stopReceipts ?? nativeStopReceipts;
  const safetyFailure = (res: Response, error: unknown) => res.status(error instanceof NativeStopReceiptError ? error.status : 503).json({success:false,errorCode:error instanceof NativeStopReceiptError ? error.code : 'NATIVE_STOP_UNAVAILABLE'});
  router.use('/api/computer-use/native-safety',(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(!desktopBridgeAuthorized(req) || (req.get('origin') && req.get('origin') !== `${req.protocol}://${req.get('host')}`)) return res.status(401).json({success:false,errorCode:'native_bridge_unauthorized'});
    if(Object.keys(req.query).length) return res.status(400).json({success:false,errorCode:'NATIVE_QUERY_INVALID'});
    next();
  });
  router.get('/api/computer-use/native-safety', (req,res)=>{
    try {
      if(Number(req.get('content-length')??0)>0 || req.get('transfer-encoding') || (req.body && Object.keys(req.body).length)) return res.status(400).json({success:false,errorCode:'NATIVE_STOP_INPUT_INVALID'});
      const stopRequest = stopReceipts.safety(req.get('x-edith-safety-session')??'');
      return res.json({success:true,killSwitchActive:killSwitchService.status().active,stopRequest});
    } catch(error) { return safetyFailure(res,error); }
  });
  router.post('/api/computer-use/native-safety/session',(req,res)=>{
    try {
      if(killSwitchService.status().active) return res.status(423).json({success:false,errorCode:'KILL_SWITCH_ACTIVE'});
      const owner = getSoleActiveOwnerSession();
      if(!owner) return res.status(501).json({success:false,errorCode:'NATIVE_OWNER_CONTEXT_UNAVAILABLE'});
      return res.status(201).json({success:true,...stopReceipts.register(req.body,owner)});
    } catch(error) { return safetyFailure(res,error); }
  });
  router.post('/api/computer-use/native-safety/session/retire',(req,res)=>{
    try {
      if(req.get('x-edith-safety-session') !== req.body?.safetySessionRef) return res.status(401).json({success:false,errorCode:'NATIVE_STOP_SCOPE_INVALID'});
      return res.json({success:true,...stopReceipts.retire(req.body)});
    } catch(error) { return safetyFailure(res,error); }
  });
  router.post('/api/computer-use/native-safety/stop-receipt',(req,res)=>{
    try {
      if(req.get('x-edith-safety-session') !== req.body?.safetySessionRef) return res.status(401).json({success:false,errorCode:'NATIVE_STOP_SCOPE_INVALID'});
      return res.json({success:true,...stopReceipts.receipt(req.body)});
    } catch(error) { return safetyFailure(res,error); }
  });

  router.post('/api/computer-use/runtime', ...requireProtectedMutation, (req, res) => {
    if (!desktopReporter(req)) return res.status(403).json({ success: false, errorCode: 'desktop_reporter_required', safeMessage: 'Runtime reports are accepted only from the local Tauri bridge.' });
    const report = runtimeReport(req.body);
    if (!report) return res.status(400).json({ success: false, errorCode: 'validation_error', safeMessage: 'Invalid desktop runtime report.' });
    desktopRuntime = { ...report, reportedAt: Date.now() };
    if(!report.ownerCommandMode)desktopContextJournal.clear();
    return res.json({ success: true, status: computerUseStatus() });
  });

  const nativeRequired = (_req: Request, res: Response) =>
    res.status(409).json({ success: false, errorCode: 'tauri_required', safeMessage: 'Use the owner-approved Tauri desktop session. HTTP cannot control devices.' });
  router.post('/api/computer-use/observe', nativeRequired);
  router.post('/api/computer-use/action', (req, res) => {
    const issue = validateComputerUseAction(req.body);
    if (issue) return res.status(400).json({ success: false, errorCode: 'validation_error', safeMessage: issue });
    return nativeRequired(req, res);
  });

  router.post('/api/computer-use/stop', ...requireProtectedMutation, (_req, res) => {
    if (!loopbackRequest(_req)) return res.status(403).json({ success: false, errorCode: 'local_request_required', safeMessage: 'Computer Use stop is accepted only from the local machine.' });
    if (options.activateStop) options.activateStop();
    else killSwitchService.activate('Computer Use stop endpoint invoked.', 'computer-use-api');
    desktopRuntime = desktopRuntime ? {
      ...desktopRuntime,
      mode: 'disabled',
      available: false,
      ownerCommandMode: false,
      nativeOverlayReady: false,
      screenCapture: 'error',
      mouseControl: 'error',
      keyboardControl: 'error',
      killSwitch: 'active',
      sessionExpiresAt: undefined,
      safeMessage: 'Emergency stop is active.',
      reportedAt: Date.now(),
    } : undefined;
    addEvent(createComputerOperatorEvent('stopped', 'Computer Use stop endpoint invoked.'));
    desktopContextJournal.clear();
    return res.json({ success: true, stopped: true, killSwitch: options.activateStop ? undefined : true, safeMessage: 'Computer Use stop signal accepted.' });
  });

  router.get('/api/computer-use/events', (_req, res) => res.json({ events: [...eventJournal], safeMessage: 'Events are sanitized status metadata; screenshots and typed text are not stored here.' }));
  router.post('/api/computer-use/events', ...requireProtectedMutation, (req, res) => {
    if (!desktopReporter(req)) return res.status(403).json({ success: false, errorCode: 'desktop_reporter_required', safeMessage: 'Events are accepted only from the local Tauri bridge.' });
    const event = safeEvent(req.body);
    if (!event) return res.status(400).json({ success: false, errorCode: 'validation_error', safeMessage: 'Invalid Computer Use event.' });
    addEvent(event);
    return res.status(202).json({ success: true });
  });
  router.get('/api/computer-use/realtime-events', (_req, res) => res.json({
    events: [...realtimeJournal],
    safeMessage: 'Canonical desktop events contain contract metadata only; screenshots and typed text are not stored.',
  }));
  router.post('/api/computer-use/realtime-events', ...requireProtectedMutation, (req, res) => {
    if (!desktopReporter(req)) return res.status(403).json({ success: false, errorCode: 'desktop_reporter_required', safeMessage: 'Realtime events are accepted only from the local Tauri bridge.' });
    const ownerBindingId=getOwnerSession(req)?.bindingId;
    if(!ownerBindingId)return res.status(401).json({success:false,errorCode:'owner_session_required'});
    const event = safeRealtimeEvent(req.body,ownerBindingId);
    if (!event) return res.status(400).json({ success: false, errorCode: 'invalid_desktop_realtime_event', safeMessage: 'Desktop realtime event failed schema or redaction validation.' });
    const previousCursor = realtimeCursorByStream.get(event.streamId) ?? 0;
    if (event.cursor !== previousCursor + 1 || event.sequence !== event.cursor) {
      return res.status(409).json({ success: false, errorCode: 'desktop_event_out_of_order', safeMessage: 'Desktop realtime event cursor is out of order.' });
    }
    realtimeCursorByStream.set(event.streamId, event.cursor);
    realtimeJournal.push(event);
    if(event.event==='desktop.observation.v2'){const observation=event.payload as DesktopObservationV2;desktopContextJournal.set(`observation:${observation.observationId}`,{ownerBindingId,expiresAt:Date.parse(observation.expiresAt),value:observation});}
    if(event.event==='desktop.action.requested.v2'){const action=event.payload as DesktopActionV2;const pre=desktopContextJournal.get(`observation:${action.observationId}`);desktopContextJournal.set(`action:${action.actionId}`,{ownerBindingId,expiresAt:pre?.expiresAt??Date.parse(action.deadlineAt),value:action});}
    if(event.event==='desktop.action.dispatch.v2'){const dispatch=event.payload as ActionDispatchV2;const action=desktopContextJournal.get(`action:${dispatch.actionId}`);if(action?.ownerBindingId===ownerBindingId)desktopContextJournal.set(`dispatch:${dispatch.dispatchId}`,{ownerBindingId,expiresAt:action.expiresAt,value:dispatch});}
    pruneDesktopContext();
    if (realtimeJournal.length > EVENT_LIMIT) realtimeJournal.splice(0, realtimeJournal.length - EVENT_LIMIT);
    return res.status(202).json({ success: true, cursor: event.cursor });
  });
  return router;
}
