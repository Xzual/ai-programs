import { WebSocket, WebSocketServer } from "ws";
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

function safeJsonParse(value: string): VoiceClientEvent | undefined {
  try {
    const parsed = JSON.parse(value) as VoiceClientEvent;
    return parsed && typeof parsed === "object" && typeof (parsed as any).type === "string" ? parsed : undefined;
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

class ManagedVoiceSession {
  private liveSession: GeminiLiveSession | null = null;
  private state: VoiceLiveState = "disconnected";
  private readonly sessionId = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(
    private readonly socket: WebSocket,
    private readonly providerFactory: () => GeminiLiveProvider | undefined,
  ) {}

  handleMessage(raw: WebSocket.RawData): void {
    const message = safeJsonParse(raw.toString("utf8"));
    if (!message) {
      this.error("session_error", "Invalid Voice Room WebSocket event.");
      return;
    }

    if (message.type === "session:start") {
      void this.start();
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

  async start(): Promise<void> {
    if (this.liveSession) {
      this.status("listening");
      return;
    }

    const provider = this.providerFactory();
    if (!provider) {
      this.error("configuration_required", "GEMINI_API_KEY was not found in backend environment.");
      return;
    }

    try {
      this.status("connecting", "Opening Gemini Live session.");
      this.liveSession = await provider.connect({
        onReady: (geminiSessionId) => {
          send(this.socket, {
            type: "session:ready",
            sessionId: geminiSessionId ?? this.sessionId,
            model: GEMINI_LIVE_MODEL,
          });
        },
        onState: (state, safeMessage) => this.status(state, safeMessage),
        onUserTranscript: (text, partial) => send(this.socket, { type: "transcript:user", text, partial }),
        onAssistantTranscript: (text, partial) => send(this.socket, { type: "transcript:assistant", text, partial }),
        onAudio: (audio, mimeType) => send(this.socket, { type: "audio:chunk", audio, mimeType }),
        onError: (errorCode, safeMessage) => this.error(errorCode, safeMessage),
        onClose: () => this.status("disconnected", "Gemini Live session closed."),
      });
    } catch {
      this.liveSession = null;
      this.status("error");
    }
  }

  sendAudio(audio: string, mimeType = GEMINI_LIVE_INPUT_MIME): void {
    if (!this.liveSession) {
      this.error("session_error", "Voice session is not connected yet.");
      return;
    }

    if (mimeType !== GEMINI_LIVE_INPUT_MIME || !audio || !isBase64(audio)) {
      this.error("audio_format_error", `Voice Room expects base64 ${GEMINI_LIVE_INPUT_MIME} audio chunks.`);
      return;
    }

    this.status("listening");
    this.liveSession.sendAudio(audio, mimeType);
  }

  interrupt(): void {
    this.liveSession?.interrupt();
    this.status("listening", "Voice response interrupted.");
  }

  stop(reason: string): void {
    try {
      this.liveSession?.endAudioStream();
      this.liveSession?.close();
    } catch {
      // Close is best-effort; the socket close handler will finish cleanup.
    } finally {
      this.liveSession = null;
      this.status("disconnected", "Voice session stopped.");
      send(this.socket, { type: "session:ended", reason });
    }
  }

  private status(state: VoiceLiveState, safeMessage?: string): void {
    this.state = state;
    send(this.socket, { type: "status", state, sessionId: this.sessionId, safeMessage });
  }

  private error(errorCode: VoiceLiveErrorCode, safeMessage: string): void {
    this.state = "error";
    send(this.socket, { type: "error", errorCode, safeMessage });
    send(this.socket, { type: "status", state: "error", sessionId: this.sessionId, safeMessage });
  }
}

export class VoiceSessionManager {
  private readonly socketServer = new WebSocketServer({ noServer: true });
  private readonly sessions = new Map<WebSocket, ManagedVoiceSession>();

  constructor() {
    this.socketServer.on("connection", (socket) => {
      const session = new ManagedVoiceSession(socket, () => this.createProvider());
      this.sessions.set(socket, session);
      send(socket, { type: "status", state: "idle", safeMessage: "Voice Room socket connected." });

      socket.on("message", (raw) => session.handleMessage(raw));
      socket.on("close", () => {
        session.stop("socket_closed");
        this.sessions.delete(socket);
      });
      socket.on("error", () => {
        session.stop("socket_error");
        this.sessions.delete(socket);
      });
    });
  }

  status(): VoiceLiveStatus {
    const keyPresent = Boolean(process.env.GEMINI_API_KEY);
    const connected = Array.from(this.sessions.keys()).some((socket) => socket.readyState === WebSocket.OPEN);

    return {
      success: true,
      assistant: "JARVIS",
      model: GEMINI_LIVE_MODEL,
      configured: keyPresent,
      available: keyPresent,
      connected,
      status: keyPresent ? "available" : "configuration_required",
      runtimeStatus: !keyPresent ? "configuration_required" : connected ? "connected" : "offline",
      errorCode: keyPresent ? undefined : "configuration_required",
      safeMessage: keyPresent
        ? "Gemini Live backend connector is configured. Open a Voice Room socket to start a session."
        : "GEMINI_API_KEY was not found in backend environment.",
      keyPresent,
      secretExposed: false,
      frontendCanReadApiKey: false,
      liveConnectorBound: true,
      wakeWordEnabled: false,
      ttsOutputConnected: keyPresent,
      bargeInEnabled: keyPresent,
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

      this.socketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.socketServer.emit("connection", webSocket, request);
      });
    });
  }

  private createProvider(): GeminiLiveProvider | undefined {
    const apiKey = process.env.GEMINI_API_KEY;
    return apiKey ? new GoogleGeminiLiveProvider(apiKey) : undefined;
  }
}

export const voiceSessionManager = new VoiceSessionManager();
