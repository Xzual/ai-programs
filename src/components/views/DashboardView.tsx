import React from 'react';
import { ParticleCore } from '../3d/ParticleCore';
import { VoiceBar } from '../chat/VoiceBar';
import { ChatPanel } from '../chat/ChatPanel';
import { AiState, ChatMessage, UserSettings } from '../../types';

interface DashboardViewProps {
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
  audioAnalyser?: AnalyserNode | null;
  assistantProfile?: {
    primary: string;
    secondary: string;
    accent: string;
    name: string;
  };
}

export const DashboardView: React.FC<DashboardViewProps> = ({
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
  audioAnalyser,
  assistantProfile,
}) => {
  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden relative">
      {/* Left / Central Orb Area */}
      <div className="flex-1 flex flex-col justify-between h-full bg-slate-950/40 relative overflow-y-auto">
        {/* Central Core Sphere Container */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 relative min-h-[350px]">
          <ParticleCore
            aiState={aiState}
            quality={settings.animationQuality}
            audioAnalyser={audioAnalyser}
            theme={assistantProfile}
            className="w-full max-w-2xl h-[390px] sm:h-[560px]"
          />
        </div>

        {/* Bottom Voice Input Bar */}
        <VoiceBar
          aiState={aiState}
          onSendMessage={onSendMessage}
          onStopSpeech={onStopSpeech}
          onVoiceTranscript={onVoiceTranscript}
          isStreaming={isStreaming}
          handsFree={settings.voiceHandsFree}
        />
      </div>

      {/* Right Chat Panel Sidebar */}
      <ChatPanel
        messages={messages}
        settings={settings}
        ollamaConnected={ollamaConnected}
        onSpeakMessage={onSpeakMessage}
        onOpenOllamaModal={onOpenOllamaModal}
        className="w-full lg:w-96 h-64 lg:h-full shrink-0 border-t lg:border-t-0"
      />
    </div>
  );
};
