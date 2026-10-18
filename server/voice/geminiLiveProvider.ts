import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveServerMessage, Session } from "@google/genai";
import {
  GEMINI_LIVE_INPUT_MIME,
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_OUTPUT_MIME,
  type GeminiLiveProvider,
  type GeminiLiveConnectOptions,
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
  const modelTurnText = message.serverContent?.modelTurn?.parts?.map(partText).filter(Boolean).join(" ") ?? "";
  return modelTurnText;
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

/** SDK transcript chunks are partial until finished; IDs survive repeated final callbacks. */
export class VoiceTranscriptAccumulator {
  private sequence = 1;
  private confirmed = '';
  private finalized: { text: string; utteranceId: string; lastChunk: string } | null = null;
  read(chunk: { text?: string; finished?: boolean }, interim = false): { text: string; partial: boolean; utteranceId: string } | undefined {
    const text = chunk.text ?? '';
    if (!text && !chunk.finished) return undefined;
    if (this.finalized) {
      if (!interim && chunk.finished && (!text || text === this.finalized.lastChunk || text.trim() === this.finalized.text)) return { text: this.finalized.text, partial: false, utteranceId: this.finalized.utteranceId };
      this.sequence++; this.confirmed = ''; this.finalized = null;
    }
    const utteranceId = `utterance-${this.sequence}`;
    if (interim) return { text, partial: true, utteranceId };
    this.confirmed += text;
    const finished = chunk.finished === true;
    if (finished) this.finalized = { text: this.confirmed.trim(), utteranceId, lastChunk: text };
    return { text: this.confirmed.trim(), partial: !finished, utteranceId };
  }
  nextTurn(): void {
    // Preserve the final ID across trailing/repeated turn-complete notifications.
    // A new partial/interim or different final starts the next utterance.
    if (!this.finalized) { this.sequence++; this.confirmed = ''; }
  }
}

export class GoogleGeminiLiveProvider implements GeminiLiveProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async connect(
    callbacks: Parameters<GeminiLiveProvider["connect"]>[0],
    options?: GeminiLiveConnectOptions,
  ): Promise<GeminiLiveSession> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    let sdkSession: Session | undefined;
    const transcripts = new VoiceTranscriptAccumulator();

    try {
      callbacks.onState("connecting", "Connecting to Gemini Live.");
      sdkSession = await ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          ...(options?.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
          speechConfig: {
            languageCode: "tr-TR",
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            callbacks.onState("connecting", "Gemini Live transport opened; awaiting setup.");
          },
          onmessage: (message) => {
            if (message.setupComplete) {
              callbacks.onReady(message.setupComplete.sessionId);
              callbacks.onState("listening");
            }

            const transcription = message.serverContent?.interimInputTranscription ?? message.serverContent?.inputTranscription;
            const inputTranscript = transcription && transcripts.read(transcription, Boolean(message.serverContent?.interimInputTranscription));
            if (inputTranscript?.text) {
              callbacks.onUserTranscript(inputTranscript.text, inputTranscript.partial, inputTranscript.utteranceId);
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
              transcripts.nextTurn();
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
      close() {
        sdkSession?.close();
      },
    };
  }
}
