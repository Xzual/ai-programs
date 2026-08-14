import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Send, Square, AlertCircle, AudioWaveform, Radio } from 'lucide-react';
import { AiState } from '../../types';

interface VoiceBarProps {
  aiState: AiState;
  onSendMessage: (text: string) => void;
  onStopSpeech: () => void;
  onVoiceTranscript: (text: string) => void;
  isStreaming: boolean;
  handsFree?: boolean;
}

// Web Speech API desteklenip desteklenmediğini güvenli şekilde kontrol et
function detectSpeechSupport(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      (
        'SpeechRecognition' in window ||
        'webkitSpeechRecognition' in window
      )
    );
  } catch {
    return false;
  }
}

export const VoiceBar: React.FC<VoiceBarProps> = ({
  aiState,
  onSendMessage,
  onStopSpeech,
  onVoiceTranscript,
  isStreaming,
  handsFree = false,
}) => {
  const [inputText, setInputText]         = useState('');
  const [isListening, setIsListening]     = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [micError, setMicError]           = useState<string | null>(null);

  // API desteği — sadece render sırasında değil, mount sonrası set edilsin
  const [sttSupported, setSttSupported] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const handsFreeRef = useRef(handsFree);
  const busyRef = useRef(false);
  const finalTranscriptRef = useRef('');

  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);

  useEffect(() => {
    busyRef.current = isStreaming || aiState === 'speaking' || aiState === 'thinking';
  }, [isStreaming, aiState]);

  useEffect(() => {
    const supported = detectSpeechSupport();
    setSttSupported(supported);

    if (!supported) {
      // Desteklenmiyor — hata gösterme, sadece metin modunda çalış
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous    = true;
      recognition.interimResults = true;
      recognition.lang          = 'tr-TR';

      recognition.onstart = () => {
        setIsListening(true);
        setMicError(null);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscriptRef.current += `${event.results[i][0].transcript} `;
          }
        }
        setLiveTranscript(transcript);

        const finalText = finalTranscriptRef.current.trim();
        if (handsFreeRef.current && finalText && !busyRef.current) {
          finalTranscriptRef.current = '';
          setLiveTranscript('');
          onVoiceTranscript(finalText);
          try {
            recognition.stop();
          } catch {
            // Recognition may already be stopping.
          }
        }
      };

      recognition.onerror = (event: any) => {
        setIsListening(false);
        if (event.error === 'not-allowed') {
          setMicError('Mikrofon izni reddedildi. Tarayıcı adres çubuğundaki 🔒 simgesinden izin verin.');
        } else if (event.error === 'no-speech') {
          setMicError('Ses algılanamadı, tekrar deneyin.');
          setTimeout(() => setMicError(null), 3000);
        } else if (event.error === 'network') {
          setMicError('Ağ hatası — Chrome tarayıcısında ve internete bağlıyken çalışır.');
        } else {
          setMicError(`Mikrofon hatası: ${event.error}`);
          setTimeout(() => setMicError(null), 4000);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        if (handsFreeRef.current && !busyRef.current) {
          window.setTimeout(() => {
            try {
              recognition.start();
            } catch {
              // Browser may throttle restarts; user can tap mic again.
            }
          }, 600);
        }
      };

      recognitionRef.current = recognition;
    } catch (e) {
      // Recognition nesnesi oluşturulamazsa sessizce geç
      setSttSupported(false);
    }
  }, [onVoiceTranscript]);

  useEffect(() => {
    if (!handsFree || !sttSupported || !recognitionRef.current || isListening || busyRef.current) {
      return;
    }
    try {
      finalTranscriptRef.current = '';
      recognitionRef.current.start();
    } catch {
      // Requires first user permission gesture in many browsers.
    }
  }, [handsFree, sttSupported, isListening, aiState, isStreaming]);

  const toggleMic = () => {
    setMicError(null);

    if (!sttSupported || !recognitionRef.current) {
      // Desteklenmiyorsa textarea'ya odaklan
      document.getElementById('aura-text-input')?.focus();
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      if (liveTranscript.trim()) {
        onVoiceTranscript(liveTranscript.trim());
        setLiveTranscript('');
      }
    } else {
      try {
        setLiveTranscript('');
        recognitionRef.current.start();
      } catch (e: any) {
        // "already started" gibi hatalar — sessizce yutulur
        console.warn('Recognition start error:', e?.message);
      }
    }
  };

  const handleSend = () => {
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
    const textToSend = (inputText || liveTranscript).trim();
    if (!textToSend) return;

    onSendMessage(textToSend);
    setInputText('');
    setLiveTranscript('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = !!(inputText.trim() || liveTranscript.trim());

  return (
    <div className="p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xl border-t border-slate-800/80 z-20">

      {/* ── Canlı transkript veya hata bandı ─────────────────────────── */}
      {(liveTranscript || micError || isListening) && (
        <div className="mb-2 px-3 py-2 rounded-xl bg-slate-900/90 border border-[var(--edith-primary)]/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 truncate pr-2">
            {isListening && (
              <span className="flex h-2 w-2 relative shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--edith-accent)] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--edith-primary)]" />
              </span>
            )}
            {micError ? (
              <span className="text-amber-400 flex items-center gap-1.5 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {micError}
              </span>
            ) : (
          <span className="text-slate-200 font-mono italic">
                {liveTranscript || (handsFree ? 'Jarvis modu açık. Konuşmanız bekleniyor...' : 'Dinleniyor... Konuşabilirsiniz.')}
              </span>
            )}
          </div>

          {liveTranscript && (
            <button
              onClick={handleSend}
              className="px-2 py-0.5 rounded bg-[var(--edith-primary)] hover:opacity-90 text-slate-950 text-[11px] font-medium shrink-0 transition-opacity"
            >
              Gönder
            </button>
          )}
        </div>
      )}

      {/* ── Ana giriş satırı ──────────────────────────────────────────── */}
      <div className="flex items-end gap-2">

        {/* Mikrofon butonu */}
        <button
          onClick={toggleMic}
          title={
            !sttSupported
              ? 'Ses tanıma bu ortamda desteklenmiyor (Chrome + HTTPS gerektirir)'
              : isListening
              ? 'Mikrofonu Kapat'
              : 'Mikrofonu Aç'
          }
          className={`p-3 rounded-2xl border transition-all duration-300 shrink-0 relative ${
            !sttSupported
              ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
              : isListening
              ? 'bg-[var(--edith-primary)] border-[var(--edith-accent)] text-slate-950 shadow-lg scale-105'
              : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300 hover:text-white'
          }`}
        >
          {isListening ? (
            <AudioWaveform className="w-5 h-5 text-white animate-pulse" />
          ) : sttSupported ? (
            <Mic className="w-5 h-5" />
          ) : (
            <MicOff className="w-5 h-5" />
          )}
        </button>

        {handsFree && (
          <div
            title="Jarvis modu açık"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-[var(--edith-primary)]/30 bg-[var(--edith-primary)]/10 text-[var(--edith-text)] text-[11px] font-mono"
          >
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            Auto Listen
          </div>
        )}

        {/* Metin girişi */}
        <div className="flex-1 relative bg-slate-900/90 rounded-2xl border border-slate-800 focus-within:border-[var(--edith-primary)]/60 focus-within:ring-1 focus-within:ring-[var(--edith-primary)]/30 transition-all">
          <textarea
            id="aura-text-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              sttSupported
                ? 'AURA\'ya yazın veya mikrofona basın...'
                : 'AURA\'ya bir şeyler sorun veya emredin...'
            }
            rows={1}
            disabled={isStreaming && aiState !== 'speaking'}
            className="w-full bg-transparent px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none resize-none max-h-32 font-sans disabled:opacity-50"
          />
        </div>

        {/* Durdur / Gönder butonu */}
        {(aiState === 'speaking' || isStreaming) ? (
          <button
            onClick={onStopSpeech}
            className="p-3 rounded-2xl bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/50 text-amber-300 transition-all shrink-0"
            title="Yanıtı Durdur"
          >
            <Square className="w-5 h-5 fill-current" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="p-3 rounded-2xl hover:opacity-90 disabled:opacity-40 text-slate-950 shadow-lg transition-all shrink-0"
            style={{
              background: 'linear-gradient(135deg, var(--edith-primary), var(--edith-accent), var(--edith-secondary))',
              boxShadow: '0 16px 32px color-mix(in srgb, var(--edith-primary) 18%, transparent)',
            }}
            title="Gönder (Enter)"
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* ── STT desteklenmiyor uyarısı — küçük, alt köşede ────────────── */}
      {!sttSupported && (
        <p className="mt-2 text-[10px] text-slate-600 text-center font-mono">
          Sesli giriş yalnızca Chrome / Edge tarayıcısında ve HTTPS ortamında çalışır.
        </p>
      )}
    </div>
  );
};
