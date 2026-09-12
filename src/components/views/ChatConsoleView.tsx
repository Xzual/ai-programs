import React from 'react';
import { MessageSquare, RadioTower, ShieldCheck } from 'lucide-react';
import { ChatPanel } from '../chat/ChatPanel';
import { VoiceBar } from '../chat/VoiceBar';
import { AiState, AssistantProfile, ChatMessage, ProviderProfile, UserSettings } from '../../types';
import { OSPanel, ResponsiveWorkspace, StatusPill } from '../ui/edithOS';
import { providerDisplayName, providerStatusLabel, providerTone } from '../../edith/providerService';

interface ChatConsoleViewProps {
  aiState: AiState;
  messages: ChatMessage[];
  settings: UserSettings;
  ollamaConnected: boolean;
  providerProfiles?: ProviderProfile[];
  onSendMessage: (text: string) => void;
  onStopSpeech: () => void;
  onVoiceTranscript: (text: string) => void;
  onSpeakMessage: (text: string) => void;
  onOpenOllamaModal: () => void;
  isStreaming: boolean;
  activeSpeakingId?: string | null;
  assistantProfile: AssistantProfile;
}

export const ChatConsoleView: React.FC<ChatConsoleViewProps> = ({
  aiState,
  messages,
  settings,
  ollamaConnected,
  providerProfiles = [],
  onSendMessage,
  onStopSpeech,
  onVoiceTranscript,
  onSpeakMessage,
  onOpenOllamaModal,
  isStreaming,
  activeSpeakingId,
  assistantProfile,
}) => {
  const activeProvider = providerProfiles.find((profile) => profile.provider === settings.aiProvider);
  const providerStatus = activeProvider?.status ?? (ollamaConnected && settings.aiProvider === 'ollama' ? 'available' : 'unknown');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ResponsiveWorkspace variant="wide" className="flex min-h-0 flex-col overflow-hidden">
      <div className="grid h-full min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[clamp(17rem,18vw,22rem)_minmax(0,1fr)] 2xl:grid-cols-[clamp(18rem,16vw,24rem)_minmax(42rem,1fr)_clamp(18rem,16vw,24rem)]">
        <div className="hidden min-h-0 flex-col gap-4 xl:flex">
          <OSPanel title="Sohbet Konsolu" eyebrow="İLETİM" icon={<MessageSquare className="h-4 w-4" />}>
            <div className="space-y-2">
              <StatusPill label="Asistan" value={assistantProfile.name} tone="info" />
              <StatusPill label="Model" value={settings.selectedModel || 'OTOMATİK'} tone="muted" />
              <StatusPill label="Sağlayıcı" value={providerDisplayName(settings.aiProvider)} tone={providerTone(providerStatus)} />
              <StatusPill label="Durum" value={providerStatusLabel(providerStatus)} tone={providerTone(providerStatus)} />
              <StatusPill label="Aşama" value={aiState.toUpperCase()} tone={aiState === 'error' ? 'danger' : 'muted'} />
            </div>
          </OSPanel>
          <OSPanel title="Güvenlik Sınırları" eyebrow="GÖRÜNÜR İŞLEMLER" icon={<ShieldCheck className="h-4 w-4" />}>
            <p className="text-xs leading-relaxed text-slate-500">
              Bu ekran sadece konuşma için. Task, tool, Computer Use ve Browser akışları Command Center ve ilgili modüllerde izlenir.
            </p>
          </OSPanel>
          <OSPanel title="Ses" eyebrow="GİRDİ" icon={<RadioTower className="h-4 w-4" />}>
            <p className="text-xs leading-relaxed text-slate-500">
              Ses açık olduğunda yanıtlar okunabilir; mikrofon komutları alttaki input üzerinden yürür.
            </p>
          </OSPanel>
        </div>

        <ChatPanel
          messages={messages}
          settings={settings}
          ollamaConnected={ollamaConnected}
          providerProfiles={providerProfiles}
          onSpeakMessage={onSpeakMessage}
          onOpenOllamaModal={onOpenOllamaModal}
          activeSpeakingId={activeSpeakingId}
          assistantProfile={assistantProfile}
          className="min-h-0 h-full rounded-lg"
        />
        <div className="hidden min-h-0 flex-col gap-4 2xl:flex">
          <OSPanel title="Bağlam" eyebrow="GENİŞ EKRAN" icon={<RadioTower className="h-4 w-4" />}>
            <div className="space-y-2">
              <StatusPill label="Mesaj" value={String(messages.length)} tone="muted" />
              <StatusPill label="Akış" value={isStreaming ? 'STREAMING' : 'IDLE'} tone={isStreaming ? 'warning' : 'muted'} />
              <StatusPill label="Persona" value={assistantProfile.name} tone="info" />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Metin kolonu okunur genişlikte tutulur; geniş ekranda bağlam ve durum panelleri boş alanı kullanır.
            </p>
          </OSPanel>
        </div>
      </div>
      </ResponsiveWorkspace>
      <VoiceBar
        aiState={aiState}
        onSendMessage={onSendMessage}
        onStopSpeech={onStopSpeech}
        onVoiceTranscript={onVoiceTranscript}
        isStreaming={isStreaming}
        handsFree={settings.voiceHandsFree}
        assistantName={assistantProfile.name}
      />
    </div>
  );
};
