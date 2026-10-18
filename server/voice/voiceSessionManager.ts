import { WebSocket, WebSocketServer } from "ws";
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, Server } from "http";
import {
  GEMINI_LIVE_INPUT_MIME,
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_OUTPUT_MIME,
  type GeminiLiveProvider,
  type GeminiLiveSession,
  type VoiceClientEvent,
  type VoiceLiveErrorCode,
  type VoiceLiveState,
  type VoiceLiveStatus,
  type VoiceServerEvent,
} from "./types";
import { GoogleGeminiLiveProvider } from "./geminiLiveProvider";
import { buildEdithCoreBehaviorContext } from "../../src/edith/coreBehaviorProtocol";
import { getOwnerSession, ownerSessionBindingActive, onOwnerSessionInvalidated } from '../security/ownerSession';
import type { Request } from 'express';
import { DEFAULT_ASSISTANT_ID, isAssistantPersona } from '../../src/config/assistantProfileRegistry';
import { VoiceSkillDispatch, type VoiceSkillTranscript } from '../../src/edith/voiceSkillDispatch';
import { isCryptoVoiceCommand } from './cryptoVoiceCommands';
import {classifyHudCommand} from './hudCommands';
import {workspaceManager} from '../../src/edith/workspaceManager';
import {killSwitchService} from '../../src/edith/killSwitch';
import {hudSafeId,isVoiceTaskAdmittedV1,isHudPresentationV1,type TrustedVoiceDispatchHooksV1} from '../../src/edith/taskHudContracts';

type CapabilityContextProvider = () => Promise<string> | string;
type VoiceSkillCallback = (transcript: VoiceSkillTranscript, hooks?: TrustedVoiceDispatchHooksV1) => Promise<Record<string, unknown>>;

function safeJsonParse(value: string): VoiceClientEvent | undefined {
  try {
    const parsed = JSON.parse(value) as VoiceClientEvent;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const allowed = parsed.type === 'session:start' ? ['type', 'personaId']
      : parsed.type === 'audio:chunk' ? ['type', 'audio', 'mimeType']
      : ['session:stop', 'interrupt'].includes(parsed.type) ? ['type'] : [];
    if (!allowed.length || Object.keys(parsed).some(key => !allowed.includes(key))) return undefined;
    if (parsed.type === 'session:start' && parsed.personaId !== undefined && !isAssistantPersona(parsed.personaId)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;
}

function send(socket: WebSocket, event: VoiceServerEvent): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

export class ManagedVoiceSession {
  private liveSession: GeminiLiveSession | null = null;
  private liveReady = false;
  private state: VoiceLiveState = "disconnected";
  private generation = 0;
  private connecting: Promise<void> | null = null;
  private personaId: string = DEFAULT_ASSISTANT_ID;
  private utteranceSequence = 0;
  private utteranceId: string | null = null;
  private readonly finalUtterances = new Map<string, Promise<void>>();
  private readonly finalCommands = new Map<string, {generation:number; commandSequence:number; text:string}>();
  private commandSequence = 0;
  private readonly sessionId = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(
    private readonly socket: WebSocket,
    private readonly providerFactory: () => GeminiLiveProvider | undefined,
    private readonly capabilityContextProvider: CapabilityContextProvider,
    private readonly authorityActive: () => boolean = () => true,
    private readonly skillContext?: { ownerSessionBindingId: string; dispatch: VoiceSkillCallback; workspaceId?:()=>string|undefined },
  ) {}

  isLiveReady(): boolean {
    return this.liveReady;
  }
  isActiveSession(id: string): boolean { return this.liveReady && this.authorityActive() && id === `${this.sessionId}:${this.generation}`; }

  handleMessage(raw: WebSocket.RawData): void {
    if (!this.authorityActive()) { this.stop('owner_authority_expired'); return; }
    const message = safeJsonParse(raw.toString("utf8"));
    if (!message) {
      this.error("session_error", "Invalid Voice Room WebSocket event.");
      return;
    }

    if (message.type === "session:start") {
      void this.start(undefined, message.personaId);
      return;
    }

    if (message.type === "audio:chunk") {
      this.sendAudio(message.audio, message.mimeType);
      return;
    }

    if (message.type === "interrupt") {
      this.interrupt();
      return;
    }

    if (message.type === "session:stop") {
      this.stop("client_stop");
    }
  }

  start(openingMessage = "Opening Gemini Live session.", personaId = this.personaId): Promise<void> {
    if (!this.authorityActive()) { this.stop('owner_authority_expired'); return Promise.resolve(); }
    if (!isAssistantPersona(personaId)) { this.error('session_error', 'Unknown assistant persona.'); return Promise.resolve(); }
    if (personaId !== this.personaId) {
      if (this.liveSession || this.connecting) this.stop('persona_changed');
      this.personaId = personaId;
    }
    if (this.connecting) return this.connecting;
    if (this.liveSession && this.liveReady) return Promise.resolve();

    const provider = this.providerFactory();
    if (!provider) {
      this.error("configuration_required", "GEMINI_API_KEY was not found in backend environment.");
      return Promise.resolve();
    }

    const generation = ++this.generation;
    this.utteranceId = null;
    let ready = false;
    const announceReady = () => {
      if (generation !== this.generation || !this.authorityActive() || !this.liveSession || !ready || this.liveReady) return;
      this.liveReady = true;
      this.emit({ type: 'session:ready', sessionId: `${this.sessionId}:${generation}`, model: GEMINI_LIVE_MODEL, personaId: this.personaId });
      this.status('listening');
    };
    const work = (async () => {
    try {
      const isCurrent = () => generation === this.generation && this.authorityActive();
      this.status("connecting", openingMessage);
      let capabilityContext = '';
      try {
        capabilityContext = await this.capabilityContextProvider();
      } catch {
        // Voice remains available if the local registry cannot be read.
      }
      if (!isCurrent()) return;
      const liveSession = await provider.connect({
        onReady: (geminiSessionId) => {
          if (!isCurrent()) return;
          ready = true; announceReady();
        },
        onState: (state, safeMessage) => {
          if (!isCurrent()) return;
          if (state === 'error' || state === 'disconnected') { this.stop('provider_' + state); return; }
          if (state === 'idle') this.utteranceId = null;
          if (state === 'connecting' || this.liveReady) this.status(state, safeMessage);
        },
        onUserTranscript: (text, partial, providerUtteranceId) => {
          if (!isCurrent() || !this.liveReady) return;
          const stableId = providerUtteranceId && /^[A-Za-z0-9._:-]{1,80}$/.test(providerUtteranceId) ? providerUtteranceId : undefined;
          // No trustworthy replay lineage means no new production command identity.
          if (!partial && !stableId && this.skillContext?.workspaceId) return;
          const id = stableId
            ? providerUtteranceId : this.utteranceId ??= `utterance-${++this.utteranceSequence}`;
          if (!id) return;
          if (!partial && this.finalCommands.has(id)) return;
          this.emit({ type: 'transcript:user', text, partial, utteranceId: id });
          if (partial) return;
          if (this.finalCommands.size >= 256 || !Number.isSafeInteger(this.commandSequence + 1)) return;
          const commandSequence = ++this.commandSequence;
          this.finalCommands.set(id, {generation,commandSequence,text});
          const presentation = classifyHudCommand(text);
          if (presentation) {
            const event = {schemaVersion:1,type:'hud:presentation',generation,voiceSessionId:`${this.sessionId}:${generation}`,utteranceId:id,commandSequence,action:presentation} as const;
            if (isCurrent() && this.liveReady && isHudPresentationV1(event)) this.emit(event);
            return;
          }
          if (!partial && this.skillContext && !isCryptoVoiceCommand(text)) {
            if (this.finalUtterances.has(id)) return;
            if (this.finalUtterances.size >= 256) { this.stop('voice_utterance_limit'); return; }
            const dispatch = async () => {
              if (!isCurrent() || !this.liveReady) return;
              const voiceSessionId = `${this.sessionId}:${generation}`;
              const ownerSessionBindingId = this.skillContext!.ownerSessionBindingId;
              let workspaceId: string | undefined;
              try { workspaceId = this.skillContext!.workspaceId?.(); }
              catch {
                this.emit({type:'skill:result',utteranceId:id,outcome:'attention_required',reasonCode:'VOICE_SKILL_EXECUTION_BLOCKED'});
                return;
              }
              let hooks: TrustedVoiceDispatchHooksV1 | undefined;
              if (stableId && hudSafeId(workspaceId)) {
                const assertCurrent = () => {
                  if (!isCurrent() || !this.liveReady || this.socket.readyState !== WebSocket.OPEN) throw new Error('OWNER_SESSION_REQUIRED');
                  if (this.skillContext!.workspaceId?.() !== workspaceId) throw new Error('TASK_HUD_STALE_SCOPE');
                  killSwitchService.assertAllowed('task_creation','owner');
                  killSwitchService.assertAllowed('tool_execution','owner');
                  return {ownerSessionBindingId,workspaceId,voiceSessionId,utteranceId:id,commandSequence};
                };
                hooks = {taskAdmission:{assertCurrent},onTaskAdmitted: admission => {
                  assertCurrent();
                  if (commandSequence !== this.commandSequence) return;
                  const event = {schemaVersion:1,type:'skill:task_admitted',generation,voiceSessionId,utteranceId:id,commandSequence,
                    taskId:admission.taskId,skillId:admission.skillId,revision:admission.revision,eventSequence:admission.eventSequence,admittedAt:admission.admittedAt} as const;
                  if (isVoiceTaskAdmittedV1(event)) this.emit(event);
                }};
              }
              let result: Record<string, unknown>;
              try {
                result = await this.skillContext!.dispatch({ ownerSessionBindingId,
                  voiceSessionId, utteranceId: id, text, isFinal: true },hooks);
              } catch {
                result = { outcome: 'attention_required', reasonCode: 'VOICE_SKILL_EXECUTION_BLOCKED' };
              }
              if (!isCurrent() || !this.liveReady || commandSequence !== this.commandSequence) return;
              const taskId = typeof result.taskId === 'string' ? result.taskId : undefined;
              const verificationStatus = typeof result.verificationStatus === 'string' ? result.verificationStatus : undefined;
              this.emit({ type: 'skill:result', utteranceId: id,
                outcome: result.outcome === 'completed' && (!taskId || verificationStatus !== 'PASS') ? 'attention_required' : String(result.outcome ?? 'attention_required'),
                taskId, verificationStatus, skillId: typeof result.skillId === 'string' ? result.skillId : undefined,
                reasonCode: typeof result.reasonCode === 'string' ? result.reasonCode : undefined, idempotentReplay: result.idempotentReplay === true });
            };
            const pending = Promise.resolve().then(dispatch);
            this.finalUtterances.set(id, pending);
          }
        },
        onAssistantTranscript: (text, partial) => {
          // SDK output has no proven command identity. Preserve ordinary conversation;
          // provider narration is never a canonical task event or verified report.
          if (isCurrent() && this.liveReady) this.emit({ type: "transcript:assistant", text, partial });
        },
        onAudio: (audio, mimeType) => {
          if (isCurrent() && this.liveReady) this.emit({ type: "audio:chunk", audio, mimeType });
        },
        onError: (errorCode, safeMessage) => {
          if (isCurrent()) { this.stop('provider_error'); this.error(errorCode, safeMessage); }
        },
        onClose: () => {
          if (isCurrent()) this.stop('provider_closed');
        },
      }, {
        systemInstruction: buildEdithCoreBehaviorContext({
          channel: 'voice',
          runtimeContext: capabilityContext,
          personaId: this.personaId,
        }),
      });
      if (!isCurrent()) {
        liveSession.close();
        return;
      }
      this.liveSession = liveSession;
      announceReady();
    } catch {
      if (generation !== this.generation) return;
      this.liveSession = null;
      this.liveReady = false;
      this.error('session_error', 'Gemini Live connection failed.');
    }
    })();
    this.connecting = work;
    const clear = () => { if (this.connecting === work) this.connecting = null; };
    void work.then(clear, clear);
    return work;
  }

  sendAudio(audio: string, mimeType = GEMINI_LIVE_INPUT_MIME): void {
    if (!this.authorityActive()) { this.stop('owner_authority_expired'); return; }
    if (!this.liveSession || !this.liveReady) {
      this.error("session_error", "Voice session is not connected yet.");
      return;
    }

    if (mimeType !== GEMINI_LIVE_INPUT_MIME || !audio || !isBase64(audio)) {
      this.error("audio_format_error", `Voice Room expects base64 ${GEMINI_LIVE_INPUT_MIME} audio chunks.`);
      return;
    }

    try { this.liveSession.sendAudio(audio, mimeType); }
    catch { this.stop('audio_send_failed'); this.error('network_error', 'Voice audio could not be sent.'); }
  }

  interrupt(): void {
    if (!this.authorityActive()) { this.stop('owner_authority_expired'); return; }
    const liveSession = this.liveSession;
    if (!liveSession) return;

    this.generation += 1;
    this.liveSession = null;
    this.liveReady = false;
    this.connecting = null;
    try {
      liveSession.close();
    } catch {
      // Reconnection below is authoritative even if close is already in progress.
    }
    void this.start("Voice response interrupted. Reconnecting Gemini Live.");
  }

  stop(reason: string): void {
    const liveSession = this.liveSession;
    this.generation += 1;
    this.liveSession = null;
    this.liveReady = false;
    this.connecting = null;
    try {
      liveSession?.endAudioStream();
      liveSession?.close();
    } catch {
      // Close is best-effort; the socket close handler will finish cleanup.
    } finally {
      this.status("disconnected", "Voice session stopped.");
      this.emit({ type: "session:ended", reason });
    }
  }

  private status(state: VoiceLiveState, safeMessage?: string): void {
    this.state = state;
    if (state === 'disconnected' || state === 'error') this.liveReady = false;
    this.emit({ type: "status", state, sessionId: this.sessionId, safeMessage });
  }

  private error(errorCode: VoiceLiveErrorCode, safeMessage: string): void {
    if (this.liveSession || this.connecting) this.stop('session_error');
    this.state = "error";
    this.liveReady = false;
    this.emit({ type: "error", errorCode, safeMessage });
    this.emit({ type: "status", state: "error", sessionId: this.sessionId, safeMessage });
  }

  private emit(event: VoiceServerEvent): void { send(this.socket, { ...event, generation: this.generation }); }
}

export class VoiceSessionManager {
  private readonly socketServer = new WebSocketServer({ noServer: true });
  private readonly sessions = new Map<WebSocket, ManagedVoiceSession>();
  private readonly ownerBindings = new Map<WebSocket, string>();
  private readonly expiryTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  private readonly unsubscribeOwner: () => void;
  private capabilityContextProvider?: CapabilityContextProvider;
  private skillDispatch?: VoiceSkillDispatch;
  private readonly dispatchAuthority = new AsyncLocalStorage<() => boolean>();

  constructor(private readonly providerFactory?: () => GeminiLiveProvider | undefined) {
    this.unsubscribeOwner = onOwnerSessionInvalidated(({ bindingId }) => {
      for (const [socket, binding] of this.ownerBindings) if (binding === bindingId) {
        this.sessions.get(socket)?.stop('owner_session_revoked'); socket.close(4003, 'owner_session_revoked');
      }
    });
    this.socketServer.on("connection", (socket, request) => {
      const owner = getOwnerSession(request as Request)!;
      this.ownerBindings.set(socket, owner.bindingId);
      const authority = () => Date.now() < owner.expiresAt && ownerSessionBindingActive(owner.bindingId);
      const session = new ManagedVoiceSession(
        socket,
        () => this.createProvider(),
        () => this.capabilityContextProvider?.() ?? '',
        authority,
        { ownerSessionBindingId: owner.bindingId, workspaceId:()=>workspaceManager.getConfig()?.workspaceId, dispatch: (transcript,hooks) => {
          this.skillDispatch ??= new VoiceSkillDispatch(undefined, undefined, bindingId => ownerSessionBindingActive(bindingId) && this.dispatchAuthority.getStore()?.() === true);
          return this.dispatchAuthority.run(() => authority() && session.isActiveSession(transcript.voiceSessionId), () => this.skillDispatch!.dispatch(transcript,hooks));
        } },
      );
      this.sessions.set(socket, session);
      const timer = setTimeout(() => { session.stop('owner_session_expired'); socket.close(4003, 'owner_session_expired'); }, Math.max(0, owner.expiresAt - Date.now()));
      timer.unref(); this.expiryTimers.set(socket, timer);
      send(socket, { type: "status", state: "idle", safeMessage: "Voice Room socket connected." });

      socket.on("message", (raw) => session.handleMessage(raw));
      socket.on("close", () => {
        session.stop("socket_closed");
        this.sessions.delete(socket);
        clearTimeout(this.expiryTimers.get(socket)); this.expiryTimers.delete(socket); this.ownerBindings.delete(socket);
      });
      socket.on("error", () => {
        session.stop("socket_error");
        this.sessions.delete(socket);
        clearTimeout(this.expiryTimers.get(socket)); this.expiryTimers.delete(socket); this.ownerBindings.delete(socket);
      });
    });
  }

  status(): VoiceLiveStatus {
    const keyPresent = Boolean(process.env.GEMINI_API_KEY);
    const connected = Array.from(this.sessions).some(([socket, session]) => socket.readyState === WebSocket.OPEN && session.isLiveReady());

    return {
      success: true,
      assistant: "JARVIS",
      model: GEMINI_LIVE_MODEL,
      configured: keyPresent,
      available: connected,
      connected,
      status: !keyPresent ? "configuration_required" : connected ? "available" : "offline",
      runtimeStatus: !keyPresent ? "configuration_required" : connected ? "connected" : "offline",
      errorCode: keyPresent ? undefined : "configuration_required",
      safeMessage: keyPresent
        ? "Gemini Live backend connector is configured. Open a Voice Room socket to start a session."
        : "GEMINI_API_KEY was not found in backend environment.",
      keyPresent,
      secretExposed: false,
      frontendCanReadApiKey: false,
      liveConnectorBound: true,
      capabilityContextBound: Boolean(this.capabilityContextProvider),
      wakeWordEnabled: false,
      ttsOutputConnected: connected,
      bargeInEnabled: connected,
      inputMimeType: GEMINI_LIVE_INPUT_MIME,
      outputMimeType: GEMINI_LIVE_OUTPUT_MIME,
      checkedAt: Date.now(),
    };
  }

  handleUpgrade(server: Server): void {
    server.on("upgrade", (request: IncomingMessage, socket, head) => {
      const path = request.url?.split("?")[0];
      if (path !== "/api/voice/live/ws") {
        return;
      }
      let owner: ReturnType<typeof getOwnerSession>;
      try { owner = getOwnerSession(request as Request); } catch { /* Malformed cookies fail closed. */ }
      const secure = Boolean((request.socket as any).encrypted);
      const expectedOrigin = `${secure ? 'https' : 'http'}://${request.headers.host}`;
      const protocols = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim());
      if (!owner || request.headers.origin !== expectedOrigin || !protocols.includes('edith.voice.v1') || !protocols.includes(`csrf.${owner.csrfToken}`)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }

      this.socketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.socketServer.emit("connection", webSocket, request);
      });
    });
  }

  setCapabilityContextProvider(provider: CapabilityContextProvider): void {
    this.capabilityContextProvider = provider;
  }

  shutdown(): void {
    this.unsubscribeOwner();
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear(); this.ownerBindings.clear();
    for (const [socket, session] of this.sessions) {
      session.stop("server_shutdown");
      socket.close(1001, "server_shutdown");
    }
    this.sessions.clear();
    this.socketServer.close();
  }

  private createProvider(): GeminiLiveProvider | undefined {
    if (this.providerFactory) return this.providerFactory();
    const apiKey = process.env.GEMINI_API_KEY;
    return apiKey ? new GoogleGeminiLiveProvider(apiKey) : undefined;
  }
}

export const voiceSessionManager = new VoiceSessionManager();
