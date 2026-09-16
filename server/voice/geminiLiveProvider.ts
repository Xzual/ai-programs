import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveServerMessage, Session } from "@google/genai";
import {
  GEMINI_LIVE_INPUT_MIME,
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_OUTPUT_MIME,
  type GeminiLiveProvider,
  type GeminiLiveSession,
  type VoiceLiveErrorCode,
} from "./types";

function classifyGeminiLiveError(error: unknown): { code: VoiceLiveErrorCode; safeMessage: string } {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  if (lower.includes("api key") || lower.includes("unauthorized") || lower.includes("permission") || lower.includes("401") || lower.includes("403")) {
    return {
      code: "invalid_api_key",
      safeMessage: "GEMINI_API_KEY was found, but Gemini rejected the Live API connection.",
    };
  }

  if (lower.includes("not found") || lower.includes("model") || lower.includes("404")) {
    return {
      code: "live_model_unavailable",
      safeMessage: "Gemini Live model is not available for this account or region.",
    };
  }

  if (lower.includes("network") || lower.includes("fetch") || lower.includes("socket") || lower.includes("econn")) {
    return {
      code: "network_error",
      safeMessage: "Could not reach Gemini Live API.",
    };
  }

  return {
    code: "session_error",
    safeMessage: "Gemini Live session failed.",
  };
}

function partText(part: any): string {
  return typeof part?.text === "string" ? part.text : "";
}

function extractText(message: LiveServerMessage): string {
  const direct = typeof (message as any).text === "string" ? (message as any).text : "";
  const modelTurnText = message.serverContent?.modelTurn?.parts?.map(partText).filter(Boolean).join(" ") ?? "";
  return direct || modelTurnText;
}

function extractAudio(message: LiveServerMessage): string | undefined {
  if (typeof (message as any).data === "string" && (message as any).data.length > 0) {
    return (message as any).data;
  }

  const inlinePart = message.serverContent?.modelTurn?.parts?.find((part: any) =>
    typeof part?.inlineData?.data === "string" &&
    String(part?.inlineData?.mimeType ?? "").startsWith("audio/")
  ) as any;
  return inlinePart?.inlineData?.data;
}

export class GoogleGeminiLiveProvider implements GeminiLiveProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async connect(callbacks: Parameters<GeminiLiveProvider["connect"]>[0]): Promise<GeminiLiveSession> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    let sdkSession: Session | undefined;

    try {
      callbacks.onState("connecting", "Connecting to Gemini Live.");
      sdkSession = await ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            languageCode: "tr-TR",
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            callbacks.onState("listening", "Gemini Live session opened.");
          },
          onmessage: (message) => {
            if (message.setupComplete) {
              callbacks.onReady(message.setupComplete.sessionId);
              callbacks.onState("listening");
            }

            const inputTranscript = message.serverContent?.interimInputTranscription?.text ?? message.serverContent?.inputTranscription?.text;
            if (inputTranscript) {
              callbacks.onUserTranscript(inputTranscript, Boolean(message.serverContent?.interimInputTranscription));
              callbacks.onState("thinking");
            }

            const outputTranscript = message.serverContent?.outputTranscription?.text ?? extractText(message);
            if (outputTranscript) {
              callbacks.onAssistantTranscript(outputTranscript, !Boolean(message.serverContent?.turnComplete));
              callbacks.onState("speaking");
            }

            const audio = extractAudio(message);
            if (audio) {
              callbacks.onAudio(audio, GEMINI_LIVE_OUTPUT_MIME);
              callbacks.onState("speaking");
            }

            if (message.serverContent?.interrupted) {
              callbacks.onState("listening", "Gemini Live response interrupted.");
            }

            if (message.serverContent?.turnComplete || message.serverContent?.waitingForInput) {
              callbacks.onState("idle");
            }
          },
          onerror: (event) => {
            const classified = classifyGeminiLiveError((event as any)?.error ?? event);
            callbacks.onError(classified.code, classified.safeMessage);
          },
          onclose: () => {
            callbacks.onClose();
          },
        },
      });
    } catch (error) {
      const classified = classifyGeminiLiveError(error);
      callbacks.onError(classified.code, classified.safeMessage);
      throw error;
    }

    return {
      sendAudio(base64Audio: string, mimeType = GEMINI_LIVE_INPUT_MIME) {
        if (mimeType !== GEMINI_LIVE_INPUT_MIME) {
          callbacks.onError("audio_format_error", `Expected ${GEMINI_LIVE_INPUT_MIME}; received ${mimeType}.`);
          return;
        }

        sdkSession?.sendRealtimeInput({
          audio: {
            data: base64Audio,
            mimeType,
          },
        });
      },
      endAudioStream() {
        sdkSession?.sendRealtimeInput({ audioStreamEnd: true });
      },
      interrupt() {
        sdkSession?.sendRealtimeInput({ activityEnd: {} });
      },
      close() {
        sdkSession?.close();
      },
    };
  }
}
