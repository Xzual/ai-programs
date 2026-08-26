import React from 'react';
import { MessageSquare, RadioTower, ShieldCheck } from 'lucide-react';
import { ChatPanel } from '../chat/ChatPanel';
import { VoiceBar } from '../chat/VoiceBar';
import { AiState, ChatMessage, UserSettings } from '../../types';
import { OSPanel, StatusPill } from '../ui/edithOS';

interface ChatConsoleViewProps {
  aiState: AiState;
  messages: ChatMessage[];
  settings: UserSettings;
  ollamaConnected: boolean;
  onSendMessage: (text: string) => void;
  onStopSpeech: () => void;
  onVoiceTranscript: (text: string) => void;
  onSpeakMessage: (text: string) => void;
  onOpenOllamaModal: () => void;
  isStreaming: boolean;
  activeSpeakingId?: string | null;
  assistantProfile: {
    name: string;
    primary: string;
    secondary: string;
    accent: string;
  };
}

export const ChatConsoleView: React.FC<ChatConsoleViewProps> = ({
  aiState,
  messages,
  settings,
  ollamaConnected,
  onSendMessage,
  onStopSpeech,
  onVoiceTranscript,
  onSpeakMessage,
  onOpenOllamaModal,
  isStreaming,
  activeSpeakingId,
  assistantProfile,
}) => {
  return (
    <div className="edith-workspace flex min-h-0 flex-col custom-scrollbar">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[18rem_1fr]">
        <div className="hidden min-h-0 flex-col gap-4 xl:flex">
          <OSPanel title="Chat Console" eyebrow="TRANSMISSION" icon={<MessageSquare className="h-4 w-4" />}>
            <div className="space-y-2">
              <StatusPill label="Assistant" value={assistantProfile.name} tone="info" />
              <StatusPill label="Model" value={settings.selectedModel || 'AUTO'} tone="muted" />
              <StatusPill label="Provider" value={settings.aiProvider.toUpperCase()} tone={ollamaConnected ? 'success' : 'warning'} />
              <StatusPill label="State" value={aiState.toUpperCase()} tone={aiState === 'error' ? 'danger' : 'muted'} />
            </div>
          </OSPanel>
          <OSPanel title="Guardrails" eyebrow="VISIBLE OPS" icon={<ShieldCheck className="h-4 w-4" />}>
            <p className="text-xs leading-relaxed text-slate-500">
              Bu ekran sadece konuşma için. Task, tool, Computer Use ve Browser akışları Command Center ve ilgili modüllerde izlenir.
            </p>
          </OSPanel>
          <OSPanel title="Voice" eyebrow="INPUT" icon={<RadioTower className="h-4 w-4" />}>
            <p className="text-xs leading-relaxed text-slate-500">
              Ses açık olduğunda yanıtlar okunabilir; mikrofon komutları alttaki input üzerinden yürür.
            </p>
          </OSPanel>
        </div>

        <ChatPanel
          messages={messages}
          settings={settings}
          ollamaConnected={ollamaConnected}
          onSpeakMessage={onSpeakMessage}
          onOpenOllamaModal={onOpenOllamaModal}
          activeSpeakingId={activeSpeakingId}
          className="min-h-0 h-full rounded-lg"
        />
      </div>
      <VoiceBar
        aiState={aiState}
        onSendMessage={onSendMessage}
        onStopSpeech={onStopSpeech}
        onVoiceTranscript={onVoiceTranscript}
        isStreaming={isStreaming}
        handsFree={settings.voiceHandsFree}
      />
    </div>
  );
};
