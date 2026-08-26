import React from 'react';
import { VoiceBar } from '../chat/VoiceBar';
import { AiState, AssistantProfile, AutomationTool, ChatMessage, MemoryItem, ToolExecutionLog, UserSettings } from '../../types';
import { CommandCenter, StatusPill } from '../ui/edithOS';

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
  memories?: MemoryItem[];
  tools?: AutomationTool[];
  logs?: ToolExecutionLog[];
  assistantProfile?: AssistantProfile;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  aiState,
  messages,
  settings,
  ollamaConnected,
  onSendMessage,
  onStopSpeech,
  onVoiceTranscript,
  isStreaming,
  memories = [],
  tools = [],
  logs = [],
  assistantProfile,
}) => {
  const profile = assistantProfile ?? {
    name: 'JARVIS',
    primary: '#38bdf8',
    secondary: '#2563eb',
    accent: '#67e8f9',
  };

  return (
    <div className="flex-1 flex flex-col xl:flex-row h-full min-h-0 overflow-hidden relative">
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <CommandCenter
          aiState={aiState}
          messages={messages}
          memories={memories}
          tools={tools}
          logs={logs}
          assistant={profile}
          ollamaConnected={ollamaConnected}
        >
          <CommandSurface
            assistantName={profile.name}
            aiState={aiState}
            provider={settings.aiProvider}
            model={settings.selectedModel}
            messageCount={messages.length}
            toolCount={tools.length}
            pendingApprovals={tools.filter((tool) => tool.requiresConfirmation).length}
          />
        </CommandCenter>
        <VoiceBar
          aiState={aiState}
          onSendMessage={onSendMessage}
          onStopSpeech={onStopSpeech}
          onVoiceTranscript={onVoiceTranscript}
          isStreaming={isStreaming}
          handsFree={settings.voiceHandsFree}
          assistantName={profile.name}
        />
      </div>

    </div>
  );
};

function CommandSurface({
  assistantName,
  aiState,
  provider,
  model,
  messageCount,
  toolCount,
  pendingApprovals,
}: {
  assistantName: string;
  aiState: AiState;
  provider: string;
  model: string;
  messageCount: number;
  toolCount: number;
  pendingApprovals: number;
}) {
  const tracks = [
    ['Intent', messageCount > 1 ? 'Chat state active' : 'Awaiting command'],
    ['Plan', aiState === 'thinking' ? 'Model response running' : 'No active plan'],
    ['Agents', aiState === 'browser_use' || aiState === 'computer_use' ? aiState.replace('_', ' ') : 'Standby'],
    ['Tools', `${toolCount} registered`],
    ['Approvals', `${pendingApprovals} gated tools`],
  ];

  return (
    <div className="relative min-h-[25rem] overflow-hidden rounded-lg border border-white/10 bg-slate-950/45 p-4">
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px]" />
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_78%_24%,var(--assistant-glow),transparent_19rem)]" />

      <div className="relative z-10 grid min-h-[23rem] grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col justify-between rounded-lg border border-white/10 bg-black/24 p-4">
          <div>
            <div className="edith-eyebrow">OBJECTIVE OPERATING SURFACE</div>
            <h2 className="mt-2 max-w-2xl text-lg font-semibold text-slate-100 sm:text-2xl">
              Hedef verildiğinde E.D.I.T.H. planı, agent atamasını ve onay kapılarını burada açar.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-500">
              Burası konuşma kartı değil; canlı görev kontrol yüzeyi. Chat ayrı ekranda, görev yürütme ise burada takip edilir.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-5">
            {tracks.map(([label, value], index) => (
              <div key={label} className="relative rounded-lg border border-white/10 bg-white/[0.035] p-3">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-slate-500">0{index + 1}</span>
                  <span className="h-2 w-2 rounded-full bg-[var(--assistant-primary)] shadow-[0_0_12px_var(--assistant-glow)]" />
                </div>
                <div className="text-sm font-semibold text-slate-100">{label}</div>
                <div className="mt-1 text-[11px] text-slate-500">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/30 p-4">
          <div className="edith-eyebrow">ACTIVE STACK</div>
          <div className="mt-4 space-y-3">
            <StatusPill label="Assistant" value={assistantName} tone="info" />
            <StatusPill label="State" value={aiState.toUpperCase()} tone={aiState === 'error' ? 'danger' : 'muted'} />
            <StatusPill label="Model" value={model || 'AUTO'} tone="muted" />
            <StatusPill label="Provider" value={provider.toUpperCase()} tone="warning" />
          </div>
          <div className="mt-6 rounded-lg border border-[var(--assistant-primary)]/20 bg-[var(--assistant-primary)]/8 p-3">
            <div className="text-xs font-semibold text-slate-200">Quick Command</div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Alt komut çubuğundan hedef yaz; sistem intent, task, agent ve approval akışını bu yüzeye taşır.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
