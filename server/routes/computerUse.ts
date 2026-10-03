import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { killSwitchService } from '../../src/edith/killSwitch';
import {
  parseRealtimeEnvelopeV2_1,
  type TypedRealtimeEnvelopeV2,
} from '../../src/edith/contracts';
import { createComputerOperatorEvent, isComputerOperatorEvent, type ComputerOperatorEvent } from '../../src/edith/computerOperatorEvents';
import { requireProtectedMutation } from '../security/ownerSession';

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
}

let desktopRuntime: DesktopRuntimeReport | undefined;
const eventJournal: ComputerOperatorEvent[] = [];
let eventSequence = 0;
const realtimeJournal: TypedRealtimeEnvelopeV2[] = [];
const realtimeCursorByStream = new Map<string, number>();

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

function safeRealtimeEvent(value: unknown): TypedRealtimeEnvelopeV2 | null {
  if (containsForbiddenDesktopEventMaterial(value)) return null;
  const parsed = parseRealtimeEnvelopeV2_1(value);
  if (!parsed.success || !parsed.value.event.startsWith('desktop.')) return null;
  return parsed.value as TypedRealtimeEnvelopeV2;
}

export function resetComputerUseRuntimeForTests(): void {
  desktopRuntime = undefined;
  eventJournal.splice(0, eventJournal.length);
  eventSequence = 0;
  realtimeJournal.splice(0, realtimeJournal.length);
  realtimeCursorByStream.clear();
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
      'Native overlay/capsule is not implemented; the visible guide is confined to the E.D.I.T.H. window.',
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
    overlay: reported?.overlay === 'in_app' ? 'ready' : 'disabled',
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
  router.get('/api/computer-use/status', (_req, res) => res.json(computerUseStatus()));

  router.get('/api/computer-use/native-safety', (req, res) => {
    if (!desktopBridgeAuthorized(req)) {
      return res.status(401).json({
        success: false,
        errorCode: 'native_bridge_unauthorized',
        safeMessage: 'Native safety bridge authentication failed.',
      });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      success: true,
      killSwitchActive: killSwitchService.status().active,
    });
  });

  router.post('/api/computer-use/runtime', ...requireProtectedMutation, (req, res) => {
    if (!desktopReporter(req)) return res.status(403).json({ success: false, errorCode: 'desktop_reporter_required', safeMessage: 'Runtime reports are accepted only from the local Tauri bridge.' });
    const report = runtimeReport(req.body);
    if (!report) return res.status(400).json({ success: false, errorCode: 'validation_error', safeMessage: 'Invalid desktop runtime report.' });
    desktopRuntime = { ...report, reportedAt: Date.now() };
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
      screenCapture: 'error',
      mouseControl: 'error',
      keyboardControl: 'error',
      killSwitch: 'active',
      sessionExpiresAt: undefined,
      safeMessage: 'Emergency stop is active.',
      reportedAt: Date.now(),
    } : undefined;
    addEvent(createComputerOperatorEvent('stopped', 'Computer Use stop endpoint invoked.'));
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
    const event = safeRealtimeEvent(req.body);
    if (!event) return res.status(400).json({ success: false, errorCode: 'invalid_desktop_realtime_event', safeMessage: 'Desktop realtime event failed schema or redaction validation.' });
    const previousCursor = realtimeCursorByStream.get(event.streamId) ?? 0;
    if (event.cursor !== previousCursor + 1 || event.sequence !== event.cursor) {
      return res.status(409).json({ success: false, errorCode: 'desktop_event_out_of_order', safeMessage: 'Desktop realtime event cursor is out of order.' });
    }
    realtimeCursorByStream.set(event.streamId, event.cursor);
    realtimeJournal.push(event);
    if (realtimeJournal.length > EVENT_LIMIT) realtimeJournal.splice(0, realtimeJournal.length - EVENT_LIMIT);
    return res.status(202).json({ success: true, cursor: event.cursor });
  });
  return router;
}
