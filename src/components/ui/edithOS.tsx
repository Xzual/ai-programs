import React from 'react';
import { fetchExplorerDirectories, fetchExplorerStatus, type ExplorerDirectory, type ExplorerStatus, type ExplorerUndoReceipt, fetchFilesStatus, searchFiles, readFileContent, actOnFile, sendFile, filesErrorState, FilesClientError, type FileSendResult, type FilesStatus, type FileEntry, type FileContent, type FilesSurfaceState } from '../../edith/filesClient';
import { CrossDeviceDesktopBridge, CrossDeviceBridgeError, type CrossDeviceBridgeSnapshot, type FileSendTarget, type FileSendCheckpoint } from '../../edith/crossDeviceDesktopBridge';
import { listResearch, getResearch, executeResearch, exportResearch, ResearchClientError } from '../../edith/researchClient';
import type { ResearchRunV2 } from '../../edith/contracts';
import { isVerifiedTaskSuccess } from '../../edith/taskActivityClient';
import { useSharedTaskActivity, useTaskActivitySurface } from '../tasks/TaskActivityProvider';
import { createVoiceTaskHudBridge } from '../tasks/voiceTaskHudBridge';
import { createReaSelectionController, REA_LOCAL_PROFILES, type ReaLocalProfile } from '../../edith/reaSelectionClient';
import {
  Activity,
  AlertTriangle,
  Archive,
  Bot,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Cpu,
  Database,
  Eye,
  FileText,
  Globe2,
  KeyRound,
  LockKeyhole,
  Mic2,
  MicOff,
  MessageSquareText,
  Network,
  Pause,
  Play,
  Radar,
  RadioTower,
  RotateCcw,
  Route,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  TrendingUp,
  Volume2,
  WifiOff,
  Wrench,
  Zap,
} from 'lucide-react';
import { AiProvider, AiState, AssistantProfile, AutomationTool, ChatMessage, IntegrationConfig, MemoryItem, ProviderHealthSnapshot, ProviderProfile, ToolExecutionLog, UserSettings } from '../../types';
import { modelDisabledReason, modelsForProvider, providerDisplayName, providerStatusLabel, providerTone, selectValidModelForProvider } from '../../edith/providerService';
import { getDesktopShellStatus, isTauriShell, type DesktopShellStatus } from '../../edith/desktopShell';
import { nativeMobileConsumerClient, currentNativeStopState, type FilteredFrameDisplay } from '../../edith/nativeMobileConsumerClient';
import { runNativeBrowserRequest, type OriginalBrowserRequest, type NativeBrowserPending, type NativeBrowserStatus, type NativeBrowserConsumerResult } from '../../edith/nativeBrowserConsumerClient';
import type { BrowserWorkflowRequest } from '../../edith/core';
import {
  actOnComputer, beginComputerSession, getComputerDesktopStatus, getComputerScreenshot, observeComputer,
  reportComputerOperatorEvent, reportComputerRuntimeStatus, stopComputer,
  STEAM_READ_STATES, STEAM_READ_POLICY_ID, assertComputerSessionActive, createSteamEvidenceTask, createOwnedComputerSession,
  beginSteamEvidenceRead, sampleSteamEvidenceRead,
  type SteamReadCandidate, type SteamReadState, type SteamReadRef, type SteamReadError, type OwnedComputerSession, type OwnedComputerSessionOutcome,
  runComputerAppWorkflow, locateComputerTarget, readComputerText, readComputerOcr, getComputerMonitors, inspectComputerApp,
  type ComputerDesktopStatus, type ComputerObservation, type ComputerDesktopAction,
} from '../../edith/computerDesktopClient';
import { createComputerOperatorEvent, operatorStateForAction, type ComputerOperatorState } from '../../edith/computerOperatorEvents';
import { isValidatedComputerOcrReadback } from '../../edith/computerContractAdapter';
import type { ComputerAppWorkflowRequest, ComputerAppWorkflowResult } from '../../edith/computerAppWorkflows';
import type { ComputerCommandTask } from '../../edith/computerCommandService';
import {
  EDITH_VOICE_ROOM_ASSISTANT,
  EDITH_VOICE_ROOM_MODEL,
  getVoiceRoomCapabilitySnapshot,
  normalizeVoiceRoomStatusPayload,
  type VoiceRoomState,
  voiceRoomStateLabel,
} from '../../edith/voiceRoomService';
import {
  base64ToInt16Pcm,
  classifyVoiceSocketFailure,
  downsampleFloat32ToInt16Pcm,
  int16PcmToBase64,
  parseVoiceLiveServerEvent,
  VOICE_LIVE_INPUT_MIME,
  VOICE_LIVE_OUTPUT_RATE,
  voiceRoomRuntimeStatusAfterServerState,
  voiceRoomStateAfterServerStatus,
  voiceLiveSocketUrl,
  LocalVoiceSessionGate,
  voiceSocketProtocols,
} from '../../edith/voiceLiveClient';
import { CryptoExchangeTerminal } from '../crypto/CryptoExchangeTerminal';
import { TaskMissionWorkspace } from '../tasks/DynamicTaskCapsule';
import { ownerMutationFetch, primeOwnerSession, clearOwnerSessionMemory } from '../../edith/ownerMutationClient';
import { fetchLocalSearch, LocalSearchClientError, LOCAL_SEARCH_SCOPES, type LocalSearchResult, type LocalSearchScope } from '../../edith/localSearchClient';
import { CrossDeviceBridgePanel, ResearchSharedResultPanel } from '../cross-device/CrossDeviceBridgePanel';
import { AdvancedExperienceWorkspace, AdvancedStatusSummary } from '../advanced/AdvancedExperiencePanels';

export interface AssistantTheme {
  primary: string;
  secondary: string;
  accent: string;
  background?: string;
  surface?: string;
  text?: string;
  name: string;
  id?: string;
  taskReportSignature?: string;
  notificationIdentity?: string;
  memoryNamespace?: string;
}

export const statusCopy: Record<AiState, string> = {
  idle: 'IDLE',
  listening: 'LISTENING',
  thinking: 'THINKING',
  speaking: 'SPEAKING',
  searching: 'SEARCHING',
  tool_execution: 'TOOL EXECUTION',
  computer_use: 'COMPUTER USE',
  browser_use: 'BROWSER USE',
  coding: 'CODING',
  trading_analysis: 'TRADING ANALYSIS',
  warning: 'WARNING',
  error: 'ERROR',
  success: 'SUCCESS',
};

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

type ScreenFrameVariant = 'readable' | 'wide' | 'cockpit' | 'canvas';

const screenContainerClass: Record<ScreenFrameVariant, string> = {
  readable: 'edith-responsive-container',
  wide: 'edith-responsive-container-wide',
  cockpit: 'edith-responsive-container-cockpit',
  canvas: 'edith-responsive-container-canvas',
};

export function ResponsiveWorkspace({
  children,
  variant = 'wide',
  className = '',
}: {
  children: React.ReactNode;
  variant?: ScreenFrameVariant;
  className?: string;
}) {
  return (
    <div className={cx('edith-workspace edith-responsive-pad custom-scrollbar', className)}>
      <div className={cx(screenContainerClass[variant], 'min-w-0')}>{children}</div>
    </div>
  );
}

export function WorkspaceGrid({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cx('edith-responsive-grid', className)}>{children}</div>;
}

export function CockpitGrid({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cx('edith-cockpit-grid', className)}>{children}</div>;
}

export function AdaptiveInspector({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <aside className={cx('edith-adaptive-inspector', className)}>{children}</aside>;
}

type InteractionSafetySnapshot = {
  computer?: {
    mode: string;
    runtimeBound: boolean;
    approvalRequired: boolean;
    permissionPolicyMode?: string;
    policyWarning?: string;
    phases?: Array<{ name: string; status: string; notes: string }>;
  };
  browser?: {
    mode: string;
    permissionPolicyMode?: string;
    policyWarning?: string;
    capabilities?: Array<{
      action: string;
      runtimeStatus: string;
      requiresApproval: boolean;
      sideEffects: string;
    }>;
  };
  voice?: {
    mode: string;
    wakeWord: string;
    stt: string;
    tts: string;
    handsFreeRequiresUserSetting: boolean;
  };
  desktopPackaging?: {
    tauriPackageBuildAvailable: boolean;
    cargoFoundInPath: boolean;
    warning?: string;
    commandsAfterCargoAvailable: string[];
  };
  classifications?: Array<{
    id: string;
    area: string;
    status: string;
    mode: string;
    riskLevel: number;
    requiredPermissions: string[];
    verification: string;
    notes: string;
  }>;
  requiredApprovals?: Array<{ action: string; permissions: string[]; reason: string }>;
};

function useInteractionSafetySnapshot(): InteractionSafetySnapshot | null {
  const [snapshot, setSnapshot] = React.useState<InteractionSafetySnapshot | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/edith/interaction-safety')
        .then((response) => response.ok ? readJsonResponse(response) : undefined)
        .then((payload) => {
          if (!cancelled && payload?.success) setSnapshot(payload.snapshot);
        })
        .catch(() => {
          if (!cancelled) setSnapshot(null);
        });
    };
    load();
    const timer = window.setInterval(load, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return snapshot;
}

async function readJsonResponse(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error(`JSON bekleniyordu ama endpoint farklı/boş cevap döndürdü: ${response.status}`);
  }
}

export function OSPanel({
  title,
  eyebrow,
  icon,
  children,
  action,
  className = '',
}: {
  key?: React.Key;
  title: string;
  eyebrow?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`edith-os-panel ${className}`}>
      <div className="relative z-10 flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {icon && <div className="edith-icon-cell">{icon}</div>}
          <div className="min-w-0">
            {eyebrow && <div className="edith-eyebrow">{eyebrow}</div>}
            <h3 className="truncate text-sm font-semibold text-slate-100">{title}</h3>
          </div>
        </div>
        {action}
      </div>
      <div className="relative z-10 p-4">{children}</div>
    </section>
  );
}

export function StatusPill({
  label,
  tone = 'info',
  value,
}: {
  key?: React.Key;
  label: string;
  value?: string;
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'muted';
}) {
  const toneClass = {
    info: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
    success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    warning: 'border-amber-400/35 bg-amber-400/10 text-amber-200',
    danger: 'border-red-400/35 bg-red-400/10 text-red-200',
    muted: 'border-slate-500/25 bg-slate-500/10 text-slate-300',
  }[tone];
  return (
    <span className={`inline-flex min-h-7 items-center gap-2 rounded-md border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide ${toneClass}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_10px_currentColor]" />
      <span>{label}</span>
      {value && <span className="font-mono text-current/70">{value}</span>}
    </span>
  );
}

export function RiskBadge({ level, label }: { level: 'READ' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; label?: string }) {
  const tone = level === 'CRITICAL' || level === 'HIGH' ? 'danger' : level === 'MEDIUM' ? 'warning' : 'success';
  return <StatusPill tone={tone} label={label ?? level} />;
}

export function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/12 bg-white/[0.025] p-6 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[var(--assistant-primary)]">
        {icon}
      </div>
      <div className="text-sm font-semibold text-slate-200">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-500">{text}</p>
    </div>
  );
}

export function TaskTimeline(_props: { aiState?: AiState; hasObjective?: boolean; logs?: ToolExecutionLog[] }) {
  const {activity, error, state} = useTaskActivitySurface();
  if (error) return <p role="status" className="text-xs text-amber-200">{error}</p>;
  if (state === 'loading' || state === 'reconnecting') return <p role="status" className="text-xs text-slate-500">Görev durumu yenileniyor; önceki kontrol canlı kabul edilmez.</p>;
  if (!activity) return <p className="text-xs text-slate-500">Canonical görev olayı henüz yok.</p>;
  return <div className="space-y-3"><p className="text-xs text-slate-300">{activity.task.title} · {activity.task.status} · {isVerifiedTaskSuccess(activity.task) ? 'Doğrulama PASS' : 'Doğrulanmış başarı yok'} · Olay geçmişi: {activity.history.state}</p>
    {activity.events.slice(-5).map(event => <div key={event.eventId} className="text-xs"><span>{event.type} · seq {event.sequence}</span><time dateTime={event.occurredAt} className="ml-2 text-slate-500">{new Date(event.occurredAt).toLocaleString('tr-TR')}</time></div>)}
  </div>;
}

export function AgentCard({ name, role, status, tools }: { key?: React.Key; name: string; role: string; status: string; tools: string[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3 transition hover:border-[var(--assistant-primary)]/35">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">{name}</div>
          <div className="mt-1 text-[11px] text-slate-500">{role}</div>
        </div>
        <StatusPill label={status} tone={status === 'ACTIVE' ? 'success' : status === 'WAITING' ? 'warning' : 'muted'} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {tools.map((tool) => (
          <span key={tool} className="rounded border border-white/10 bg-slate-950/50 px-2 py-0.5 font-mono text-[10px] text-slate-400">
            {tool}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TransmissionCard({
  message,
  onSpeak,
}: {
  key?: React.Key;
  message: ChatMessage;
  settings: UserSettings;
  providerProfiles?: ProviderProfile[];
  onSpeak?: (text: string) => void;
}) {
  const user = message.sender === 'user';
  const providerUsed = message.providerUsed ?? message.requestedProvider;
  const modelUsed = message.modelUsed ?? message.requestedModel;
  const providerStatus = message.providerStatus ?? 'unknown';
  const historicalAssistantName = message.assistantName ?? message.assistantProfileId?.toUpperCase() ?? 'LEGACY ASSISTANT';
  const fallbackLabel = message.fallbackUsed
    ? `${message.fallbackProvider ? providerDisplayName(message.fallbackProvider) : 'UNKNOWN'}${message.fallbackModel ? ` / ${message.fallbackModel}` : ''}`
    : undefined;
  const degradedRuntime = message.fallbackUsed || providerUsed === 'mock' || providerStatus === 'degraded';
  const responseStatusLabel = message.error
    ? 'FAILED'
    : message.isStreaming
    ? 'STREAMING'
    : degradedRuntime
    ? message.fallbackUsed
      ? 'FALLBACK USED'
      : providerUsed === 'mock'
      ? 'MOCK RESPONSE'
      : 'DEGRADED'
    : providerStatus === 'available'
    ? 'PROVIDER OK'
    : providerStatusLabel(providerStatus);
  return (
    <article className={`edith-transmission ${user ? 'edith-transmission-user' : ''}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="edith-transmission-glyph">{user ? <Terminal className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}</span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
            {user ? 'YOU // COMMAND' : `${historicalAssistantName} // RESPONSE`}
          </span>
        </div>
        <span className="font-mono text-[10px] text-slate-600">
          {new Date(message.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {!user && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <StatusPill label="Model" value={modelUsed ? (modelUsed === 'auto' ? 'AUTO' : modelUsed) : 'NOT RECORDED'} tone={modelUsed === 'auto' ? 'info' : 'muted'} />
          <StatusPill label="Provider" value={providerUsed ? providerDisplayName(providerUsed) : 'NOT RECORDED'} tone={providerTone(providerStatus)} />
          {fallbackLabel && <StatusPill label="Fallback" value={fallbackLabel} tone="warning" />}
          <StatusPill label={responseStatusLabel} tone={message.error ? 'danger' : message.isStreaming ? 'warning' : degradedRuntime ? 'warning' : providerStatus === 'available' ? 'success' : providerTone(providerStatus)} />
          {message.errorCode && <StatusPill label="Error" value={message.errorCode} tone="danger" />}
        </div>
      )}
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200">
        {message.text}
        {message.isStreaming && <span className="ml-1 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-[var(--assistant-accent)]" />}
      </div>
      {!user && !message.isStreaming && (
        <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2">
          <span className="text-[10px] text-slate-600">Action summary only. Hidden reasoning is not exposed.</span>
          {onSpeak && (
            <button onClick={() => onSpeak(message.text)} className="rounded-md border border-white/10 p-1.5 text-slate-400 hover:text-[var(--assistant-primary)]" title="Sesli okut">
              <RadioTower className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function CommandCenter({
  aiState,
  messages,
  memories,
  tools,
  logs,
  children,
  assistant,
  ollamaConnected,
}: {
  aiState: AiState;
  messages: ChatMessage[];
  memories: MemoryItem[];
  tools: AutomationTool[];
  logs: ToolExecutionLog[];
  children: React.ReactNode;
  assistant: AssistantTheme;
  ollamaConnected: boolean;
}) {
  const activeTools = tools.filter((tool) => tool.status === 'running').length;
  const pendingApproval = tools.filter((tool) => tool.requiresConfirmation).slice(0, 3);
  return (
    <ResponsiveWorkspace variant="cockpit">
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_clamp(22rem,22vw,30rem)]">
        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_clamp(17rem,16vw,22rem)]">
            <OSPanel title="Mission Control Surface" eyebrow="COMMAND CENTER" icon={<Cpu className="h-4 w-4" />}>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <StatusPill label={assistant.name} tone="info" />
                <StatusPill label={statusCopy[aiState]} tone={aiState === 'error' ? 'danger' : aiState === 'warning' ? 'warning' : aiState === 'success' ? 'success' : 'info'} />
                <StatusPill label={ollamaConnected ? 'SYSTEM ONLINE' : 'DEGRADED'} tone={ollamaConnected ? 'success' : 'warning'} />
              </div>
              {children}
            </OSPanel>

            <div className="grid gap-4">
              <OSPanel title="Current Task" eyebrow="MISSION" icon={<Route className="h-4 w-4" />}>
                <div className="text-sm font-semibold text-slate-100">Yeni hedef bekleniyor</div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">Bir komut verdiğinizde E.D.I.T.H. intent, plan, agent seçimi, tool kullanımı, onay ve doğrulamayı burada görünür hale getirir.</p>
                <div className="mt-4">
                  <TaskTimeline aiState={aiState} hasObjective={messages.length > 1} logs={logs} />
                </div>
              </OSPanel>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <OSPanel title="Agent Activity" eyebrow="ORCHESTRATION" icon={<Bot className="h-4 w-4" />}>
              <div className="space-y-2">
                <AgentCard name="Planning Agent" role="Plan üretimi ve checkpoint kontrolü" status={aiState === 'thinking' ? 'ACTIVE' : 'STANDBY'} tools={['planner', 'verifier']} />
                <AgentCard name="Browser Agent" role="Kaynak araştırma ve claim çıkarımı" status={aiState === 'browser_use' ? 'ACTIVE' : 'WAITING'} tools={['browser', 'sources']} />
              </div>
            </OSPanel>
            <OSPanel title="System Health" eyebrow="STATUS" icon={<Activity className="h-4 w-4" />}>
              <HealthRows rows={[
                ['Provider', ollamaConnected ? 'Connected' : 'Degraded', ollamaConnected],
                ['Tool Activity', `${activeTools} running`, activeTools === 0],
                ['Memory', `${memories.length} records`, true],
                ['Logs', `${logs.length} events`, true],
              ]} />
            </OSPanel>
            <OSPanel title="Pending Approvals" eyebrow="SECURITY" icon={<ShieldAlert className="h-4 w-4" />}>
              {pendingApproval.length > 0 ? (
                <div className="space-y-2">
                  {pendingApproval.map((tool) => (
                    <div key={tool.id} className="rounded-md border border-amber-400/20 bg-amber-400/10 p-2">
                      <div className="text-xs font-medium text-amber-100">{tool.name}</div>
                      <div className="mt-1 text-[10px] text-amber-200/70">{tool.permissions.join(', ')}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<ShieldCheck className="h-4 w-4" />} title="Onay bekleyen işlem yok" text="Yüksek riskli araçlar çalışmadan önce burada açıkça görünür." />
              )}
            </OSPanel>
          </div>
        </div>

        <OSPanel title="Live Context" eyebrow="INSPECTOR" icon={<Eye className="h-4 w-4" />} className="min-h-[28rem]">
          <div className="space-y-4">
            <div>
              <div className="edith-eyebrow">RECENT TRANSMISSION</div>
              <div className="mt-2 space-y-2">
                {messages.slice(-2).map((message) => (
                  <div key={message.id} className="rounded-md border border-white/10 bg-slate-950/50 p-2 text-xs text-slate-400 line-clamp-3">
                    {message.text || 'Streaming...'}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="edith-eyebrow">MEMORY HIGHLIGHTS</div>
              <div className="mt-2 space-y-2">
                {memories.slice(0, 3).map((memory) => (
                  <div key={memory.id} className="rounded-md border border-white/10 bg-white/[0.025] p-2">
                    <div className="text-xs font-medium text-slate-300">{memory.key}</div>
                    <div className="mt-1 text-[11px] text-slate-500 line-clamp-2">{memory.value}</div>
                  </div>
                ))}
                {memories.length === 0 && <EmptyState icon={<Brain className="h-4 w-4" />} title="Memory boş" text="Henüz kalıcı hafıza oluşturulmadı." />}
              </div>
            </div>
          </div>
        </OSPanel>
      </div>
    </ResponsiveWorkspace>
  );
}

function HealthRows({ rows }: { rows: Array<[string, string, boolean]> }) {
  return (
    <div className="space-y-2">
      {rows.map(([label, value, good]) => (
        <div key={label} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-slate-950/45 px-3 py-2">
          <span className="text-xs text-slate-500">{label}</span>
          <span className={`font-mono text-[11px] ${good ? 'text-emerald-300' : 'text-amber-300'}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

export function AgentsScreen({ aiState = 'idle', tools = [], logs = [] }: { aiState?: AiState; tools?: AutomationTool[]; logs?: ToolExecutionLog[] }) {
  const safety = useInteractionSafetySnapshot();
  const runningTools = tools.filter((tool) => tool.status === 'running').length;
  const agents = [
    ['Orchestrator', 'Görev ayrıştırma, handoff ve genel kontrol', aiState === 'thinking' ? 'ACTIVE' : 'STANDBY', ['planner', 'router']],
    ['Research Agent', 'Kaynak toplama, güvenilirlik ve çelişki kontrolü', aiState === 'browser_use' || aiState === 'searching' ? 'ACTIVE' : 'STANDBY', ['browser', 'sources']],
    ['Computer Agent', 'Observe -> Understand -> Plan -> Action -> Verify döngüsü', safety?.computer?.mode ?? 'READ ONLY', ['vision', 'screen']],
    ['Security Agent', 'Risk, approval ve prompt-injection kontrolü', tools.some((tool) => tool.requiresConfirmation) ? 'ACTIVE' : 'STANDBY', ['policy', 'audit']],
    ['Trading Agent', 'UI shell only; live execution locked', 'LOCKED', ['risk', 'market']],
    ['QA Agent', 'Sonuç doğrulama ve final rapor kalitesi', logs.length > 0 ? 'WAITING' : 'STANDBY', ['verifier']],
  ] as const;
  return (
    <ScreenFrame title="Ajan İşlemleri" icon={<Network className="h-5 w-5" />} subtitle="Çok ajanlı düzenleme grafiği ve işlem birimleri" variant="wide">
      <OSPanel title="Ajan Ağı" eyebrow="AKIŞ" icon={<Route className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          {['User Objective', 'Orchestrator', 'Planning Agent', 'Browser Agent', 'Research Agent', 'Verifier', 'Final Response'].map((node, index) => (
            <React.Fragment key={node}>
              <span className="rounded-md border border-[var(--assistant-primary)]/25 bg-[var(--assistant-primary)]/10 px-3 py-2">{node}</span>
              {index < 6 && <ChevronRight className="h-4 w-4 text-[var(--assistant-primary)]" />}
            </React.Fragment>
          ))}
        </div>
      </OSPanel>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <ActionRow label="Kayıtlı araçlar" value={String(tools.length)} />
        <ActionRow label="Çalışan araçlar" value={String(runningTools)} />
        <ActionRow label="Denetim olayları" value={String(logs.length)} />
      </div>
      <WorkspaceGrid className="mt-4">
        {agents.map(([name, role, status, tools]) => <AgentCard key={name} name={name} role={role} status={status} tools={[...tools]} />)}
      </WorkspaceGrid>
    </ScreenFrame>
  );
}

interface ComputerUseScreenProps {
  tools?: AutomationTool[];
  logs?: ToolExecutionLog[];
  task?: ComputerCommandTask | null;
  onTaskHandled?: (taskId: string) => void;
  onWorkflowResult?: (descriptorId: string, result: ComputerAppWorkflowResult) => void;
  browserRequest?: OriginalBrowserRequest;
  onBrowserRequestHandled?: (requestId:string)=>void;
}

type ActionVerification = () => Promise<{ ok: boolean; detail: string }>;

type SteamEvidenceUiError = SteamReadError | NonNullable<OwnedComputerSessionOutcome['error']>;
function steamEvidenceUiError(error: unknown): SteamEvidenceUiError {
  const codes: SteamEvidenceUiError[] = ['STEAM_READ_INVALID_REQUEST','STEAM_READ_POLICY_UNAVAILABLE','STEAM_READ_SCOPE_UNAVAILABLE','STEAM_READ_SCOPE_EXPIRED','STEAM_READ_SCOPE_CHANGED','STEAM_READ_BUSY','STEAM_READ_REPLAY','STEAM_READ_UNSUPPORTED','STEAM_READ_TIMEOUT','STEAM_READ_ENDED','STEAM_READ_CAPACITY','OWNED_SESSION_CANCELLED','OWNED_SESSION_ADMISSION_FAILED','OWNED_SESSION_CAPACITY','OWNED_SESSION_INVALID_REQUEST','NATIVE_STOP_INVALID_REQUEST','NATIVE_STOP_SCOPE_MISMATCH','NATIVE_STOP_SCOPE_UNAVAILABLE','NATIVE_STOP_UNRESOLVED'];
  return typeof error === 'string' && codes.includes(error as SteamEvidenceUiError) ? error as SteamEvidenceUiError : 'STEAM_READ_UNSUPPORTED';
}

function steamEvidenceUiIntent(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(value) && [...value].length <= 160 && new TextEncoder().encode(value).length <= 640;
}

function steamEvidenceUiProjection(value: SteamReadCandidate) {
  return {
    schema: value.schema, status: value.status, sampleGeneration: value.sampleGeneration, state: value.state,
    observedAt: value.observedAt, expiresAt: value.expiresAt, candidateOnly: true as const, profileApproved: false as const,
    sourcePolicySha256: value.sourcePolicySha256, sourceContractSha256: value.sourceContractSha256,
    nativeBuildId: value.nativeBuildId, policyId: value.policyId, policyVersion: value.policyVersion, producer: value.producer,
    coverage: {complete: value.coverage.complete, view: value.coverage.view, nodeCount: value.coverage.nodeCount},
    records: value.records.map(row => ({nodeId: row.nodeId, ancestorIds: [...row.ancestorIds], propertyId: row.propertyId, variant: row.variant, value: row.value})),
  };
}

type SteamEvidenceUiView = {
  phase: 'idle'|'approving'|'creating'|'ready'|'sampling'|'ending'|'worker_pending'|'session_pending'|'backend_pending'|'ended';
  samples: ReturnType<typeof steamEvidenceUiProjection>[]; usedStates: SteamReadState[]; expiresAt?: number;
  nativeState?: OwnedComputerSessionOutcome['state']; backendCleanup?: OwnedComputerSessionOutcome['backendCleanup'];
  error?: SteamEvidenceUiError; candidateOnly: true; profileApproved: false;
};
type SteamEvidenceUiOptions = {acquire(): boolean; release(): void; publish(view: SteamEvidenceUiView): void};

// Owns only this screen's read scope. Native authority stays in the frozen client.
function createSteamEvidenceUiLifecycle(options: SteamEvidenceUiOptions) {
  let mounted = true, locked = false, epoch = 0, session: string | undefined;
  let owned: OwnedComputerSession | undefined, cancellation: AbortController | undefined;
  let readRef: SteamReadRef | undefined, expiry = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined, samplingEpoch: number | undefined, revoked = true, closeRequested = false;
  let view: SteamEvidenceUiView = {phase: 'idle', samples: [], usedStates: [], candidateOnly: true, profileApproved: false};
  const publish = (changes: Partial<SteamEvidenceUiView>) => {
    view = {...view, ...changes};
    if (mounted) options.publish(view);
  };
  const revoke = (_reason: string) => {
    if (!locked) return;
    revoked = true; epoch++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    publish({phase: 'ending', samples: [], expiresAt: undefined});
  };
  const close = (deliberate: boolean): Promise<void> => {
    if (!locked) return Promise.resolve();
    if (closing) return closing;
    if (closeRequested && !deliberate) return Promise.resolve();
    closeRequested = true;
    revoke('end');
    const original = owned;
    cancellation?.abort();
    const work = async () => {
      try {
        if (!original) {publish({phase: 'session_pending', nativeState: 'terminal_unresolved', backendCleanup: 'not_requested'}); return;}
        const outcome = await original.cancel();
        if (owned !== original) return;
        publish({nativeState: outcome.state, backendCleanup: outcome.backendCleanup, ...(outcome.error ? {error: steamEvidenceUiError(outcome.error)} : {})});
        if (outcome.state !== 'native_quiescent') {
          publish({phase: outcome.state === 'pending_approval' ? 'session_pending' : 'worker_pending'}); return;
        }
        if (outcome.backendCleanup !== 'complete' && outcome.backendCleanup !== 'not_requested') {publish({phase: 'backend_pending'}); return;}
        owned = undefined; cancellation = undefined; session = undefined; readRef = undefined;
        locked = false; options.release(); publish({phase: 'ended'});
      } catch (error) {if (owned === original) publish({phase: 'worker_pending', error: steamEvidenceUiError(error)});}
    };
    const operation = work().finally(() => {if (closing === operation) closing = undefined;});
    closing = operation;
    return operation;
  };
  const end = () => close(true);
  const start = async (gameName: string, confirmed: boolean) => {
    if (!mounted || locked || !confirmed || !steamEvidenceUiIntent(gameName) || !options.acquire()) return;
    locked = true; revoked = false; closeRequested = false;
    cancellation = new AbortController();
    const signal = cancellation.signal;
    const token = ++epoch;
    const current = () => mounted && !revoked && !signal.aborted && token === epoch;
    publish({phase: 'approving', samples: [], usedStates: [], error: undefined, expiresAt: undefined, nativeState: undefined, backendCleanup: undefined});
    const work = async () => {
      try {
        const original = createOwnedComputerSession(signal); owned = original;
        const id = await original.ready;
        if (!current() || owned !== original) return;
        session = id;
        const sessionExpiry = assertComputerSessionActive(id);
        if (!current()) return;
        const workflow = `steam-ui-${crypto.randomUUID()}`;
        publish({phase: 'creating'});
        const task = await createSteamEvidenceTask({sessionId: session, workflowId: workflow, idempotencyKey: workflow,
          deadlineAt: new Date(Math.min(sessionExpiry, Date.now() + 30000)).toISOString(),
          intent: {app: 'steam', workflow: 'game_detail', gameName}});
        if (!current()) return;
        const result = await beginSteamEvidenceRead({version: 1, op: 'begin', sessionId: session, workflowId: workflow, bindingId: task.bindingId, policyId: STEAM_READ_POLICY_ID});
        if (!current() || owned !== original) return;
        readRef = result.readRef; expiry = result.expiresAt;
        if (Date.now() >= expiry) return;
        timer = setTimeout(() => {revoke('expiry'); void close(false);}, Math.max(0, expiry - Date.now()));
        publish({phase: 'ready', expiresAt: expiry});
      } catch (error) {if (current()) {publish({error: steamEvidenceUiError(error)}); revoked = true;}}
    };
    await work();
    if (token === epoch && (!current() || !readRef || Date.now() >= expiry)) await close(false);
  };
  const sample = async (state: SteamReadState) => {
    if (!mounted || !locked || revoked || samplingEpoch === epoch || !readRef || !STEAM_READ_STATES.includes(state) || view.usedStates.includes(state)) return;
    if (Date.now() >= expiry) {revoke('expiry'); await close(false); return;}
    const token = epoch, originalRef = readRef;
    samplingEpoch = token; publish({phase: 'sampling', usedStates: [...view.usedStates, state]});
    try {
      const value = await sampleSteamEvidenceRead({version: 1, op: 'sample', readRef: originalRef, state});
      if (!mounted || revoked || token !== epoch || readRef !== originalRef || Date.now() >= expiry) return;
      publish({phase: 'ready', samples: [...view.samples, steamEvidenceUiProjection(value)]});
    } catch (error) {
      if (mounted && !revoked && token === epoch) {publish({error: steamEvidenceUiError(error)}); revoke('sample-error'); void close(false);}
    } finally {if (samplingEpoch === token) samplingEpoch = undefined;}
  };
  return {start, sample, end, revoke,
    captureStatusScope: () => {
      const original = owned, token = epoch;
      return () => mounted && owned === original && epoch === token;
    },
    hasOwnedSession: () => owned !== undefined,
    hasAdmittedSession: () => session !== undefined && !revoked,
    isActive: () => locked,
    statusLost: () => {revoke('status-lost'); return close(false);},
    attach: () => {mounted = true;},
    dispose: () => {mounted = false; revoke('unmount'); return close(false);},
  };
}

export function ComputerUseScreen({ tools = [], logs = [], task = null, onTaskHandled, onWorkflowResult, browserRequest, onBrowserRequestHandled }: ComputerUseScreenProps) {
  const [status, setStatus] = React.useState<ComputerDesktopStatus | null>(null);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [observation, setObservation] = React.useState<ComputerObservation | null>(null);
  const [phase, setPhase] = React.useState<ComputerOperatorState | 'idle'>('idle');
  const [error, setError] = React.useState('');
  const [readback, setReadback] = React.useState('');
  const [nativeInfo, setNativeInfo] = React.useState('');
  const [nativeBusy, setNativeBusy] = React.useState(false);
  const [workflowResult, setWorkflowResult] = React.useState<ComputerAppWorkflowResult>();
  const [nativeStopState,setNativeStopState]=React.useState<'native_latched'|'native_quiescent'|'unknown'>('unknown');
  const [filteredFrame,setFilteredFrame]=React.useState<FilteredFrameDisplay>();
  const [framePending,setFramePending]=React.useState(false);
  const [frameError,setFrameError]=React.useState('');
  const [browserResult,setBrowserResult]=React.useState<NativeBrowserConsumerResult>();
  const [browserTicket,setBrowserTicket]=React.useState<NativeBrowserPending>();
  const [browserStatus,setBrowserStatus]=React.useState<NativeBrowserStatus>();
  const browserAbort=React.useRef<AbortController>();
  const browserClaims=React.useRef(new Set<string>());
  const browserRequestRef=React.useRef(browserRequest);browserRequestRef.current=browserRequest;
  const browserHandledRef=React.useRef(onBrowserRequestHandled);browserHandledRef.current=onBrowserRequestHandled;
  const [ocrQuery, setOcrQuery] = React.useState('');
  const [ocrBefore, setOcrBefore] = React.useState('');
  const [ocrAfter, setOcrAfter] = React.useState('');
  const [ocrOptIn, setOcrOptIn] = React.useState(false);
  const [ocrOutcome, setOcrOutcome] = React.useState('');
  const workflowIdentities = React.useRef(new Map<string, {workflowId:string;idempotencyKey:string}>());
  const executionIds = React.useRef(new Set<string>());
  const currentTaskId = React.useRef(task?.id);
  currentTaskId.current = task?.id;
  const approvalPending = React.useRef(false);
  const [approving, setApproving] = React.useState(false);
  const stoppingRef=React.useRef(false);
  const [stopping,setStopping]=React.useState(false);
  const nativeBusyRef = React.useRef(false);
  const steamReadLockedRef = React.useRef(false);
  const evidenceModeRef = React.useRef(false);
  const [steamReadLocked, setSteamReadLocked] = React.useState(false);
  const [steamGameIntent, setSteamGameIntent] = React.useState('');
  const [steamReadConfirmed, setSteamReadConfirmed] = React.useState(false);
  const [steamReadView, setSteamReadView] = React.useState<SteamEvidenceUiView>({phase: 'idle', samples: [], usedStates: [], candidateOnly: true, profileApproved: false});
  const screenMounted = React.useRef(true);
  const regularSessionRef = React.useRef(sessionId); regularSessionRef.current = sessionId;
  const statusRef = React.useRef(status); statusRef.current = status;
  const steamReadLifecycleRef = React.useRef<ReturnType<typeof createSteamEvidenceUiLifecycle>>();
  if (!steamReadLifecycleRef.current) steamReadLifecycleRef.current = createSteamEvidenceUiLifecycle({
    acquire: () => {
      if (steamReadLockedRef.current || regularSessionRef.current || nativeBusyRef.current || approvalPending.current || stoppingRef.current || !statusRef.current?.available || statusRef.current.ownerCommandMode) return false;
      evidenceModeRef.current = true; steamReadLockedRef.current = true; setSteamReadLocked(true); return true;
    },
    release: () => {steamReadLockedRef.current = false; if (screenMounted.current) setSteamReadLocked(false);},
    publish: value => {if (screenMounted.current) setSteamReadView(value);},
  });
  const steamReadLifecycle = steamReadLifecycleRef.current;
  const transientEpoch = React.useRef(0);
  const invalidateTransient = React.useCallback(() => { transientEpoch.current++; nativeMobileConsumerClient.clear();setFilteredFrame(undefined);setFramePending(false);setFrameError('');setNativeStopState('unknown'); browserAbort.current?.abort(); if(browserRequestRef.current)browserHandledRef.current?.(browserRequestRef.current.id); setBrowserTicket(undefined);setBrowserStatus(undefined);setBrowserResult(undefined); setReadback(''); setNativeInfo(''); setObservation(null); setWorkflowResult(undefined); setOcrOutcome(''); setOcrOptIn(false); setOcrQuery(''); setOcrBefore(''); setOcrAfter(''); }, []);
  const [timeline, setTimeline] = React.useState<ReturnType<typeof createComputerOperatorEvent>[]>([]);
  const [overlayEnabled, setOverlayEnabled] = React.useState(true);
  const [clickCount, setClickCount] = React.useState(0);
  const [killSwitchUnlockArmed, setKillSwitchUnlockArmed] = React.useState(false);
  const [overlayCursor, setOverlayCursor] = React.useState<{ x: number; y: number } | null>(null);
  const [clickPulse, setClickPulse] = React.useState<{ id: number; x: number; y: number } | null>(null);
  const clickCountRef = React.useRef(0);
  const clickTargetRef = React.useRef<HTMLButtonElement>(null);
  const typingTargetRef = React.useRef<HTMLInputElement>(null);
  const scrollTargetRef = React.useRef<HTMLDivElement>(null);
  const handledTaskIdsRef = React.useRef(new Set<string>());
  const revokedSessionIdsRef = React.useRef(new Set<string>());

  const claimTask = React.useCallback((currentTask: ComputerCommandTask) => {
    if (handledTaskIdsRef.current.has(currentTask.id)) return false;
    handledTaskIdsRef.current.add(currentTask.id);
    if (handledTaskIdsRef.current.size > 100) handledTaskIdsRef.current = new Set([currentTask.id]);
    return true;
  }, []);

  const record = React.useCallback((state: ComputerOperatorState, detail: string, details: { x?: number; y?: number; text?: string; sessionId?: string; planId?: string; stepId?: string; observationId?: string; actionId?: string; verificationStatus?: 'verified' | 'partial' | 'pending_post_observation' } = {}) => {
    const event = createComputerOperatorEvent(state, detail, details);
    setTimeline((current) => [event, ...current].slice(0, 40));
    void reportComputerOperatorEvent(event).catch(() => undefined);
  }, []);

  const refreshStatus = React.useCallback(async () => {
    const epoch=transientEpoch.current;
    const originalScope = steamReadLifecycle.captureStatusScope();
    const isCurrent = () => epoch === transientEpoch.current && originalScope();
    const readOwnedAtRequest = steamReadLifecycle.hasAdmittedSession();
    const current = await getComputerDesktopStatus().catch(error => {
      if (!isCurrent()) return null;
      if (readOwnedAtRequest) {void steamReadLifecycle.statusLost(); throw 'STEAM_READ_SCOPE_UNAVAILABLE';}
      throw error;
    });
    if (!current || !isCurrent()) return null;
    if (readOwnedAtRequest && (!current.available || !current.ownerCommandMode || current.killSwitch === 'active')) void steamReadLifecycle.statusLost();
    setStatus(current);
    await reportComputerRuntimeStatus(current).catch(() => undefined);
    return current;
  }, []);

  const waitFor = React.useCallback(async (predicate: () => boolean, timeoutMs = 1_200) => {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      if (predicate()) return true;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
    }
    return predicate();
  }, []);

  React.useEffect(() => {
    screenMounted.current = true; steamReadLifecycle.attach();
    void refreshStatus().catch((caught) => setError(String(caught)));
    const timer = window.setInterval(() => void refreshStatus().catch(()=>{setError('NATIVE_STATUS_UNAVAILABLE');setStatus(current=>current?{...current,available:false,ownerCommandMode:false,mode:'error'}:null);}), 3_000);
    return () => {
      window.clearInterval(timer);
      nativeMobileConsumerClient.clear();
      transientEpoch.current++;
      screenMounted.current = false;
      const ownRead = steamReadLifecycle.isActive() || steamReadLifecycle.hasOwnedSession();
      void steamReadLifecycle.dispose();
      if ((!ownRead && !evidenceModeRef.current) || regularSessionRef.current) void stopComputer();
    };
  }, [refreshStatus]);

  React.useEffect(() => {
    if (!sessionId || !status || status.ownerCommandMode || revokedSessionIdsRef.current.has(sessionId)) return;
    revokedSessionIdsRef.current.add(sessionId);
    if (task) {claimTask(task);onTaskHandled?.(task.id);}
    invalidateTransient();
    setSessionId(null);
    const stopped = status.killSwitch === 'active' || status.mode === 'disabled';
    setPhase(stopped ? 'stopped' : 'error');
    record(stopped ? 'stopped' : 'error', stopped
      ? 'The local session ended because the emergency stop became active.'
      : 'The owner-approved session expired or the desktop runtime became unavailable.');
    void stopComputer();
  }, [claimTask, invalidateTransient, onTaskHandled, record, sessionId, status, task]);

  const stop = React.useCallback(async () => {
    if(stoppingRef.current)return;stoppingRef.current=true;setStopping(true);
    steamReadLifecycle.revoke('stop'); setSteamGameIntent(''); setSteamReadConfirmed(false);
    if (task) {claimTask(task);onTaskHandled?.(task.id);}
    if (sessionId) revokedSessionIdsRef.current.add(sessionId);
    invalidateTransient();
    window.dispatchEvent(new Event('edith-computer-stop'));
    let stopReceipt:Awaited<ReturnType<typeof stopComputer>>|undefined;
    try { stopReceipt=await stopComputer(); await steamReadLifecycle.end(); } catch (caught) { setError(String(caught)); } finally {invalidateTransient();stoppingRef.current=false;setStopping(false);}
    setNativeStopState(stopReceipt?currentNativeStopState(stopReceipt,sessionId):'unknown');
    setSessionId(null);
    setPhase('stopped');
    record('stopped', 'Local Computer Use session ended.');
    void refreshStatus();
  }, [claimTask, invalidateTransient, onTaskHandled, record, refreshStatus, sessionId, task]);

  React.useEffect(() => {
    if (!sessionId && !steamReadLocked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); void stop(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionId, steamReadLocked, stop]);

  React.useEffect(() => {
    const onGlobalStop = () => {
      steamReadLifecycle.revoke('global-stop'); void steamReadLifecycle.end(); setSteamGameIntent(''); setSteamReadConfirmed(false);
      if (task) {claimTask(task);onTaskHandled?.(task.id);}
      if (sessionId) revokedSessionIdsRef.current.add(sessionId);
      invalidateTransient();
      setSessionId(null);
      setPhase('stopped');
      record('stopped', 'Global emergency stop ended the local session.');
      void refreshStatus();
    };
    const onLogout = () => {void stop();};
    window.addEventListener('edith-owner-logout',onLogout);
    window.addEventListener('edith-computer-stop', onGlobalStop);
    return () => {window.removeEventListener('edith-computer-stop', onGlobalStop);window.removeEventListener('edith-owner-logout',onLogout);};
  }, [claimTask, invalidateTransient, onTaskHandled, record, refreshStatus, sessionId, stop, task]);

  const captureScreenshot = React.useCallback(async (id: string) => {
    if (steamReadLockedRef.current) throw new Error('STEAM_READ_BUSY');
    const epoch = transientEpoch.current;
    const image = await getComputerScreenshot(id);
    if (epoch !== transientEpoch.current || revokedSessionIdsRef.current.has(id)) throw new Error('desktop_session_stopped_or_expired');
    setObservation(image);
    setOverlayCursor({ x: image.cursorX, y: image.cursorY });
    return image;
  }, []);

  const observe = React.useCallback(async (id: string) => {
    if (steamReadLockedRef.current) return;
    setError('');
    setReadback('');
    setOcrOutcome('');
    setPhase('observing');
    record('observing', 'Capturing a fresh native desktop observation.');
    const epoch = transientEpoch.current;
    try {
      const image = await observeComputer(id);
      if (epoch !== transientEpoch.current || revokedSessionIdsRef.current.has(id)) throw new Error('desktop_session_stopped_or_expired');
      setObservation(image);
      setOverlayCursor({ x: image.cursorX, y: image.cursorY });
      setPhase('success');
      record('success', `${image.width} x ${image.height} desktop captured.`);
      return image;
    } catch (caught) {
      if (epoch !== transientEpoch.current || revokedSessionIdsRef.current.has(id)) throw caught;
      setPhase('error');
      setError(String(caught));
      record('error', 'Native request failed; no verified outcome.');
      throw caught;
    }
  }, [captureScreenshot, record]);

  const verifySafety = React.useCallback(async () => {
    const response = await fetch('/api/edith/kill-switch');
    if (!response.ok) throw new Error('Could not verify the emergency stop state.');
    const payload = await readJsonResponse(response);
    if (payload.state?.active) throw new Error('Emergency stop is active. Computer Use is blocked.');
  }, []);

  const deactivateKillSwitch = React.useCallback(async () => {
    setError('');
    try {
      const response = await ownerMutationFetch('/api/edith/kill-switch/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DISABLE_KILL_SWITCH' }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok || !payload.success) throw new Error(payload.safeMessage ?? 'Kill switch could not be deactivated.');
      setKillSwitchUnlockArmed(false);
      setPhase('success');
      record('success', 'Kill switch deactivated after explicit owner confirmation; no device action was started.');
      await refreshStatus();
    } catch (caught) {
      setPhase('error');
      setError(String(caught));
      record('error', 'Native request failed; no verified outcome.');
    }
  }, [record, refreshStatus]);

  const runAction = React.useCallback(async (
    request: ComputerDesktopAction,
    label: string,
    verification?: ActionVerification,
    activeSessionId?: string,
    semanticQuery?: string,
  ) => {
    const id = activeSessionId ?? sessionId;
    if (steamReadLockedRef.current) return undefined;
    if (!id || nativeBusyRef.current) return undefined;
    nativeBusyRef.current = true; setNativeBusy(true);
    const epoch = transientEpoch.current;
    setError('');
    setPhase('planning');
    record('planning', label);
    try {
      await verifySafety();
      await observe(id);
      if (epoch !== transientEpoch.current || revokedSessionIdsRef.current.has(id)) throw new Error('desktop_session_stopped_or_expired');
      if (request.action !== 'launchApp') {
        const query = semanticQuery ?? (request.action === 'typeText' || request.action === 'hotkey' || request.action === 'pressKey'
          ? 'Native typing test field' : request.action === 'scroll' ? 'Native scroll test area' : 'Safe click target');
        const target = await locateComputerTarget(id, query);
        if (epoch !== transientEpoch.current || revokedSessionIdsRef.current.has(id)) throw new Error('desktop_session_stopped_or_expired');
        if (target.provenance !== 'uia') throw new Error('uia_target_required');
        const bounds = target.physicalBounds;
        if (!bounds) throw new Error('uia_target_bounds_missing');
        const point = {x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2)};
        request = request.action === 'moveMouse' || request.action === 'clickMouse' || request.action === 'doubleClickMouse'
          ? {...request, ...point, target} : request.action === 'dragMouse'
            ? {...request, dragStart:point, target, destinationTarget:await locateComputerTarget(id,'Native scroll test area')} : {...request,target};
        if (request.action === 'dragMouse' && request.destinationTarget) {
          const b = request.destinationTarget.physicalBounds;
          request = {...request,dragEnd:{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}};
        }
      }
      if (epoch !== transientEpoch.current || revokedSessionIdsRef.current.has(id)) throw new Error('desktop_session_stopped_or_expired');
      const actionState = operatorStateForAction(request.action);
      const actionDetails = request.action === 'moveMouse' || request.action === 'clickMouse'
        ? { x: request.x, y: request.y }
        : {};
      setPhase(actionState);
      record(actionState, label, actionDetails);
      if (request.action === 'moveMouse' || request.action === 'clickMouse') {
        setOverlayCursor({ x: request.x, y: request.y });
      }
      const result = await actOnComputer(id, request);
      if (epoch !== transientEpoch.current || revokedSessionIdsRef.current.has(id)) return undefined;
      if (request.action === 'clickMouse' && result.injected && result.dispatchStatus === 'dispatched') {
        setClickPulse({ id: Date.now(), x: request.x, y: request.y });
      }
      setOverlayCursor({ x: result.cursorX, y: result.cursorY });
      setPhase('verifying');
      record('verifying', 'Capturing a fresh screen and checking the requested outcome.', {
        sessionId: id,
        planId: result.planId,
        stepId: result.stepId,
        observationId: result.preObservationId,
        actionId: result.actionId,
        verificationStatus: result.verificationStatus,
      });
      await captureScreenshot(id);

      const localCheck = verification ? await verification() : undefined;
      const canonicalVerified = result.dispatchStatus === 'dispatched'
        && result.canonicalLifecycle?.verification.status === 'verified';
      const check = {ok: canonicalVerified && (!localCheck || localCheck.ok), detail: canonicalVerified && (!localCheck || localCheck.ok)
        ? 'Canonical native postcondition verified.'
        : localCheck?.ok ? 'Local diagnostic effect observed; canonical verification remains partial.'
          : 'Input outcome remains unverified; dispatch or screenshot change alone is insufficient.'};
      setPhase(check.ok ? 'success' : 'error');
      record(check.ok ? 'success' : 'error', check.detail, {
        sessionId: id,
        planId: result.planId,
        stepId: result.stepId,
        observationId: result.postObservationId ?? result.preObservationId,
        actionId: result.actionId,
        verificationStatus: check.ok ? 'verified' : 'partial',
      });
      if (!check.ok) setError(check.detail);
      return { result, verified: check.ok };
    } catch (caught) {
      if (epoch !== transientEpoch.current || revokedSessionIdsRef.current.has(id)) return undefined;
      setPhase('error');
      setError(String(caught));
      record('error', 'Native action failed; no verified outcome.');
      return undefined;
    } finally { nativeBusyRef.current = false; setNativeBusy(false); }
  }, [captureScreenshot, observe, record, sessionId, verifySafety]);

  const moveTest = React.useCallback(async (activeSessionId?: string) => {
    const id = activeSessionId ?? sessionId;
    if (id) await runAction({action:'moveMouse',x:0,y:0},'Move to the fresh UIA diagnostic target.',undefined,id);
  }, [runAction, sessionId]);

  const clickTest = React.useCallback(async (activeSessionId?: string) => {
    const id = activeSessionId ?? sessionId;
    if (!id || !clickTargetRef.current) return;
    const point = {x:0,y:0};
    const previous = clickCountRef.current;
    await runAction(
      { action: 'clickMouse', ...point, button: 'left' },
      'Click the in-app test target.',
      async () => {
        const ok = await waitFor(() => clickCountRef.current > previous);
        return { ok, detail: ok ? 'The in-app target received the native click.' : 'The in-app target did not receive the click.' };
      },
      id,
    );
  }, [runAction, sessionId, waitFor]);

  const typeTest = React.useCallback(async (activeSessionId?: string) => {
    const id = activeSessionId ?? sessionId;
    const target = typingTargetRef.current;
    if (!id || !target) return;
    const expected = 'EDITH_COMPUTER_USE_OK';
    target.value = '';
    target.focus();
    await runAction(
      { action: 'typeText', text: expected },
      'Type the exact test phrase in the in-app field.',
      async () => {
        const ok = await waitFor(() => target.value === expected);
        return { ok, detail: ok ? 'The test field contains the exact native typing result.' : 'The test field did not receive the expected text.' };
      },
      id,
    );
  }, [runAction, sessionId, waitFor]);

  const hotkeyTest = React.useCallback(async (activeSessionId?: string) => {
    const id = activeSessionId ?? sessionId;
    const target = typingTargetRef.current;
    if (!id || !target) return;
    if (!target.value) target.value = 'EDITH_COMPUTER_USE_OK';
    target.focus();
    target.setSelectionRange(target.value.length, target.value.length);
    await runAction(
      { action: 'hotkey', keys: ['CTRL', 'A'] },
      'Select the test-field text with Ctrl+A.',
      async () => {
        const ok = await waitFor(() => target.selectionStart === 0 && target.selectionEnd === target.value.length);
        return { ok, detail: ok ? 'Ctrl+A selected the full test-field value.' : 'The expected text selection was not observed.' };
      },
      id,
    );
  }, [runAction, sessionId, waitFor]);

  const interruptTypingTest = React.useCallback(async (activeSessionId?: string) => {
    const id = activeSessionId ?? sessionId;
    const target = typingTargetRef.current;
    if (!id || !target) return;
    const payload = 'EDITH_INTERRUPT_TEST_'.padEnd(200, 'X');
    target.value = '';
    target.focus();
    setError('');
    setPhase('typing');
    record('typing', 'Starting a bounded native typing action for the stop test.');
    let stopCompleted = false;
    const timer = window.setTimeout(() => {
      void stopComputer()
        .then(() => { stopCompleted = true; })
        .catch(() => { stopCompleted = false; });
    }, 150);
    try {
      await observe(id);
      const semanticTarget = await locateComputerTarget(id, 'Native typing test field');
      await actOnComputer(id, { action: 'typeText', text: payload, target: semanticTarget });
      window.clearTimeout(timer);
      await stopComputer().catch(() => undefined);
      setSessionId(null);
      const detail = 'The bounded typing action completed before the stop signal could interrupt it.';
      setPhase('error');
      setError(detail);
      record('error', detail);
      await refreshStatus();
    } catch {
      window.clearTimeout(timer);
      await waitFor(() => stopCompleted, 1_000);
      if (!stopCompleted) {
        try {
          await stopComputer();
          stopCompleted = true;
        } catch {
          stopCompleted = false;
        }
      }
      setSessionId(null);
      setPhase('verifying');
      record('verifying', 'Checking that native typing stopped before the full payload was entered.');
      const interrupted = stopCompleted && target.value.length > 0 && target.value.length < payload.length;
      const detail = interrupted
        ? `Stop interrupted native typing after ${target.value.length} of ${payload.length} characters.`
        : 'The stop test did not prove a partial native typing result.';
      setPhase(interrupted ? 'stopped' : 'error');
      record(interrupted ? 'stopped' : 'error', detail);
      if (!interrupted) setError(detail);
      await refreshStatus();
    }
  }, [record, refreshStatus, sessionId, waitFor]);

  const scrollTest = React.useCallback(async (activeSessionId?: string) => {
    const id = activeSessionId ?? sessionId;
    const target = scrollTargetRef.current;
    if (!id || !target) return;
    target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    target.scrollTop = 0;
    const point = {x:0,y:0};
    await runAction({ action: 'moveMouse', ...point }, 'Move the pointer over the safe scroll target.', undefined, id, 'Native scroll test area');
    const before = target.scrollTop;
    const down = await runAction(
      { action: 'scroll', delta: -240 },
      'Scroll the in-app test area down.',
      async () => {
        const ok = await waitFor(() => target.scrollTop > before);
        return { ok, detail: ok ? 'The in-app test area scrolled down.' : 'No scroll movement was observed in the test area.' };
      },
      id,
    );
    if (down?.verified) {
      await runAction(
        { action: 'scroll', delta: 240 },
        'Return the in-app test area to the top.',
        async () => {
          const ok = await waitFor(() => target.scrollTop <= before + 1);
          return { ok, detail: ok ? 'The in-app test area returned to its original position.' : 'The test area did not return to its original position.' };
        },
        id,
      );
    }
  }, [runAction, sessionId, waitFor]);

  const openApprovedApp = React.useCallback(async (app: 'notepad' | 'calculator', activeSessionId?: string) => {
    const id = activeSessionId ?? sessionId;
    if (!id) return;
    await runAction({ action: 'launchApp', app }, `Start the approved local application: ${app}.`, undefined, id);
  }, [runAction, sessionId]);

  const executeTask = React.useCallback(async (currentTask: ComputerCommandTask, id: string) => {
    if (steamReadLockedRef.current) return;
    if (executionIds.current.has(currentTask.id)) return;
    executionIds.current.add(currentTask.id);
    if (executionIds.current.size > 100) executionIds.current = new Set([currentTask.id]);
    const epoch = transientEpoch.current;
    let ownsWorkflow = false;
    try {
      if (currentTask.kind === 'app_workflow') {
        if (nativeBusyRef.current) throw new Error('APP_WORKFLOW_RESOURCE_BUSY');
        ownsWorkflow=true;nativeBusyRef.current = true; setNativeBusy(true); setWorkflowResult(undefined); setError(''); setPhase('planning');
        let identity = workflowIdentities.current.get(currentTask.id);
        if (!identity) {const workflowId='ui-workflow-'+crypto.randomUUID();identity={workflowId,idempotencyKey:workflowId};workflowIdentities.current.set(currentTask.id,identity);}
        if (workflowIdentities.current.size > 100) workflowIdentities.current = new Map([[currentTask.id,identity]]);
        record('planning', 'Running the approved bounded app workflow; canonical task verification pending.');
        await verifySafety();
        if (epoch !== transientEpoch.current || currentTaskId.current !== currentTask.id) return;
        const result = await runComputerAppWorkflow(id,currentTask.request,identity);
        if (epoch !== transientEpoch.current || currentTaskId.current !== currentTask.id || revokedSessionIdsRef.current.has(id)) return;
        const registered = result.taskBinding === 'registered' && typeof result.taskId === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(result.taskId)
          && typeof result.bindingId === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(result.bindingId);
        if (result.source !== 'default_native_orchestrator' || result.physicalAcceptance !== false
          || !['verified','partial','blocked'].includes(result.status)
          || (result.status === 'verified' && (!registered || result.taskState !== 'COMPLETED'))) throw new Error('APP_TASK_REQUIRED_PROOF_UNVERIFIED');
        setWorkflowResult(result);
        const verified = result.status === 'verified' && registered && result.taskState === 'COMPLETED';
        setPhase(verified ? 'success' : 'error');
        if (!verified) setError(result.errorCode ?? 'APP_WORKFLOW_PARTIAL');
        record(verified ? 'success' : 'error', verified ? 'Backend canonical task and required postconditions verified.' : 'Workflow blocked or partial; no canonical success.', {sessionId:id,verificationStatus:verified?'verified':'partial'});
        onWorkflowResult?.(currentTask.id,result);
      } else if (currentTask.kind === 'observe') await observe(id);
      else if (currentTask.kind === 'move_test') await moveTest(id);
      else if (currentTask.kind === 'click_test') await clickTest(id);
      else if (currentTask.kind === 'type_test') await typeTest(id);
      else if (currentTask.kind === 'hotkey_test') await hotkeyTest(id);
      else if (currentTask.kind === 'scroll_test') await scrollTest(id);
      else if (currentTask.kind === 'open_app') await openApprovedApp(currentTask.app, id);
    } catch (caught) {
      if (epoch === transientEpoch.current && currentTaskId.current === currentTask.id && !revokedSessionIdsRef.current.has(id)) {
        setPhase('error');setError(caught instanceof Error && /^(?:APP|EXPLORER)_[A-Z_]{1,80}$/.test(caught.message)?caught.message:'APP_WORKFLOW_UNAVAILABLE');
        record('error','App workflow failed; no canonical success.');
      }
    } finally {
      if (ownsWorkflow) {nativeBusyRef.current=false;setNativeBusy(false);}
      onTaskHandled?.(currentTask.id);
    }
  }, [clickTest, hotkeyTest, moveTest, observe, onTaskHandled, onWorkflowResult, openApprovedApp, record, scrollTest, typeTest, verifySafety]);

  const begin = React.useCallback(async () => {
    if (steamReadLockedRef.current) return;
    if (approvalPending.current || stoppingRef.current || sessionId || nativeBusyRef.current) return;
    evidenceModeRef.current = false;
    approvalPending.current=true;setApproving(true);setNativeStopState('unknown');
    const epoch = transientEpoch.current;
    setError('');
    setPhase('planning');
    record('planning', 'Checking the kill switch before requesting local owner approval.');
    try {
      await verifySafety();
      const id = await beginComputerSession();
      if (epoch !== transientEpoch.current) {await stopComputer();return;}
      const approvedStatus = await refreshStatus();
      if (epoch !== transientEpoch.current) {await stopComputer();return;}
      if (!approvedStatus?.ownerCommandMode) throw new Error('Owner approval did not create an active local session.');
      const executableTask = task && task.kind !== 'open_panel' && task.kind !== 'stop' && task.kind !== 'blocked' && claimTask(task)
        ? task
        : null;
      setSessionId(id);
      record('success', 'Owner approved a five-minute local session.');
      await observe(id);
      if (executableTask && currentTaskId.current === executableTask.id) await executeTask(executableTask, id);
    } catch (caught) {
      if (epoch === transientEpoch.current) {if(task){claimTask(task);onTaskHandled?.(task.id);}setPhase('error');setError(String(caught));record('error', 'Native request failed; no verified outcome.');}
    } finally {approvalPending.current=false;setApproving(false);}
  }, [claimTask, executeTask, observe, onTaskHandled, record, refreshStatus, sessionId, task, verifySafety]);

  React.useEffect(() => {
    if (!task || (task.kind !== 'open_panel' && task.kind !== 'stop' && task.kind !== 'blocked') || !claimTask(task)) return;
    if (task.kind === 'open_panel') {
      record('success', 'Computer Use control surface opened; no device action was performed.');
      onTaskHandled?.(task.id);
      return;
    }
    if (task.kind === 'blocked') {
      record('error', task.label);
      onTaskHandled?.(task.id);
      return;
    }
    void stop().finally(() => onTaskHandled?.(task.id));
  }, [claimTask, onTaskHandled, record, stop, task]);

  React.useEffect(() => {
    if (steamReadLockedRef.current || !task || !sessionId || task.kind === 'open_panel' || task.kind === 'stop' || task.kind === 'blocked' || !claimTask(task)) return;
    void executeTask(task, sessionId).catch(() => undefined);
  }, [claimTask, executeTask, sessionId, steamReadLocked, task]);

  React.useEffect(()=>{
    const requestId=browserRequest?.id;
    return ()=>{browserAbort.current?.abort();if(requestId&&!steamReadLockedRef.current)browserHandledRef.current?.(requestId);};
  },[browserRequest?.id]);

  React.useEffect(()=>{
    if(steamReadLockedRef.current||!browserRequest||!sessionId||browserClaims.current.has(browserRequest.id))return;
    const descriptor=browserRequest,epoch=transientEpoch.current;
    browserClaims.current.add(descriptor.id);
    if(nativeBusyRef.current){setError('Browser request blocked: another native operation is active.');onBrowserRequestHandled?.(descriptor.id);return;}
    const controller=new AbortController();browserAbort.current=controller;
    const current=()=>!controller.signal.aborted&&epoch===transientEpoch.current&&browserRequestRef.current?.id===descriptor.id&&!revokedSessionIdsRef.current.has(sessionId);
    nativeBusyRef.current=true;setNativeBusy(true);setError('');setBrowserResult(undefined);setBrowserTicket(undefined);setBrowserStatus(undefined);setPhase('planning');
    record('planning','Original browser request waiting for protected admission and same-task evidence.');
    void runNativeBrowserRequest(sessionId,descriptor.request,{requestId:descriptor.id,signal:controller.signal,
      onPending:ticket=>{if(current())setBrowserTicket(ticket);},onStatus:value=>{if(current())setBrowserStatus(value);}})
      .then(async result=>{
        if(!current())return;
        if(result.requiresStop){setError('Browser outcome remains uncertain; ending this local session without replay.');await stop();return;}
        setBrowserResult(result);setPhase(result.status==='verified'?'success':'error');
        if(result.status!=='verified')setError(result.reasonCode);
        record(result.status==='verified'?'success':'error',result.status==='verified'?'Historical original browser task and every required check verified.':'Original browser result remains unverified; no input replay.');
      }).catch(()=>{if(current()){setError('BROWSER_CONSUMER_UNAVAILABLE');setPhase('error');}})
      .finally(()=>{nativeBusyRef.current=false;setNativeBusy(false);onBrowserRequestHandled?.(descriptor.id);});
    return ()=>controller.abort();
  },[browserRequest,onBrowserRequestHandled,record,sessionId,steamReadLocked,stop]);

  React.useEffect(()=>{if(!filteredFrame)return;const timer=setTimeout(()=>{nativeMobileConsumerClient.clearFrame();setFilteredFrame(undefined);},Math.max(0,filteredFrame.expiresAt-Date.now()));return()=>clearTimeout(timer);},[filteredFrame]);
  const showFilteredFrame = async()=>{if(steamReadLockedRef.current)return;const epoch=transientEpoch.current;setFramePending(true);setFrameError('');try{const value=await nativeMobileConsumerClient.showRegisteredFrame();if(epoch===transientEpoch.current)setFilteredFrame(value);}catch{if(epoch===transientEpoch.current){setFilteredFrame(undefined);setFrameError('Filtered frame unavailable; current registered lease and fresh validated PNG required.');}}finally{if(epoch===transientEpoch.current)setFramePending(false);}};

  const inspectNative = async (kind: 'text' | 'ocr' | 'monitors' | 'spotify' | 'steam' | 'explorer') => {
    if (steamReadLockedRef.current) return;
    if (!sessionId || nativeBusyRef.current) return;
    const id = sessionId, epoch = transientEpoch.current;
    nativeBusyRef.current = true; setNativeBusy(true); setError(''); setReadback(''); setNativeInfo('');
    try {
      await observe(id);
      const result = kind === 'text' ? await readComputerText(id) : kind === 'ocr' ? (await readComputerOcr(id)).result.text
        : kind === 'monitors' ? (await getComputerMonitors(id)).map(m=>m.id+' · '+m.bounds.width+' × '+m.bounds.height).join('\n')
        : (await inspectComputerApp(id,kind)).map(w=>w.app+' · PID '+w.processId).join('\n');
      if (epoch !== transientEpoch.current || revokedSessionIdsRef.current.has(id)) return;
      if (kind === 'text' || kind === 'ocr') setReadback(result.slice(0,16000));
      else setNativeInfo(result.slice(0,4000) || 'No matching native records.');
    } catch { if (epoch === transientEpoch.current) setError('Native inspection unavailable, ambiguous or stale; no fallback result.'); }
    finally { nativeBusyRef.current = false; setNativeBusy(false); }
  };

  const boundedOcrIntent = (text: string) => text.trim().length > 0 && Array.from(text.trim()).length <= 160 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(text.trim());
  const ocrIntentValid = boundedOcrIntent(ocrQuery) && boundedOcrIntent(ocrBefore) && boundedOcrIntent(ocrAfter) && ocrBefore.trim() !== ocrAfter.trim();
  const clickIntendedTransition = async () => {
    if (steamReadLockedRef.current) return;
    if (!sessionId || nativeBusyRef.current || !ocrOptIn || !ocrIntentValid) return;
    const id = sessionId, epoch = transientEpoch.current;
    const intent = {query:ocrQuery.trim(),beforeText:ocrBefore.trim(),afterText:ocrAfter.trim()};
    nativeBusyRef.current = true; setNativeBusy(true); setOcrOptIn(false); setOcrOutcome(''); setError('');
    const current = () => epoch === transientEpoch.current && !revokedSessionIdsRef.current.has(id);
    try {
      await verifySafety();
      if (!current()) return;
      await observe(id);
      if (!current()) return;
      const target = await locateComputerTarget(id,intent.query,{postcondition:{kind:'unique_text_transition',beforeText:intent.beforeText,afterText:intent.afterText}});
      if (!current()) return;
      if (!['uia','ocr'].includes(target.provenance) || !target.physicalBounds) throw new Error('transition_target_unverified');
      const bounds = target.physicalBounds;
      setPhase('clicking');
      record('clicking','Single native click for the explicitly intended visible transition.');
      const result = await actOnComputer(id,{action:'clickMouse',button:'left',attempt:1,x:Math.round(bounds.x+bounds.width/2),y:Math.round(bounds.y+bounds.height/2),target});
      if (!current()) return;
      const lifecycle = result.canonicalLifecycle;
      const dispatched = result.dispatchStatus === 'dispatched' && result.injected === true && result.partialInputInjected !== true && result.releaseConfirmed !== false && result.attempts === 1
        && lifecycle?.dispatch.status === 'dispatched' && lifecycle.action.target?.targetId === target.targetId && lifecycle.verification.status === 'verified';
      const receipt = result.ocrReadback;
      const verified = dispatched && (target.provenance === 'uia' || (isValidatedComputerOcrReadback(receipt) && receipt.matched === true
        && receipt.targetId === target.targetId && receipt.canonicalActionId === result.actionId && receipt.preObservationId === result.preObservationId && receipt.postObservationId === result.postObservationId));
      const detail = verified ? target.provenance === 'ocr' ? 'Local OCR semantic transition verified.' : 'Local UIA postcondition verified.' : 'Intended transition remains unverified; input or pixel change is insufficient.';
      setOcrOutcome(detail); setPhase(verified ? 'success' : 'error');
      if (!verified) setError(detail);
      record(verified ? 'success' : 'error',detail,{sessionId:id,actionId:result.actionId,verificationStatus:verified?'verified':'partial'});
    } catch {
      if (!current()) return;
      const detail = 'Intended transition unavailable, stale or unverified; no verified outcome.';
      setOcrOutcome(detail); setError(detail); setPhase('error');
      record('error',detail,{verificationStatus:'partial'});
    } finally {nativeBusyRef.current=false;setNativeBusy(false);}
  };

  const cursorLeft = observation && overlayCursor ? `${Math.min(100, Math.max(0, (overlayCursor.x - observation.originX) / observation.width * 100))}%` : '0%';
  const cursorTop = observation && overlayCursor ? `${Math.min(100, Math.max(0, (overlayCursor.y - observation.originY) / observation.height * 100))}%` : '0%';
  const pulseLeft = observation && clickPulse ? `${Math.min(100, Math.max(0, (clickPulse.x - observation.originX) / observation.width * 100))}%` : '0%';
  const pulseTop = observation && clickPulse ? `${Math.min(100, Math.max(0, (clickPulse.y - observation.originY) / observation.height * 100))}%` : '0%';

  return (
    <ScreenFrame title="Computer Use" icon={<Cpu className="h-5 w-5" />} subtitle="Supervised local desktop operation with owner approval and a persistent emergency stop" variant="cockpit">
      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <StatusPill label="Runtime" value={status?.runtime ?? 'CHECKING'} tone={status?.available ? 'success' : 'warning'} />
        <StatusPill label="Session" value={sessionId ? 'OWNER APPROVED' : 'INACTIVE'} tone={sessionId ? 'info' : 'muted'} />
        <StatusPill label="Operator" value={phase.toUpperCase()} tone={phase === 'error' ? 'danger' : phase === 'success' ? 'success' : phase === 'idle' ? 'muted' : 'info'} />
        <StatusPill label="Emergency stop" value={status?.killSwitch ?? 'CHECKING'} tone={status?.killSwitch === 'active' ? 'danger' : status?.killSwitch === 'inactive' ? 'success' : 'warning'} />
      </div>
      <OSPanel title="Steam kanıt okuması" eyebrow="BOUNDED READ · CANDIDATE ONLY" icon={<ShieldCheck className="h-4 w-4" />}>
        <p className="text-xs text-slate-300">Aday veri; profil onaylı değil. Windows onayı ve geçerli özgün kapsam gerekir. Her durum bir kez, yalnız açık isteğinizle okunur.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-300">Yetkilendirilen oyun
            <input value={steamGameIntent} onChange={event => {setSteamGameIntent(event.target.value); setSteamReadConfirmed(false);}} disabled={steamReadLocked} autoComplete="off" className="mt-1 block rounded border border-white/20 bg-black/30 p-2" />
          </label>
          <label className="text-xs text-slate-300"><input type="checkbox" checked={steamReadConfirmed} disabled={steamReadLocked} onChange={event => setSteamReadConfirmed(event.target.checked)} /> Bu oyun için sınırlı, salt okunur kanıt toplamayı onaylıyorum.</label>
          <button type="button" disabled={steamReadLocked || nativeBusy || approving || stopping || Boolean(sessionId) || Boolean(status?.ownerCommandMode) || !status?.available || !steamReadConfirmed || !steamEvidenceUiIntent(steamGameIntent)} onClick={() => {
            const intent = steamGameIntent; setSteamGameIntent(''); setSteamReadConfirmed(false);
            setObservation(null); setReadback(''); setNativeInfo(''); setWorkflowResult(undefined); setOcrOutcome('');
            void steamReadLifecycle.start(intent, steamReadConfirmed);
          }} className="rounded border border-cyan-400/50 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">Kanıt okumasını başlat</button>
          <button type="button" disabled={!steamReadLocked} onClick={() => void steamReadLifecycle.end()} className="rounded border border-amber-400/50 px-3 py-2 text-xs text-amber-100 disabled:opacity-40">Okumayı bitir / temizlemeyi denetle</button>
        </div>
        <p role="status" className="mt-3 text-xs text-slate-300">Durum: {steamReadView.phase} · candidateOnly: true · profileApproved: false{steamReadView.expiresAt ? ` · expiresAt: ${steamReadView.expiresAt}` : ''}</p>
        {steamReadView.nativeState && <p className="mt-2 text-xs text-slate-300">Native kapanış: {steamReadView.nativeState} · Backend temizliği: {steamReadView.backendCleanup}</p>}
        {(steamReadView.phase === 'worker_pending' || steamReadView.phase === 'session_pending' || steamReadView.phase === 'backend_pending') && <p role="alert" className="mt-2 text-xs text-amber-200">Özgün oturumun veya backend görevinin temizliği doğrulanmadı; normal işlemler kilitli. Temizlemeyi açıkça yeniden denetleyebilirsiniz. Bekleyen onayda iptal isteği, diyaloğun kapandığı anlamına gelmez.</p>}
        {steamReadView.error && <p role="alert" className="mt-2 text-xs text-amber-200">{steamReadView.error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">{STEAM_READ_STATES.map(state => <button key={state} type="button" disabled={steamReadView.phase !== 'ready' || steamReadView.usedStates.includes(state)} onClick={() => void steamReadLifecycle.sample(state)} className="rounded border border-white/20 px-2 py-2 text-xs text-slate-200 disabled:opacity-40">{state}</button>)}</div>
        {steamReadView.samples.map(sample => <details key={sample.state} className="mt-3 break-words text-xs text-slate-300">
          <summary>{sample.state} · sampleGeneration: {sample.sampleGeneration} · nodeCount: {sample.coverage.nodeCount}</summary>
          <dl className="mt-2 grid gap-1">
            <div><dt className="inline">schema: </dt><dd className="inline">{sample.schema}</dd></div>
            <div><dt className="inline">status: </dt><dd className="inline">{sample.status}</dd></div>
            <div><dt className="inline">observedAt / expiresAt: </dt><dd className="inline">{sample.observedAt} / {sample.expiresAt}</dd></div>
            <div><dt className="inline">policyId / policyVersion / producer: </dt><dd className="inline">{sample.policyId} / {sample.policyVersion} / {sample.producer}</dd></div>
            <div><dt className="inline">coverage complete / view: </dt><dd className="inline">{String(sample.coverage.complete)} / {sample.coverage.view}</dd></div>
            <div><dt className="inline">sourcePolicySha256: </dt><dd className="inline">{sample.sourcePolicySha256}</dd></div>
            <div><dt className="inline">sourceContractSha256: </dt><dd className="inline">{sample.sourceContractSha256}</dd></div>
            <div><dt className="inline">nativeBuildId: </dt><dd className="inline">{sample.nativeBuildId}</dd></div>
          </dl>
          <div className="mt-2 max-h-80 overflow-auto"><table className="w-full text-left"><caption className="text-left">Yalnız doğrulanmış sonlu alanlar; düğüm numaraları bu örneğe özeldir.</caption><thead><tr><th>nodeId</th><th>ancestorIds</th><th>propertyId</th><th>variant</th><th>value</th></tr></thead><tbody>{sample.records.map((row, index) => <tr key={index}><td>{row.nodeId}</td><td>{row.ancestorIds.join(', ')}</td><td>{row.propertyId}</td><td>{row.variant}</td><td>{String(row.value)}</td></tr>)}</tbody></table></div>
        </details>)}
      </OSPanel>
      <CockpitGrid className="xl:grid-cols-[minmax(0,1.55fr)_minmax(19rem,.72fr)]">
        <OSPanel title="Live desktop" eyebrow="SUPERVISED VIEW" icon={<Eye className="h-4 w-4" />}>
          <div className="relative flex min-h-[18rem] aspect-video items-center justify-center overflow-hidden rounded-md border border-cyan-300/15 bg-black/55 shadow-[inset_0_0_60px_rgba(8,145,178,.08)]">
            {observation ? <img src={observation.imageDataUrl} alt="Latest local desktop capture" className="h-full w-full object-contain" /> : <p className="px-4 text-center text-sm text-slate-400">{status?.safeMessage ?? 'Desktop status loading...'}</p>}
            {overlayEnabled && sessionId && <>
              <span className="pointer-events-none absolute left-2 top-2 h-8 w-8 border-l-2 border-t-2 border-cyan-300 shadow-[0_0_15px_#67e8f9]" />
              <span className="pointer-events-none absolute right-2 top-2 h-8 w-8 border-r-2 border-t-2 border-cyan-300 shadow-[0_0_15px_#67e8f9]" />
              <span className="pointer-events-none absolute bottom-2 left-2 h-8 w-8 border-b-2 border-l-2 border-cyan-300 shadow-[0_0_15px_#67e8f9]" />
              <span className="pointer-events-none absolute bottom-2 right-2 h-8 w-8 border-b-2 border-r-2 border-cyan-300 shadow-[0_0_15px_#67e8f9]" />
              {observation && overlayCursor && <span aria-label="EDITH cursor" className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-100 bg-cyan-400/60 shadow-[0_0_12px_#22d3ee]" style={{ left: cursorLeft, top: cursorTop }} />}
              {observation && clickPulse && <span key={clickPulse.id} aria-label="Click pulse" className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-cyan-200" style={{ left: pulseLeft, top: pulseTop }} />}
              <span className="absolute bottom-3 left-3 rounded bg-black/80 px-2 py-1 text-xs text-cyan-100">{phase.toUpperCase()}</span>
            </>}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={steamReadLocked || !sessionId || nativeBusy} onClick={() => sessionId && void observe(sessionId)} className="flex items-center gap-2 rounded border border-cyan-400/40 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40"><Eye className="h-4 w-4" /> Refresh view</button>
              <label className="flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={overlayEnabled} onChange={(event) => setOverlayEnabled(event.target.checked)} /> In-app diagnostic guide</label>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">No action without an approved session</span>
          </div>
        </OSPanel>
        <OSPanel title="Operator control" eyebrow="OWNER COMMAND" icon={<ShieldCheck className="h-4 w-4" />}>
          <div className="space-y-2">
            <ActionRow label="Runtime" value={status?.runtime ?? 'checking'} />
            <ActionRow label="Mode" value={status?.mode ?? 'read_only'} />
            <ActionRow label="Owner Command" value={status?.ownerCommandMode ? 'ACTIVE' : 'INACTIVE'} />
            <ActionRow label="Screen capture" value={status?.screenCapture ?? 'missing'} />
            <ActionRow label="Mouse" value={status?.mouseControl ?? 'missing'} />
            <ActionRow label="Keyboard" value={status?.keyboardControl ?? 'missing'} />
            <ActionRow label="Targeting" value={status?.targeting ?? 'window_relative_fallback'} />
            <ActionRow label="UIA" value={status?.uia ?? 'missing'} />
            <ActionRow label="OCR" value={status?.ocr ?? 'missing'} />
            <ActionRow label="Multi-monitor" value={status?.multiMonitor ?? 'missing'} />
            <ActionRow label="In-app overlay" value={status?.overlay ?? 'missing'} />
            <ActionRow label="Native overlay" value={status?.nativeOverlayReady === true ? 'ready' : 'unavailable'} />
            <ActionRow label="Kill switch" value={status?.killSwitch ?? 'unknown'} />
          </div>
          {task && <div className="mt-3 border-l-2 border-cyan-300/70 pl-3 text-xs text-cyan-100"><span className="text-slate-400">Current task</span><p className="mt-1">{task.label}</p></div>}
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <button type="button" disabled={steamReadLocked || !status?.available || Boolean(sessionId) || approving || stopping || nativeBusy} onClick={() => void begin()} className="flex items-center justify-center gap-2 rounded border border-cyan-400/50 bg-cyan-400/10 px-3 py-3 text-xs font-semibold text-cyan-100 disabled:opacity-40"><Play className="h-4 w-4" /> Start approved session</button>
            {task && sessionId && task.kind !== 'open_panel' && task.kind !== 'stop' && task.kind !== 'blocked' && <button type="button" disabled={steamReadLocked || nativeBusy || executionIds.current.has(task.id)} onClick={() => {if(claimTask(task))void executeTask(task, sessionId);}} className="rounded border border-emerald-400/50 px-3 py-2 text-xs text-emerald-100">Run current task</button>}
            <button type="button" onClick={() => void stop()} className="flex items-center justify-center gap-2 rounded border border-red-400/60 bg-red-500/12 px-3 py-3 text-xs font-semibold text-red-100"><Square className="h-4 w-4" /> Stop now <span className="text-red-200/60">Esc</span></button>
          </div>
          {status?.killSwitch === 'active' && <div className="mt-3 rounded border border-amber-400/30 bg-amber-950/20 p-3 text-xs text-amber-100">
            <p>Emergency stop is active. Unlocking only restores the approval path; it does not start device control.</p>
            <button type="button" onClick={() => killSwitchUnlockArmed ? void deactivateKillSwitch() : setKillSwitchUnlockArmed(true)} className="mt-2 rounded border border-amber-300/50 px-3 py-2 font-semibold hover:bg-amber-400/10">
              {killSwitchUnlockArmed ? 'Confirm unlock' : 'Prepare unlock'}
            </button>
            {killSwitchUnlockArmed && <p role="alert" className="mt-2 text-amber-200">Confirming re-enables the separate Windows owner-approval step for up to five minutes.</p>}
          </div>}
          {workflowResult&&<div aria-label="Canonical workflow result" role="region" aria-live="polite" className="mt-3 break-words text-xs text-slate-300"><p>{workflowResult.app} / {workflowResult.workflow} · {workflowResult.status}</p><p>Canonical task: {workflowResult.taskId??'not registered'}</p><p>Binding: {workflowResult.bindingId??'unbound'} · {workflowResult.taskState??'unbound'}</p><p>{workflowResult.status==='verified'?'Backend required checks PASS':'Outcome remains unverified'} · Physical acceptance: unverified</p></div>}
          <div role="region" aria-label="Native mobile session status" className="mt-3 break-words text-xs text-slate-400">
            <p>Original session STOP: {nativeStopState}. Backend acceptance alone does not establish native quiescence.</p>
            <button type="button" onClick={()=>void showFilteredFrame()} disabled={steamReadLocked||framePending||!sessionId||!nativeMobileConsumerClient.hasRegisteredLiveView()} className="mt-2 rounded border border-white/10 px-2 py-1 disabled:opacity-40">Show registered filtered frame</button>
            {filteredFrame?<><img src={filteredFrame.url} width={filteredFrame.width} height={filteredFrame.height} alt="Current registered filtered window frame" className="mt-2 max-w-full"/><p>Fresh filtered PNG · original two-second expiry. Session display, not task verification.</p><button type="button" onClick={()=>{nativeMobileConsumerClient.clearFrame();setFilteredFrame(undefined);}}>Close filtered frame</button></>:<p>Live View: configuration_required until an explicit current registered lease supplies actual pixels.</p>}
            {frameError&&<p>{frameError}</p>}
          </div>
          {(browserRequest||browserTicket||browserResult)&&<div aria-label="Browser workflow result" role="region" aria-live="polite" className="mt-3 break-words text-xs text-slate-300">
            {browserRequest&&!sessionId&&<p>Original browser intent retained; owner-approved session required before admission.</p>}
            {browserTicket&&<p>Original canonical task: {browserTicket.taskId}{!browserResult?' · Pending backend proof':''}</p>}
            {browserStatus&&<p>Native diagnostic: {browserStatus.status} · {browserStatus.reasonCode}. Counts and local completion are not task success.</p>}
            {browserResult&&<><p>Historical canonical result: {browserResult.taskId??'no task'} · {browserResult.canonicalStatus??'unverified'} · {browserResult.status}</p><p>{browserResult.provenance==='dom_only'?'DOM-only; no native physical proof.':browserResult.provenance==='native'?'Native result requires original producer proof.':'Native capability unavailable or outcome unknown.'}</p><p>{browserResult.status==='verified'?'Every ordinary required check PASS.':'No verified browser task success.'}</p></>}
          </div>}
          {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <ActionRow label="Registered tools" value={String(tools.length)} />
            <ActionRow label="Audit logs" value={String(logs.length)} />
          </div>
        </OSPanel>
      </CockpitGrid>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,.45fr)]">
        <OSPanel title="Operator timeline" eyebrow="OBSERVE / PLAN / ACT / VERIFY" icon={<Route className="h-4 w-4" />}>
          <div className="max-h-56 space-y-1 overflow-y-auto text-xs">
            {timeline.length ? timeline.map((event) => <div key={event.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 border-b border-white/10 py-2"><span className="font-mono text-cyan-200">{event.type}</span><span className="text-slate-300">{event.message ?? event.safeMessage}</span></div>) : <p className="text-slate-400">No local actions yet. Start an approved session to begin.</p>}
          </div>
        </OSPanel>
        <OSPanel title="Safety boundary" eyebrow="ALWAYS ENFORCED" icon={<LockKeyhole className="h-4 w-4" />}>
          <div className="space-y-2 text-xs text-slate-300">
            <ActionRow label="Owner approval" value={sessionId ? 'ACTIVE' : 'REQUIRED'} />
            <ActionRow label="Session expiry" value={status?.sessionExpiresAt ? new Date(status.sessionExpiresAt).toLocaleTimeString() : 'NO SESSION'} />
            <ActionRow label="Stop path" value="UI + ESC + GLOBAL" />
            <p className="rounded border border-white/10 bg-black/20 p-3 leading-relaxed text-slate-400">Screen capture and input controls report the native runtime state. Unavailable capabilities remain unavailable; this surface never simulates readiness.</p>
          </div>
        </OSPanel>
      </div>
      <details className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-400">
        <summary className="cursor-pointer select-none font-semibold text-slate-300">Advanced native input diagnostics</summary>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <button type="button" disabled={steamReadLocked || !sessionId || nativeBusy} onClick={() => void moveTest()} className="rounded border border-white/20 px-2 py-2 disabled:opacity-40">Move test</button>
          <button type="button" disabled={steamReadLocked || !sessionId || nativeBusy} onClick={() => void clickTest()} className="rounded border border-white/20 px-2 py-2 disabled:opacity-40">Click test</button>
          <button type="button" disabled={steamReadLocked || !sessionId || nativeBusy} onClick={() => void typeTest()} className="rounded border border-white/20 px-2 py-2 disabled:opacity-40">Type test</button>
          <button type="button" disabled={steamReadLocked || !sessionId || nativeBusy} onClick={() => void hotkeyTest()} className="rounded border border-white/20 px-2 py-2 disabled:opacity-40">Hotkey test</button>
          <button type="button" disabled={steamReadLocked || !sessionId || nativeBusy} onClick={() => void scrollTest()} className="rounded border border-white/20 px-2 py-2 disabled:opacity-40">Scroll and return</button>
          <button type="button" disabled={steamReadLocked || !sessionId || nativeBusy} onClick={() => void interruptTypingTest()} className="rounded border border-red-400/35 px-2 py-2 text-red-100 disabled:opacity-40">Interrupt typing</button>
          <button type="button" disabled={steamReadLocked || !sessionId || nativeBusy} onClick={() => void openApprovedApp('notepad')} className="rounded border border-white/20 px-2 py-2 disabled:opacity-40">Open Notepad</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={steamReadLocked || !sessionId || nativeBusy || status?.uia !== 'ready'} onClick={()=>void runAction({action:'doubleClickMouse',x:0,y:0,attempt:1},'Double-click the UIA diagnostic target.')} className="rounded border border-white/20 p-2">Double click test</button>
          <button disabled={steamReadLocked || !sessionId || nativeBusy || status?.uia !== 'ready'} onClick={()=>void runAction({action:'dragMouse',dragStart:{x:0,y:0},dragEnd:{x:0,y:0},dragDurationMs:300,attempt:1},'Drag between fresh UIA diagnostic targets.')} className="rounded border border-white/20 p-2">Drag test</button>
          {(['text','ocr','monitors','spotify','steam','explorer'] as const).map(kind=><button key={kind} disabled={steamReadLocked || !sessionId || nativeBusy || (kind==='text' && status?.uia!=='ready') || (kind==='ocr' && status?.ocr!=='ready')} onClick={()=>void inspectNative(kind)} className="rounded border border-white/20 p-2">Read {kind}</button>)}
        </div>
        <div className="mt-3 space-y-2 rounded border border-white/15 p-3">
          <p>Single click with an intended visible transition. UIA is tried first; native OCR fallback is limited to supported Notepad/Calculator targets.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label>Target text<input aria-label="OCR target query" maxLength={320} value={ocrQuery} disabled={steamReadLocked || nativeBusy} onChange={event=>{setOcrQuery(event.target.value);setOcrOptIn(false);setOcrOutcome('');}} className="mt-1 w-full min-w-0 rounded border border-white/20 bg-black/30 p-2 text-white" /></label>
            <label>Visible before<input aria-label="OCR before text" maxLength={320} value={ocrBefore} disabled={steamReadLocked || nativeBusy} onChange={event=>{setOcrBefore(event.target.value);setOcrOptIn(false);setOcrOutcome('');}} className="mt-1 w-full min-w-0 rounded border border-white/20 bg-black/30 p-2 text-white" /></label>
            <label>Expected to appear<input aria-label="OCR after text" maxLength={320} value={ocrAfter} disabled={steamReadLocked || nativeBusy} onChange={event=>{setOcrAfter(event.target.value);setOcrOptIn(false);setOcrOutcome('');}} className="mt-1 w-full min-w-0 rounded border border-white/20 bg-black/30 p-2 text-white" /></label>
          </div>
          <label className="flex items-center gap-2"><input aria-label="Enable explicit OCR transition" type="checkbox" checked={ocrOptIn} disabled={steamReadLocked || !sessionId || nativeBusy || !ocrIntentValid} onChange={event=>setOcrOptIn(event.target.checked)} /> Allow native OCR fallback for this single intended click</label>
          <button type="button" disabled={steamReadLocked || !sessionId || nativeBusy || !ocrOptIn || !ocrIntentValid} onClick={()=>void clickIntendedTransition()} className="rounded border border-white/20 p-2 disabled:opacity-40">Click intended transition</button>
          <p>OCR readiness comes from native policy; it is not a measured recognition accuracy. This diagnostic does not complete an app task.</p>
          {ocrOutcome && <p aria-label="OCR transition result" role="status" className="break-words">{ocrOutcome}</p>}
        </div>
        {nativeBusy&&<p role="status">Native response pending; no outcome verified.</p>}
        {readback&&<pre aria-label="Transient native readback" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">{readback}</pre>}
        {nativeInfo&&<pre aria-label="Native inspection" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">{nativeInfo}</pre>}
        <div className="mt-3 flex gap-2">
          <button ref={clickTargetRef} type="button" onClick={() => { clickCountRef.current += 1; setClickCount(clickCountRef.current); }} className="rounded border border-emerald-400/40 px-3 py-2">Safe click target: {clickCount}</button>
          <input ref={typingTargetRef} aria-label="Native typing test field" className="min-w-0 flex-1 rounded border border-white/20 bg-black/30 px-2 text-white" />
        </div>
        <div ref={scrollTargetRef} aria-label="Native scroll test area" className="mt-3 h-16 overflow-y-auto rounded border border-white/15 bg-black/25 px-2">
          <div className="flex h-40 items-start pt-2">Safe scroll target</div>
        </div>
      </details>
    </ScreenFrame>
  );
}

export type LocalSearchSelection = {scope:'task'|'research';recordId:string;requestId:string};
export function LocalSearchPanel({onOpenResult}:{onOpenResult:(selection:LocalSearchSelection)=>void}) {
  const [query,setQuery]=React.useState('');const [scope,setScope]=React.useState<LocalSearchScope|'all'>('all');
  const [results,setResults]=React.useState<LocalSearchResult[]>([]);const [state,setState]=React.useState('idle');const [error,setError]=React.useState('');
  const generation=React.useRef(0),pending=React.useRef<AbortController>();
  const invalidate=()=>{generation.current++;pending.current?.abort();setResults([]);setError('');setState('idle');};
  React.useEffect(()=>()=>{generation.current++;pending.current?.abort();},[]);
  const search=async()=>{pending.current?.abort();const abort=new AbortController();pending.current=abort;const request=++generation.current;setResults([]);setError('');setState('loading');
    try{const result=await fetchLocalSearch(query,scope==='all'?LOCAL_SEARCH_SCOPES:[scope],abort.signal);if(request!==generation.current||abort.signal.aborted)return;setResults(result.results);setState(result.results.length?'ready':'empty');}
    catch(cause){if(request!==generation.current||abort.signal.aborted)return;setResults([]);setState('error');setError(cause instanceof LocalSearchClientError?cause.message:'Yerel arama servisine ulaşılamadı.');}
  };
  return <details className="relative z-30 shrink-0 border-b border-white/10 bg-slate-950 px-3 py-1 text-xs text-slate-200" onToggle={event=>{if(!event.currentTarget.open)invalidate();}}><summary className="cursor-pointer py-1">Yerel kayıtlarda ara</summary>
    <div className="max-h-72 overflow-auto py-2"><form onSubmit={event=>{event.preventDefault();void search();}} className="flex flex-wrap gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-2">Arama<input aria-label="Yerel arama sorgusu" value={query} maxLength={500} onChange={event=>{invalidate();setQuery(event.target.value);}} className="min-w-0 flex-1 rounded bg-slate-900 p-2" /></label>
      <select aria-label="Yerel arama kapsamı" value={scope} onChange={event=>{invalidate();setScope(event.target.value as LocalSearchScope|'all');}} className="rounded bg-slate-900 p-2"><option value="all">Tüm yerel kayıtlar</option>{LOCAL_SEARCH_SCOPES.map(s=><option key={s} value={s}>{s}</option>)}</select>
      <button disabled={!query.trim()} className="rounded border border-white/15 px-3 disabled:opacity-40">Yerel ara</button>
    </form><p role="status" className="mt-2 text-slate-400">{error||(state==='loading'?'Yerel kayıtlar yükleniyor':state==='empty'?'Eşleşen yerel kayıt yok.':state==='ready'?results.length+' yerel sonuç':'Sorgu girin; hassas bellek araması yapılmaz.')}</p>
    <ul className="mt-2 space-y-2">{results.map(row=><li key={row.id} className="rounded border border-white/10 p-2"><p className="font-medium">{row.title}</p><p className="mt-1 whitespace-pre-wrap break-words text-slate-400">{row.summary}</p><p className="mt-1 break-words font-mono text-[10px] text-slate-500">{row.scope} · {row.provenance.source} · {row.provenance.recordType} · {row.provenance.recordId} · <time dateTime={row.provenance.retrievedAt}>{row.provenance.retrievedAt}</time></p>
      {(row.scope==='task'||row.scope==='research')?<button type="button" onClick={()=>onOpenResult({scope:row.scope as 'task'|'research',recordId:row.provenance.recordId,requestId:crypto.randomUUID()})} className="mt-1 rounded border border-cyan-400/30 px-2 py-1">Kaydı aç</button>:<p className="mt-1 text-slate-500">Bu kayıt türü için açma bağlantısı mevcut değil.</p>}</li>)}</ul></div>
  </details>;
}

export function BrowserResearchScreen({onBrowserRequest,requestedRunId,requestedSelectionKey,onClearRequestedSelection}: {requestedRunId?:string;requestedSelectionKey?:string;onClearRequestedSelection?:()=>void; tools?: AutomationTool[]; logs?: ToolExecutionLog[]; onBrowserRequest?:(request:BrowserWorkflowRequest)=>void }) {
  const [runs, setRuns] = React.useState<ResearchRunV2[]>([]);
  const [loadedResearch, setSelected] = React.useState<ResearchRunV2>();
  const selected=requestedRunId&&loadedResearch?.runId!==requestedRunId?undefined:loadedResearch;
  const [query, setQuery] = React.useState('');
  const [seeds, setSeeds] = React.useState('');
  const [mode, setMode] = React.useState<'FAST' | 'DEEP' | 'BROWSER'>('FAST');
  const [state, setState] = React.useState('loading');
  const [error, setError] = React.useState('');
  const [measurements, setMeasurements] = React.useState<{retrievedBytes: number; acquisitionCalls: number; modelCalls: number; fixture: boolean}>();
  const generation = React.useRef(0);
  const pendingRead = React.useRef<AbortController>();
  const manualResearchRead = React.useRef(false);
  const beginRead = React.useCallback(() => {pendingRead.current?.abort();const next=new AbortController();pendingRead.current=next;return next;},[]);
  const refresh = React.useCallback(async () => { const abort=beginRead();const request = ++generation.current; setSelected(undefined);setState('loading'); setError('');
    try { const rows = await listResearch(abort.signal); if (request !== generation.current || abort.signal.aborted) return; setRuns(rows); setState(rows.length ? 'ready' : 'empty'); }
    catch (cause) { if (request !== generation.current) return; setState('error'); setError(cause instanceof ResearchClientError ? cause.message : 'Araştırma servisine ulaşılamadı.'); }
  }, [beginRead]);
  React.useEffect(() => () => { ++generation.current;pendingRead.current?.abort(); }, []);
  React.useEffect(()=>{if(!requestedRunId){if(manualResearchRead.current)manualResearchRead.current=false;else void refresh();return;}const abort=beginRead(),request=++generation.current;setSelected(undefined);setRuns([]);setState('loading');setError('');setMeasurements(undefined);
    void (async()=>{try {const rows=await listResearch(abort.signal);if(request!==generation.current||abort.signal.aborted)return;
      if(!rows.some(row=>row.runId===requestedRunId))throw new ResearchClientError('RESEARCH_SELECTION_UNAVAILABLE');
      const current=await getResearch(requestedRunId,abort.signal);if(request!==generation.current||abort.signal.aborted)return;setRuns(rows);setSelected(current);setQuery(current.query);setMode(current.mode??'FAST');setState('ready');
    }catch(cause){if(request!==generation.current||abort.signal.aborted)return;setSelected(undefined);setState('error');setError(cause instanceof ResearchClientError?cause.message:'Araştırma okunamadı.');}})();return()=>abort.abort();
  },[requestedRunId,requestedSelectionKey,beginRead,refresh]);
  const choose = async (row: ResearchRunV2) => {manualResearchRead.current=!!requestedRunId;onClearRequestedSelection?.();const abort=beginRead(); const request = ++generation.current; setSelected(undefined);setState('loading'); setMeasurements(undefined); setError('');
    try { const current = await getResearch(row.runId,abort.signal); if (request !== generation.current || abort.signal.aborted) return; setSelected(current); setState('ready'); }
    catch (cause) { if (request !== generation.current) return; setSelected(undefined); setState('error'); setError(cause instanceof ResearchClientError ? cause.message : 'Araştırma okunamadı.'); }
  };
  const run = async (rerun = false) => { manualResearchRead.current=!!requestedRunId;onClearRequestedSelection?.();pendingRead.current?.abort();const request = ++generation.current; setState('running'); setError(''); setSelected(undefined); setMeasurements(undefined);
    try { const result = await executeResearch(query, mode, seeds.split(/\n/).map(s => s.trim()).filter(Boolean), rerun ? selected?.runId : undefined);
      if (request !== generation.current) return; setSelected(result.run); setMeasurements(result.measurements); const rows = await listResearch(); if (request !== generation.current) return; setRuns(rows); setState('ready');
    } catch (cause) { if (request !== generation.current) return; if (cause instanceof ResearchClientError) setSelected(cause.run); setState(cause instanceof ResearchClientError && cause.code === 'CONFIGURATION_REQUIRED' ? 'configuration_required' : 'error'); setError(cause instanceof ResearchClientError ? cause.message : 'Araştırma servisine ulaşılamadı.'); }
  };
  const download = async () => { if (!selected) return; try { const text = await exportResearch(selected.runId); const url = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'})); const anchor = document.createElement('a'); anchor.href=url; anchor.download='edith-research.txt'; anchor.click(); URL.revokeObjectURL(url); } catch (cause) { setError(cause instanceof ResearchClientError ? cause.message : 'TXT dışa aktarılamadı.'); } };
  return <ScreenFrame title="Tarayıcı / Araştırma" icon={<Globe2 className="h-5 w-5" />} subtitle="Gerçek kaynaklar ve provenance · HTTP metin worker; rendered browser operator değil" variant="cockpit">
    <>{requestedRunId&&<button type="button" onClick={onClearRequestedSelection} className="mb-2 text-xs">Arama seçimini temizle</button>}<CockpitGrid><OSPanel title="Araştırma Oturumu" eyebrow={state.toUpperCase()} icon={<Search className="h-4 w-4" />}>
      <form onSubmit={event => {event.preventDefault(); void run();}} className="space-y-3">
        <label className="block text-xs">Araştırma sorusu<input value={query} maxLength={2000} onChange={event=>setQuery(event.target.value)} className="mt-1 w-full rounded bg-slate-950 p-2" /></label>
        <label className="block text-xs">Mod<select value={mode} onChange={event=>setMode(event.target.value as typeof mode)} className="ml-2 bg-slate-950 p-2"><option>FAST</option><option>DEEP</option><option>BROWSER</option></select></label>
        <label className="block text-xs">Kaynak URL'leri (en fazla 3, satır başına bir)<textarea value={seeds} onChange={event=>setSeeds(event.target.value)} className="mt-1 w-full rounded bg-slate-950 p-2" /></label>
        <button disabled={!query.trim() || state==='running'} className="rounded border border-cyan-400/30 p-2 text-xs disabled:opacity-40">Araştırmayı çalıştır</button>
        <button type="button" disabled={!onBrowserRequest||!isTauriShell()||!query.trim()||state==='running'} onClick={()=>onBrowserRequest?.({action:'search',query:query.trim(),verificationGoal:'Observe actual search results.'})} className="ml-2 rounded border border-cyan-400/30 p-2 text-xs disabled:opacity-40">Tarayıcıda ara</button>
        <p className="text-xs text-slate-400">{isTauriShell()?'Tarayıcı araması ayrı bir istektir; ComputerUse sahip onayı ve gerçek task kanıtı gerektirir.':'Native tarayıcı tüketicisi Tauri gerektirir; araştırma HTTP akışı kullanılabilir.'}</p>
      </form>
      <button onClick={()=>void refresh()} disabled={state==='running'} className="mt-3 text-xs">Geçmişi yenile</button>
      <p role="status" className="mt-3 text-xs text-amber-200">{error || (state==='empty' ? 'Araştırma kaydı yok.' : state==='running' ? 'Backend sonucu bekleniyor; ilerleme yüzdesi üretilmiyor.' : state)}</p>
      <button disabled title="RESEARCH_CANCELLATION_NOT_SUPPORTED: backend 501" className="mt-2 text-xs text-slate-500">İptal adapteri mevcut değil</button>
      <div className="mt-4 space-y-2">{runs.map(row=><button key={row.runId} disabled={state==='running'} onClick={()=>{setQuery(row.query);setMode(row.mode??'FAST');void choose(row);}} className="block w-full rounded border border-white/10 p-2 text-left text-xs">{row.query} · {row.status}</button>)}</div>
    </OSPanel><OSPanel title="Kaynaklar ve Sonuç" eyebrow="PROVENANCE" icon={<Database className="h-4 w-4" />}>
      {selected ? <div className="space-y-3 text-xs"><h3>{selected.query} · {selected.status}</h3><p>{selected.provenance?.methodology ?? 'Yöntem bildirilmedi'}</p><p>Freshness: {selected.freshness?.status ?? 'unknown'} · {selected.uncertainty ?? 'Bağımsız doğrulama iddiası yok'}</p>
        {measurements && <p>Gerçek alınan bayt: {measurements.retrievedBytes} · acquisition: {measurements.acquisitionCalls} · model calls: {measurements.modelCalls} · {measurements.fixture ? 'fixture' : 'producer measurement'}</p>}
        {(selected.sources??[]).map(source=><article key={source.sourceId} className="break-words rounded border border-white/10 p-3"><p>{source.title ?? source.sourceId}</p><p>{source.url}</p><time dateTime={source.retrievedAt}>{source.retrievedAt}</time><p>Source SHA-256: {source.contentSha256 ?? 'bildirilmedi'}</p><p>Retriever: {source.retriever?.id ?? 'bildirilmedi'} · {source.acquisition}</p></article>)}
        {(selected.claims??[]).map(claim=><blockquote key={claim.claimId} className="break-words border-l border-amber-300/30 pl-3"><p>{claim.statement}</p><p>Alıntı · {claim.status??'uncertain'} · confidence {claim.confidence} · {claim.uncertainty}</p><p>{claim.citationIds.map(id=>{const c=selected.citations?.find(c=>c.citationId===id);return c ? c.sourceId+' · excerpt SHA '+(c.excerptSha256??'bildirilmedi') : id;}).join('; ')}</p></blockquote>)}
        <button onClick={()=>void download()} className="rounded border border-white/10 p-2">TXT indir</button><button onClick={()=>void run(true)} disabled={state==='running'} className="ml-2 rounded border border-white/10 p-2">Yeniden çalıştır</button>
      </div> : <EmptyState icon={<SearchIcon />} title="Doğrulanmış araştırma kaydı seçilmedi" text="Kaynak ve alıntılar yalnız backend kayıtlarından gösterilir." />}
    </OSPanel></CockpitGrid>{selected&&<ResearchSharedResultPanel sourceReference={{type:'research',id:selected.runId}} onOpenSource={id=>{const row=runs.find(item=>item.runId===id);if(row)void choose(row);}}/>}</></ScreenFrame>;
}

export function TasksScreen({ requestedTaskId, requestedSelectionKey, onClearRequestedSelection, aiState = 'idle', messages = [], logs = [], assistant }: { requestedTaskId?: string; requestedSelectionKey?:string; onClearRequestedSelection?: () => void; aiState?: AiState; messages?: ChatMessage[]; logs?: ToolExecutionLog[]; assistant?: AssistantProfile }) {
  return (
    <ScreenFrame title="Görevler" icon={<Clock3 className="h-5 w-5" />} subtitle="Kontrol noktaları, araçlar, onaylar ve sonuç durumlarıyla otonom görev zaman akışı" variant="wide">
      <TaskMissionWorkspace requestedSelectionKey={requestedSelectionKey} requestedTaskId={requestedTaskId} onClearRequestedSelection={onClearRequestedSelection} assistantName={assistant?.name} reportIdentity={assistant?.taskReportSignature} />
      <AdvancedExperienceWorkspace />
    </ScreenFrame>
  );
}

export function MemoryBrainScreen({ memories }: { memories: MemoryItem[] }) {
  return (
    <ScreenFrame title="Bellek" icon={<Brain className="h-5 w-5" />} subtitle="Anlamsal bellek, tercih belleği ve kullanım gerekçesi bağlamı" variant="wide">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[clamp(18rem,20vw,24rem)_minmax(0,1fr)]">
        <OSPanel title="Bellek Kümeleri" eyebrow="BEYİN" icon={<Network className="h-4 w-4" />}>
          {['User Memory', 'Conversation Memory', 'Project Memory', 'Task Memory', 'Preference Memory', 'Technical Memory', 'Trading Memory', 'Failure Memory'].map((label) => (
            <ActionRow key={label} label={label} value={label === 'User Memory' ? String(memories.length) : '0'} />
          ))}
        </OSPanel>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {memories.length > 0 ? memories.map((memory) => (
            <OSPanel key={memory.id} title={memory.key} eyebrow={memory.category.toUpperCase()} icon={<Brain className="h-4 w-4" />}>
              <p className="text-sm leading-relaxed text-slate-300">{memory.value}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill label="confidence" value={String(memory.confidence ?? 'unknown')} tone="muted" />
                <StatusPill label={memory.isSensitive ? 'sensitive' : 'internal'} tone={memory.isSensitive ? 'warning' : 'info'} />
              </div>
            </OSPanel>
          )) : <div className="lg:col-span-2"><EmptyState icon={<Brain className="h-4 w-4" />} title="Henüz kalıcı hafıza oluşturulmadı" text="Memory kayıtları oluştuğunda neden kullanıldığı ve ilişkili görevler burada gösterilecek." /></div>}
        </div>
      </div>
    </ScreenFrame>
  );
}

export function KnowledgeGraphScreen({
  memories = [],
  tools = [],
  logs = [],
}: {
  memories?: MemoryItem[];
  tools?: AutomationTool[];
  logs?: ToolExecutionLog[];
}) {
  type GraphNode = {
    id: string;
    title: string;
    type: string;
    source: string;
    path?: string;
    folder?: string;
    tags?: string[];
    importance?: number;
    recentActivityAt?: string;
    properties?: Record<string, unknown>;
  };
  type GraphEdge = { id: string; from: string; to: string; type: string; strength?: number; source?: string; evidence?: string; updatedAt?: string };
  type GraphStatus = {
    connectionStatus?: string;
    indexedNotes?: number;
    chunks?: number;
    watcherActive?: boolean;
    lastSyncAt?: string;
    settings?: { vaultPath?: string };
    recentEvents?: Array<{ id: string; action: string; path: string; status: string; createdAt: string }>;
  };
  type GraphDataStatus = {
    state?: 'ready' | 'degraded' | 'empty';
    reasons?: string[];
    obsidian?: 'connected' | 'configuration_required' | 'unavailable';
    syntheticNodes?: boolean | number;
  };

  const [graphNodes, setGraphNodes] = React.useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = React.useState<GraphEdge[]>([]);
  const [status, setStatus] = React.useState<GraphStatus | null>(null);
  const [activity, setActivity] = React.useState<{ auditEvents?: any[]; syncEvents?: any[]; toolRuns?: any[]; realtime?: string } | null>(null);
  const [dataStatus, setDataStatus] = React.useState<GraphDataStatus | null>(null);
  const [selectedId, setSelectedId] = React.useState('core:edith');
  const [filter, setFilter] = React.useState('All');
  const [mode, setMode] = React.useState<'Graph' | 'Timeline' | 'Clusters' | 'Insights'>('Graph');
  const [query, setQuery] = React.useState('');

  const requestJson = React.useCallback((path: string) => {
    return new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', path, true);
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`Knowledge API ${xhr.status}: ${path}`));
          return;
        }
        try {
          resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
        } catch (error) {
          reject(error);
        }
      };
      xhr.onerror = () => reject(new Error(`Knowledge API network error: ${path}`));
      xhr.send();
    });
  }, []);

  React.useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [graphJson, statusJson, activityJson, mapJson] = await Promise.all([
          requestJson('/api/knowledge/graph?limit=900'),
          requestJson('/api/knowledge/status'),
          requestJson('/api/knowledge-graph/activity'),
          requestJson('/api/edith/knowledge-map'),
        ]);
        if (!alive) return;
        setGraphNodes(graphJson.graph?.nodes ?? []);
        setGraphEdges(graphJson.graph?.relationships ?? []);
        setDataStatus(mapJson.map?.dataStatus ?? null);
        setStatus(statusJson.status ?? null);
        setActivity(activityJson.activity ?? null);
      } catch {
        if (!alive) return;
        setGraphNodes([]);
        setGraphEdges([]);
        setDataStatus({ state: 'degraded', reasons: ['knowledge_api_unavailable'], syntheticNodes: 0 });
      }
    };
    load();
    const interval = window.setInterval(load, 10000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [requestJson]);

  const domains = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graphNodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    const priority = ['Memory', 'Agent', 'Project', 'Task', 'Tool', 'Vault', 'Note', 'Conversation', 'Website', 'File', 'Model', 'SecurityEvent', 'Trade'];
    const items = priority
      .filter((type) => counts.has(type))
      .map((type) => ({ type, count: counts.get(type) ?? 0 }));
    for (const [type, count] of counts) if (!items.some((item) => item.type === type)) items.push({ type, count });
    return items.slice(0, 10);
  }, [graphNodes]);

  const displayNodes = React.useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    let sourceNodes = graphNodes;
    if (filter !== 'All') sourceNodes = sourceNodes.filter((node) => node.type === filter || node.id === selectedId);
    if (q) sourceNodes = sourceNodes.filter((node) => `${node.title} ${node.type} ${node.source} ${node.path ?? ''}`.toLocaleLowerCase('tr-TR').includes(q));
    const core = sourceNodes.find((node) => node.id === 'core:edith') ?? graphNodes.find((node) => node.id === 'core:edith');
    const selectedSet = new Map<string, GraphNode>();
    if (core) selectedSet.set(core.id, core);
    for (const item of domains) {
      const candidate = sourceNodes.find((node) => node.type === item.type && node.id !== core?.id);
      if (candidate) selectedSet.set(candidate.id, candidate);
    }
    for (const node of sourceNodes) {
      if (selectedSet.size >= 42) break;
      selectedSet.set(node.id, node);
    }
    return Array.from(selectedSet.values());
  }, [domains, filter, graphNodes, query, selectedId]);

  const displayIds = new Set(displayNodes.map((node) => node.id));
  const displayEdges = graphEdges.filter((edge) => displayIds.has(edge.from) && displayIds.has(edge.to)).slice(0, 90);
  const selected = displayNodes.find((node) => node.id === selectedId) ?? displayNodes[0] ?? graphNodes[0];
  const selectedRelations = selected ? graphEdges.filter((edge) => edge.from === selected.id || edge.to === selected.id).slice(0, 8) : [];
  const nodeTypes = ['All', ...Array.from(new Set(graphNodes.map((node) => node.type))).sort()];
  const statusOnline = dataStatus?.state === 'ready' && (status?.connectionStatus === 'synced' || status?.connectionStatus === 'connected');
  const typeColor: Record<string, string> = {
    Agent: '#22d3ee',
    Memory: '#a78bfa',
    Tool: '#38bdf8',
    Task: '#34d399',
    Project: '#06b6d4',
    Vault: '#8b5cf6',
    Note: '#60a5fa',
    Conversation: '#818cf8',
    Website: '#0ea5e9',
    File: '#5eead4',
    Model: '#e2e8f0',
    SecurityEvent: '#fb7185',
    Trade: '#f59e0b',
  };
  const iconFor = (type: string) => {
    if (type === 'Memory') return Brain;
    if (type === 'Agent') return Bot;
    if (type === 'Tool') return Wrench;
    if (type === 'Task') return CheckCircle2;
    if (type === 'Project') return Archive;
    if (type === 'Vault') return Database;
    if (type === 'Website') return Globe2;
    if (type === 'File') return FileText;
    if (type === 'SecurityEvent') return ShieldCheck;
    return Network;
  };
  const positionedNodes = displayNodes.map((node, index) => {
    if (node.id === 'core:edith') return { ...node, x: 50, y: 49, size: 126 };
    const featuredSlots = [
      [50, 14],
      [72, 24],
      [83, 42],
      [78, 63],
      [64, 77],
      [49, 82],
      [34, 77],
      [21, 63],
      [16, 44],
      [25, 27],
      [38, 19],
      [62, 17],
    ];
    if (index <= featuredSlots.length) {
      const [x, y] = featuredSlots[index - 1];
      return { ...node, x, y, size: 78 };
    }
    const angle = (Math.PI * 2 * (index - featuredSlots.length - 1)) / Math.max(1, displayNodes.length - featuredSlots.length - 1);
    const lane = index % 3;
    const radiusX = 34 + lane * 7;
    const radiusY = 22 + lane * 4;
    return {
      ...node,
      x: 50 + Math.cos(angle) * radiusX,
      y: 50 + Math.sin(angle) * radiusY,
      size: 28 + (index % 4) * 2,
    };
  });
  const starredNodes = graphNodes.slice(0, 72).map((node, index) => {
    let seed = index * 17;
    for (let i = 0; i < node.id.length; i += 1) seed += node.id.charCodeAt(i);
    return {
      id: node.id,
      x: 3 + ((seed * 37) % 9400) / 100,
      y: 5 + ((seed * 53) % 8800) / 100,
      size: 1.5 + (seed % 5) * 0.55,
      delay: (seed % 19) * 0.18,
      color: typeColor[node.type] ?? '#38bdf8',
    };
  });
  const flowingEdges = displayEdges
    .map((edge) => {
      const a = positionedNodes.find((node) => node.id === edge.from);
      const b = positionedNodes.find((node) => node.id === edge.to);
      return a && b ? { edge, a, b } : null;
    })
    .filter(Boolean)
    .slice(0, 32) as Array<{ edge: GraphEdge; a: typeof positionedNodes[number]; b: typeof positionedNodes[number] }>;

  return (
    <div className="-m-[var(--edith-workspace-gutter)] min-h-[calc(100vh-var(--edith-header-height)-1rem)] w-full flex-1 overflow-hidden bg-[#020713] p-3 text-slate-100">
      <style>{`
        @keyframes edith-flow-dash { to { stroke-dashoffset: -34; } }
        @keyframes edith-star-pulse { 0%, 100% { opacity: .24; transform: scale(.78); } 45% { opacity: .95; transform: scale(1.28); } }
        @keyframes edith-core-breathe { 0%, 100% { transform: translate(-50%, -50%) scale(.96); opacity: .72; } 50% { transform: translate(-50%, -50%) scale(1.08); opacity: 1; } }
        @keyframes edith-orbit-spin { to { transform: rotate(360deg); } }
      `}</style>
      <div className="grid min-h-[calc(100vh-var(--edith-header-height)-2rem)] grid-cols-1 grid-rows-[auto_minmax(34rem,1fr)_auto] gap-3 xl:h-[calc(100vh-var(--edith-header-height)-2rem)] xl:grid-cols-[minmax(0,1fr)_clamp(20rem,22vw,28rem)] xl:grid-rows-[auto_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_clamp(23rem,21vw,32rem)]">
        <header className="flex flex-col gap-3 rounded-2xl border border-cyan-300/20 bg-[#041421]/86 px-4 py-3 shadow-[0_0_38px_rgba(14,165,233,0.14)] sm:flex-row sm:items-center sm:justify-between xl:col-span-2 xl:px-5">
          <div>
            <h1 className="text-xl font-semibold text-cyan-50">KNOWLEDGE MAP</h1>
            <p className="text-xs text-slate-400">Persisted knowledge relationships from backend sources.</p>
            {dataStatus && (
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-400">
                <StatusPill label="DATA" value={(dataStatus.state ?? 'degraded').toUpperCase()} tone={dataStatus.state === 'ready' ? 'success' : 'warning'} />
                <StatusPill label="OBSIDIAN" value={(dataStatus.obsidian ?? 'configuration_required').toUpperCase()} tone={dataStatus.obsidian === 'connected' ? 'success' : 'warning'} />
                <StatusPill label="SYNTHETIC NODES" value={dataStatus.syntheticNodes === false || dataStatus.syntheticNodes === 0 ? 'NONE' : String(dataStatus.syntheticNodes ?? 'UNVERIFIED')} tone="muted" />
                {(dataStatus.reasons ?? []).slice(0, 3).map((reason) => <span key={reason} className="rounded border border-amber-300/15 bg-amber-400/5 px-2 py-1 text-amber-200/80">{reason.replaceAll('_', ' ')}</span>)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className={`flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-mono ${statusOnline ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200' : 'border-red-300/30 bg-red-400/10 text-red-200'}`}>
              <span className="h-2 w-2 rounded-full bg-current shadow-[0_0_12px_currentColor]" />
              {statusOnline ? 'SYSTEM ONLINE' : (status?.connectionStatus ?? 'DEGRADED').toUpperCase()}
            </div>
            <div className="relative min-w-[13rem] flex-1 sm:w-72 sm:flex-none">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search anything..." className="w-full rounded-xl border border-cyan-300/16 bg-black/30 py-2.5 pl-9 pr-3 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/45" />
            </div>
          </div>
        </header>

        <section className="relative min-h-[34rem] overflow-hidden rounded-2xl border border-cyan-300/20 bg-[#020713] shadow-[0_0_90px_rgba(14,165,233,0.22)] xl:min-h-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(34,211,238,0.36),transparent_17rem),radial-gradient(circle_at_50%_52%,rgba(37,99,235,0.24),transparent_28rem),radial-gradient(circle_at_40%_45%,rgba(124,58,237,0.22),transparent_20rem),linear-gradient(90deg,rgba(34,211,238,.055)_1px,transparent_1px),linear-gradient(rgba(34,211,238,.04)_1px,transparent_1px)] bg-[size:auto,auto,auto,48px_48px,48px_48px]" />
          <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_20%_18%,rgba(125,211,252,.26)_0_1px,transparent_2px),radial-gradient(circle_at_71%_22%,rgba(255,255,255,.38)_0_1px,transparent_2px),radial-gradient(circle_at_42%_77%,rgba(45,212,191,.28)_0_1px,transparent_2px),radial-gradient(circle_at_84%_69%,rgba(147,197,253,.28)_0_1px,transparent_2px)] [background-size:92px_80px,126px_118px,154px_130px,198px_176px]" />
          {starredNodes.map((node) => (
            <span
              key={node.id}
              className="pointer-events-none absolute rounded-full"
              style={{
                left: `${node.x}%`,
                top: `${node.y}%`,
                width: node.size,
                height: node.size,
                backgroundColor: node.color,
                boxShadow: `0 0 ${node.size * 5}px ${node.color}`,
                animation: `edith-star-pulse ${2.6 + node.size * 0.35}s ease-in-out ${node.delay}s infinite`,
              }}
            />
          ))}
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="edith-cockpit-edge" x1="0%" x2="100%">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity=".12" />
                <stop offset="50%" stopColor="#93c5fd" stopOpacity=".78" />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity=".2" />
              </linearGradient>
              <radialGradient id="edith-core-glow">
                <stop offset="0%" stopColor="#e0f2fe" stopOpacity=".95" />
                <stop offset="38%" stopColor="#22d3ee" stopOpacity=".56" />
                <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="18" fill="url(#edith-core-glow)" opacity=".82" />
            {[14, 22, 30, 39, 48].map((rx, index) => <ellipse key={rx} cx="50" cy="50" rx={rx} ry={rx * 0.56} fill="none" stroke="#38bdf8" strokeOpacity={index < 2 ? .34 : .22} strokeWidth={index < 2 ? .28 : .16} strokeDasharray={index % 2 ? '1.2 2.2' : '0'} />)}
            {flowingEdges.map(({ edge, a, b }, index) => {
              const active = selected && (edge.from === selected.id || edge.to === selected.id);
              const path = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
              return (
                <g key={edge.id}>
                  <path d={path} fill="none" stroke="url(#edith-cockpit-edge)" strokeWidth={active ? .5 : .18} strokeDasharray={active ? '0' : '1.4 2.4'} opacity={active ? .92 : .55} style={{ animation: active ? undefined : `edith-flow-dash ${3.4 + (index % 5) * .45}s linear infinite` }} />
                  <circle r={active ? .7 : .38} fill={active ? '#e0f2fe' : '#22d3ee'} opacity={active ? .95 : .66}>
                    <animateMotion dur={`${2.8 + (index % 7) * .45}s`} repeatCount="indefinite" path={path} />
                  </circle>
                </g>
              );
            })}
          </svg>
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[clamp(14rem,24vw,26rem)] w-[clamp(14rem,24vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/24 shadow-[0_0_80px_rgba(34,211,238,.55),inset_0_0_48px_rgba(34,211,238,.26)]" style={{ animation: 'edith-core-breathe 4.4s ease-in-out infinite' }} />
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[clamp(24rem,42vw,48rem)] w-[clamp(24rem,42vw,48rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/10" style={{ animation: 'edith-orbit-spin 34s linear infinite' }} />
          <div className="pointer-events-none absolute left-4 top-24 hidden font-mono text-[10px] uppercase leading-[1.7] tracking-[0.32em] text-cyan-200/70 md:block">Ideas<br />People<br />Data<br />Knowledge<br />Actions</div>
          <div className="pointer-events-none absolute right-5 top-24 hidden text-right font-mono text-[10px] uppercase leading-[1.7] tracking-[0.32em] text-cyan-200/70 md:block">Higher<br />Context<br />Greater<br />Possibilities</div>
          <div className="absolute inset-0 [perspective:900px]">
            {positionedNodes.map((node, index) => {
              const active = selected?.id === node.id;
              const Icon = iconFor(node.type);
              const color = typeColor[node.type] ?? '#38bdf8';
              const compact = index > 13;
              const core = node.id === 'core:edith';
              return (
                <button key={node.id} onClick={() => setSelectedId(node.id)} className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border text-center transition duration-300 ${active ? 'border-white/70 bg-white/12 shadow-[0_0_64px_rgba(34,211,238,.86)]' : 'border-cyan-200/24 bg-black/58 hover:border-cyan-300/60'} ${compact ? 'opacity-90 hover:scale-125' : ''}`} style={{ left: `${node.x}%`, top: `${node.y}%`, width: compact ? Math.max(14, node.size * .48) : node.size, height: compact ? Math.max(14, node.size * .48) : node.size, color, transform: 'translate(-50%, -50%)' }}>
                  <span className="absolute inset-0 rounded-full opacity-30 blur-xl" style={{ backgroundColor: color }} />
                  <span className="absolute inset-2 rounded-full border border-white/15 bg-slate-950/60" />
                  {!compact && !core && <Icon className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2" />}
                  {core && (
                    <span className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-black tracking-[0.28em] text-cyan-50">E.D.I.T.H.</span>
                      <span className="mt-1 text-[10px] text-cyan-100/70">Knowledge Core</span>
                    </span>
                  )}
                  {!compact && !core && <span className="absolute left-1/2 top-full mt-2 w-36 -translate-x-1/2 text-xs font-semibold text-slate-100 drop-shadow-[0_0_10px_rgba(2,6,23,.95)]">{node.title}</span>}
                  {!compact && !core && <span className="absolute left-1/2 top-[calc(100%+1.55rem)] w-32 -translate-x-1/2 text-[10px] text-slate-400">{node.type}</span>}
                </button>
              );
            })}
          </div>
          <div className="absolute left-4 right-4 top-4 flex overflow-x-auto rounded-xl border border-cyan-300/18 bg-black/42 p-1 backdrop-blur-xl sm:right-auto">
            {(['Graph', 'Timeline', 'Clusters', 'Insights'] as const).map((item) => (
              <button key={item} onClick={() => setMode(item)} className={`shrink-0 rounded-lg px-4 py-2 text-xs ${mode === item ? 'bg-cyan-300/16 text-cyan-50' : 'text-slate-500 hover:text-slate-200'}`}>{item}</button>
            ))}
          </div>
          <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-cyan-300/18 bg-black/52 px-4 py-3 text-center text-[11px] text-slate-300 backdrop-blur-xl sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:px-5">
            <span className="text-emerald-300">●</span> {domains.length} knowledge domains · {graphNodes.length} total nodes · {activity?.realtime ?? 'polling'} synchronization
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto rounded-2xl border border-cyan-300/20 bg-[#041421]/84 p-4 shadow-[0_0_38px_rgba(14,165,233,0.12)] custom-scrollbar">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[11px] font-semibold text-cyan-100">NODE DETAILS</div>
            <StatusPill label={statusOnline ? 'online' : 'degraded'} tone={statusOnline ? 'success' : 'warning'} />
          </div>
          {selected ? (
            <>
              <div className="rounded-xl border border-cyan-300/14 bg-black/24 p-4">
                <div className="text-lg font-semibold text-slate-100">{selected.title}</div>
                <div className="mt-1 text-xs text-slate-500">{selected.type} · {selected.source}</div>
                <p className="mt-4 text-xs leading-relaxed text-slate-400">{selected.path ?? selected.folder ?? 'Runtime knowledge entity'}</p>
                <div className="mt-4 grid grid-cols-4 rounded-xl border border-cyan-300/12 bg-black/22 text-center text-xs">
                  <div className="p-2"><b>{status?.indexedNotes ?? 0}</b><div className="text-[10px] text-slate-500">Notes</div></div>
                  <div className="p-2"><b>{status?.recentEvents?.length ?? 0}</b><div className="text-[10px] text-slate-500">Recent</div></div>
                  <div className="p-2"><b>{selectedRelations.length}</b><div className="text-[10px] text-slate-500">Linked</div></div>
                  <div className="p-2"><b>{selected.tags?.length ?? 0}</b><div className="text-[10px] text-slate-500">Tags</div></div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-emerald-300/16 bg-emerald-400/7 p-3">
                <div className="text-xs font-semibold text-emerald-100">Vault Connected</div>
                <div className="mt-2 text-[11px] text-slate-400">Vault Path <span className="float-right max-w-44 truncate text-slate-300">{status?.settings?.vaultPath || 'Yapılandırılmadı'}</span></div>
                <div className="mt-2 text-[11px] text-slate-400">Last Sync <span className="float-right text-slate-300">{status?.lastSyncAt ? 'synced' : 'waiting'}</span></div>
              </div>
              <div className="mt-4">
                <div className="mb-2 text-[11px] font-semibold text-cyan-100">CONNECTED NODES</div>
                <div className="space-y-2">
                  {selectedRelations.map((edge) => {
                    const otherId = edge.from === selected.id ? edge.to : edge.from;
                    const other = graphNodes.find((node) => node.id === otherId);
                    return (
                      <button key={edge.id} onClick={() => other && setSelectedId(other.id)} className="flex w-full items-center justify-between rounded-lg border border-cyan-300/12 bg-black/24 px-3 py-2 text-left text-xs hover:border-cyan-300/35">
                        <span className="truncate text-slate-300">{other?.title ?? otherId}</span>
                        <span className="text-cyan-300">{edge.type}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <EmptyState icon={<Network className="h-4 w-4" />} title="Graph data yok" text="Backend knowledge graph cevap verdiğinde node detayları burada görünür." />
          )}
        </aside>

      </div>
    </div>
  );
}

export function ToolsRegistryScreen({ tools, logs }: { tools: AutomationTool[]; logs: ToolExecutionLog[] }) {
  const [registry, setRegistry] = React.useState<{ skills: Array<{
    id: string; name: string; description: string; category: string; status: string; riskLevel: string;
    readiness: { level: string; ready: boolean; reason: string };
    capabilities: string[]; requiredPermissions: string[]; requiredConfig: string[]; limitations: string[];
    relatedEndpoints: string[]; relatedScreens: string[]; safetyNotes: string[]; examples: string[];
    lastChecked: string; sourceOfTruth: string[];
    details?: Record<string, string | number | boolean>;
  }>; checkedAt: string } | null>(null);
  const [registryError, setRegistryError] = React.useState('');
  const [registeredTools, setRegisteredTools] = React.useState<Array<{
    id: string; name: string; description: string; category: string; riskLevel: string;
    requiresApproval: boolean; enabled: boolean; enabledReason: string;
    limitations: string[];
  }> | null>(null);
  const [toolCounts, setToolCounts] = React.useState<{ total: number; enabled: number; blocked: number; approvalRequired: number } | null>(null);
  const [planningCapabilityCount, setPlanningCapabilityCount] = React.useState(0);
  const [toolAuthority, setToolAuthority] = React.useState('unverified');
  const [toolsError, setToolsError] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);
  const [registryState, setRegistryState] = React.useState<'loading' | 'loaded' | 'empty' | 'error'>('loading');
  const [toolsState, setToolsState] = React.useState<'loading' | 'loaded' | 'empty' | 'error'>('loading');

  const refreshRegistry = React.useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    setRegistryError('');
    setToolsError('');
    setRegistryState('loading');
    setToolsState('loading');
    const suffix = '?refresh=true';
    const timeoutSignal = AbortSignal.timeout(12_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const [skillsResult, toolsResult] = await Promise.allSettled([
      fetch(`/api/edith/skills${suffix}`, { signal: requestSignal, cache: 'no-store' }).then(async (response) => {
        if (!response.ok) throw new Error(`Registry HTTP ${response.status}`);
        return response.json();
      }),
      fetch(`/api/edith/tools${suffix}`, { signal: requestSignal, cache: 'no-store' }).then(async (response) => {
        if (!response.ok) throw new Error(`Tool registry HTTP ${response.status}`);
        return response.json();
      }),
    ]);
    if (signal?.aborted) return;
    if (skillsResult.status === 'fulfilled' && Array.isArray(skillsResult.value.skills)) {
      setRegistry(skillsResult.value);
      setRegistryState(skillsResult.value.skills.length ? 'loaded' : 'empty');
    } else {
      setRegistry(null);
      setRegistryState('error');
      setRegistryError(skillsResult.status === 'rejected' && skillsResult.reason instanceof Error ? skillsResult.reason.message : 'Registry response is invalid.');
    }
    if (toolsResult.status === 'fulfilled' && Array.isArray(toolsResult.value.tools) && Array.isArray(toolsResult.value.health) && typeof toolsResult.value.counts?.total === 'number') {
      const healthById = new Map(toolsResult.value.health.map((item: any) => [item.toolId, item]));
      const nextTools = toolsResult.value.tools.map((item: any) => {
        const health = healthById.get(item.id) as any;
        return {
          id: item.id,
          name: item.metadata?.name ?? item.id,
          description: item.metadata?.description ?? 'No backend description.',
          category: item.metadata?.category ?? 'uncategorized',
          riskLevel: health?.risk ?? 'READ',
          requiresApproval: health?.highRisk === true,
          enabled: health?.enabled === true,
          enabledReason: health?.message ?? 'Health state not reported.',
          limitations: [
            ...(Array.isArray(health?.missingPermissions) && health.missingPermissions.length ? [`Missing permissions: ${health.missingPermissions.join(', ')}`] : []),
            ...(Array.isArray(health?.dependencies) && health.dependencies.length ? [`Dependencies: ${health.dependencies.join(', ')}`] : []),
          ],
        };
      });
      setRegisteredTools(nextTools);
      setToolCounts(toolsResult.value.counts);
      setPlanningCapabilityCount(Array.isArray(toolsResult.value.planningCapabilities) ? toolsResult.value.planningCapabilities.length : 0);
      setToolAuthority(typeof toolsResult.value.authority === 'string' ? toolsResult.value.authority : 'unverified');
      setToolsState(nextTools.length ? 'loaded' : 'empty');
    } else {
      setRegisteredTools(null);
      setToolCounts(null);
      setPlanningCapabilityCount(0);
      setToolAuthority('unverified');
      setToolsState('error');
      setToolsError(toolsResult.status === 'rejected' && toolsResult.reason instanceof Error ? toolsResult.reason.message : 'Tool registry response is invalid.');
    }
    setRefreshing(false);
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void refreshRegistry(controller.signal);
    return () => controller.abort();
  }, [refreshRegistry]);

  return (
    <ScreenFrame title="Araçlar / MCP Kayıt Defteri" icon={<Wrench className="h-5 w-5" />} subtitle="Araç riski, izinler, durum, gecikme ve çalıştırma geçmişi" variant="wide">
      <div className="mb-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-100">Yetenekler</h2>
          <div className="flex items-center gap-2">
            {registry && <span className="text-[10px] text-slate-500">Kontrol: {new Date(registry.checkedAt).toLocaleString('tr-TR')}</span>}
            <button
              type="button"
              onClick={() => void refreshRegistry()}
              disabled={refreshing}
              title="Canlı durumları yenile"
              aria-label="Canlı durumları yenile"
              className="grid h-8 w-8 place-items-center rounded-md border border-cyan-400/20 bg-cyan-400/5 text-cyan-300 transition hover:bg-cyan-400/10 disabled:cursor-wait disabled:opacity-50"
            >
              <RotateCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        {registryError && <p role="alert" className="text-xs text-rose-300">Yetenek registry erişilemiyor: {registryError}</p>}
        {registryState === 'loading' && <p className="text-xs text-slate-400">Yetenek durumları yükleniyor...</p>}
        {registryState === 'empty' && <EmptyState icon={<Wrench className="h-4 w-4" />} title="Yetenek registry boş" text="Backend erişilebilir, ancak kayıtlı yetenek bildirmedi." />}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {registry?.skills.map((skill) => (
            <div key={skill.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-100">{skill.name}</h3>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase ${skill.status === 'ready' ? 'border-emerald-400/30 text-emerald-300' : skill.status === 'broken' || skill.status === 'disabled' ? 'border-rose-400/30 text-rose-300' : 'border-amber-400/30 text-amber-300'}`}>{skill.status.replace('_', ' ')}</span>
              </div>
              <p className="mt-2 text-xs text-slate-300">{skill.description}</p>
              <p className="mt-2 text-[11px] text-slate-400">{skill.readiness.reason}</p>
              <div className="mt-3 space-y-1.5 text-[10px] text-slate-500">
                <div>Risk: {skill.riskLevel} · İzin: {skill.requiredPermissions.join(', ') || 'yok'}</div>
                <div>Yetenekler: {skill.capabilities.join(', ') || 'operasyonel yetenek yok'}</div>
                <div>Kısıtlar: {skill.limitations.join(' ') || 'kayıtlı kısıt yok'}</div>
                {skill.requiredConfig.length > 0 && <div>Gereken: {skill.requiredConfig.join(', ')}</div>}
                {skill.relatedEndpoints.length > 0 && <div>Uçlar: {skill.relatedEndpoints.join(', ')}</div>}
                {skill.sourceOfTruth.length > 0 && <div>Kaynak: {skill.sourceOfTruth.join(', ')}</div>}
                {skill.safetyNotes.length > 0 && <div className="text-amber-300/70">Güvenlik: {skill.safetyNotes.join(' ')}</div>}
                {skill.details && Object.entries(skill.details).slice(0, 7).map(([key, value]) => <div key={key}>{key}: {String(value)}</div>)}
                {skill.examples.length > 0 && <div>Örnek: “{skill.examples[0]}”</div>}
                <div>Son kontrol: {new Date(skill.lastChecked).toLocaleString('tr-TR')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <h2 className="mb-3 text-sm font-semibold text-slate-100">Kayıtlı araçlar</h2>
      {toolCounts && (
        <div className="mb-3 flex flex-wrap gap-2">
          <StatusPill label="CANONICAL" value={String(toolCounts.total)} tone="info" />
          <StatusPill label="ENABLED" value={String(toolCounts.enabled)} tone="success" />
          <StatusPill label="BLOCKED" value={String(toolCounts.blocked)} tone={toolCounts.blocked ? 'warning' : 'muted'} />
          <StatusPill label="APPROVAL" value={String(toolCounts.approvalRequired)} tone="warning" />
          <StatusPill label="PLANNING ONLY" value={String(planningCapabilityCount)} tone="muted" />
          <StatusPill label="AUTHORITY" value={toolAuthority} tone={toolAuthority === 'edithToolRegistry' ? 'success' : 'warning'} />
        </div>
      )}
      {toolsError && <p role="alert" className="mb-3 text-xs text-rose-300">Araç registry erişilemiyor: {toolsError}</p>}
      {toolsState === 'loading' && <p className="mb-3 text-xs text-slate-400">Araç kayıtları yükleniyor...</p>}
      <WorkspaceGrid>
        {(registeredTools ?? []).map((tool) => (
          <OSPanel key={tool.id} title={tool.name} eyebrow={tool.category.replaceAll('_', ' ').toUpperCase()} icon={<Wrench className="h-4 w-4" />}>
            <p className="text-xs leading-relaxed text-slate-400">{tool.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <RiskBadge level={tool.riskLevel.toUpperCase() as 'READ' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'} />
              <StatusPill label={tool.enabled ? 'çalışabilir' : 'kapalı'} tone={tool.enabled ? 'success' : 'warning'} />
              {tool.requiresApproval && <StatusPill label="onay gerekli" tone="warning" />}
            </div>
            <div className="mt-3 text-[10px] text-slate-500">Canonical executable tool · {tool.id}</div>
            <div className="mt-1 text-[10px] text-slate-500">{tool.enabledReason}</div>
            {tool.limitations.length > 0 && <div className="mt-1 text-[10px] text-amber-300/70">{tool.limitations.join(' ')}</div>}
          </OSPanel>
        ))}
        {toolsState === 'empty' && <div className="xl:col-span-3"><EmptyState icon={<Wrench className="h-4 w-4" />} title="Tool registry boş" text="Backend erişilebilir, ancak kayıtlı araç bildirmedi." /></div>}
      </WorkspaceGrid>
      <div className="mt-4">
        <OSPanel title="Recent Tool Logs" eyebrow="AUDIT" icon={<Terminal className="h-4 w-4" />}>
          <ActionRow label="Frontend execution tools" value={String(tools.length)} />
          {logs.slice(0, 6).map((log) => <ActionRow key={log.id} label={`${log.assistantName ?? 'EDITH'} / ${log.toolName}`} value={log.status} />)}
          {logs.length === 0 && <EmptyState icon={<Terminal className="h-4 w-4" />} title="Henüz araç çağrısı yok" text="Tool çalıştırmaları audit özetleriyle burada listelenecek." />}
        </OSPanel>
      </div>
    </ScreenFrame>
  );
}

export function AutomationsMissionScreen({ tools = [], logs = [] }: { tools?: AutomationTool[]; logs?: ToolExecutionLog[] }) {
  const automationTools = tools.filter((tool) => tool.category === 'reminder' || tool.category === 'monitor');
  return (
    <ScreenFrame title="Otomasyonlar" icon={<Zap className="h-5 w-5" />} subtitle="Yinelenen, olay tabanlı ve tetikleyiciyle çalışan işler için görev zamanlama" variant="wide">
      <OSPanel title="Otomasyon Türleri" eyebrow="TETİKLEYİCİLER" icon={<Zap className="h-4 w-4" />}>
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <ActionRow label="Configured automation tools" value={String(automationTools.length)} />
          <ActionRow label="Automation audit events" value={String(logs.filter((log) => automationTools.some((tool) => tool.id === log.toolId)).length)} />
          <ActionRow label="Live scheduler" value="backend dependent" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {['time-based', 'recurring', 'event-based', 'file-change', 'email-triggered', 'price-triggered', 'news-triggered', 'system-triggered', 'webhook-triggered'].map((type) => (
            <div key={type} className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-300">{type}</div>
          ))}
        </div>
      </OSPanel>
    </ScreenFrame>
  );
}

function voiceActivityLevel(samples: ArrayLike<number>, divisor = 1): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const normalized = Number(samples[index] ?? 0) / divisor;
    sum += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 4.5);
}

type VoiceRoomPrimaryRoute = 'voice' | 'computer' | 'crypto' | 'settings';

export function VoiceScreen({
  onBack,
  onNavigate,
  assistantProfile,
}: {
  onBack?: () => void;
  onNavigate?: (route: VoiceRoomPrimaryRoute) => void;
  assistantProfile: AssistantProfile;
}) {
  const safety = useInteractionSafetySnapshot();
  const taskActivity = useSharedTaskActivity();
  const hudPresentationRef = React.useRef(taskActivity.presentTaskHud);
  hudPresentationRef.current = taskActivity.presentTaskHud;
  const hudBridgeIdentityRef = React.useRef<ReturnType<typeof createVoiceTaskHudBridge>>();
  const voiceHudBridge = React.useMemo(() => {
    const bridge = createVoiceTaskHudBridge({observer: taskActivity.observer,
      present: intent => hudPresentationRef.current(intent), isCurrent: () => hudBridgeIdentityRef.current === bridge});
    return bridge;
  }, [taskActivity.observer]);
  hudBridgeIdentityRef.current = voiceHudBridge;
  React.useEffect(() => () => voiceHudBridge.clear(), [voiceHudBridge]);
  const [roomState, setRoomState] = React.useState<VoiceRoomState>('idle');
  const [micSupported, setMicSupported] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [voiceCapabilities, setVoiceCapabilities] = React.useState(() => getVoiceRoomCapabilitySnapshot());
  const [partialTranscript, setPartialTranscript] = React.useState('');
  const [finalTranscript, setFinalTranscript] = React.useState('');
  const [jarvisReply, setJarvisReply] = React.useState(() => getVoiceRoomCapabilitySnapshot().statusMessage);
  const [cryptoVoiceIntent, setCryptoVoiceIntent] = React.useState<string>('none');
  const [cryptoVoiceBusy, setCryptoVoiceBusy] = React.useState(false);
  const [skillResult, setSkillResult] = React.useState<{ outcome: string; taskId?: string; verificationStatus?: string; reasonCode?: string } | null>(null);
  const [voiceError, setVoiceError] = React.useState<string | null>(null);
  const [voiceErrorCode, setVoiceErrorCode] = React.useState<string | null>(null);
  const [lastSocketUrl, setLastSocketUrl] = React.useState('');
  const [audioChunkCount, setAudioChunkCount] = React.useState(0);
  const [lastAudioMimeType, setLastAudioMimeType] = React.useState<string>('none');
  const [voiceLevel, setVoiceLevel] = React.useState(0);
  const socketRef = React.useRef<WebSocket | null>(null);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const captureContextRef = React.useRef<AudioContext | null>(null);
  const playbackContextRef = React.useRef<AudioContext | null>(null);
  const processorRef = React.useRef<ScriptProcessorNode | null>(null);
  const playbackSourcesRef = React.useRef<AudioBufferSourceNode[]>([]);
  const playbackTimeRef = React.useRef(0);
  const playbackEpochRef = React.useRef(0);
  const pendingPlaybackIdleRef = React.useRef(false);
  const mutedRef = React.useRef(false);
  const lastLevelUpdateRef = React.useRef(0);
  const localGateRef = React.useRef(new LocalVoiceSessionGate());
  const expiryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = React.useRef(true);
  const completedTranscriptsRef = React.useRef(new Set<string>());
  const cryptoRequestRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  React.useEffect(() => {
    mountedRef.current = true;
    const supported = Boolean(navigator.mediaDevices?.getUserMedia);
    setMicSupported(supported);
    setVoiceCapabilities((current) => getVoiceRoomCapabilitySnapshot({
      localSpeechRecognitionSupported: supported,
      liveConnectorBound: current.liveConnectorBound,
      geminiApiKeyConfigured: current.geminiApiKeyConfigured,
      ttsOutputConnected: current.ttsOutputConnected,
      bargeInEnabled: current.bargeInEnabled,
      runtimeStatus: current.runtimeStatus,
      statusMessage: current.statusMessage,
    }));

    if (!supported) {
      setRoomState('disconnected');
      setVoiceErrorCode('mic_permission_denied');
    }

    return () => {
      mountedRef.current = false;
      stopLiveSession('component_unmount');
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/voice/live/status')
      .then((response) => response.ok ? readJsonResponse(response) : undefined)
      .then((payload) => {
        if (!cancelled && payload?.success) {
          const snapshot = normalizeVoiceRoomStatusPayload(payload, micSupported);
          setVoiceCapabilities(snapshot);
          setJarvisReply(snapshot.statusMessage);
        } else if (!cancelled) {
          setVoiceCapabilities(getVoiceRoomCapabilitySnapshot({ runtimeStatus: 'offline', statusMessage: 'Voice backend unavailable. No local voice session is active.' }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVoiceCapabilities(getVoiceRoomCapabilitySnapshot({ localSpeechRecognitionSupported: micSupported }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [micSupported]);

  const displayState: VoiceRoomState = roomState === 'error' ? 'error' : muted ? 'muted' : roomState;
  const liveStatusLabel = voiceCapabilities.runtimeStatus === 'connected'
    ? 'Connected'
    : voiceCapabilities.runtimeStatus === 'connecting'
    ? 'Connecting'
    : voiceCapabilities.runtimeStatus === 'configuration_required'
    ? 'Configuration required'
    : voiceCapabilities.runtimeStatus === 'error'
    ? 'Error'
    : 'Offline';

  const publishVoiceLevel = React.useCallback((level: number) => {
    const now = performance.now();
    if (level === 0 || now - lastLevelUpdateRef.current >= 72) {
      lastLevelUpdateRef.current = now;
      setVoiceLevel(level);
    }
  }, []);

  const playPcmAudio = React.useCallback(async (base64Audio: string) => {
    if (!localGateRef.current.ready) return;
    const socketAtStart = socketRef.current;
    const playbackEpoch = playbackEpochRef.current;
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      setVoiceError('Audio playback is not supported in this runtime.');
      return;
    }

    const context = playbackContextRef.current ?? new AudioContextCtor({ sampleRate: VOICE_LIVE_OUTPUT_RATE });
    playbackContextRef.current = context;
    try {
    await context.resume();
    if (!mountedRef.current || socketRef.current !== socketAtStart || !localGateRef.current.ready || playbackEpoch !== playbackEpochRef.current) return;
    if (context.state !== 'running') throw new Error('Playback is not active.');

    const pcm = base64ToInt16Pcm(base64Audio);
    publishVoiceLevel(voiceActivityLevel(pcm, 0x8000));
    const buffer = context.createBuffer(1, pcm.length, VOICE_LIVE_OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i += 1) {
      channel[i] = pcm[i] / 0x8000;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.02, playbackTimeRef.current || context.currentTime);
    source.start(startAt);
    setRoomState('speaking');
    setVoiceCapabilities((current) => ({ ...current, ttsOutputConnected: true }));
    playbackTimeRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.push(source);
    source.onended = () => {
      if (!mountedRef.current || socketRef.current !== socketAtStart || !localGateRef.current.ready || playbackEpoch !== playbackEpochRef.current) return;
      const remaining = playbackSourcesRef.current.filter((candidate) => candidate !== source);
      playbackSourcesRef.current = remaining;
      if (remaining.length === 0) {
        publishVoiceLevel(0);
        if (pendingPlaybackIdleRef.current) {
          pendingPlaybackIdleRef.current = false;
          setRoomState('idle');
        }
      }
    };
    } catch {
      if (!mountedRef.current || socketRef.current !== socketAtStart || playbackEpoch !== playbackEpochRef.current) return;
      void context.close(); playbackContextRef.current = null;
      setRoomState('error'); setVoiceError('Voice audio playback is unavailable.'); setVoiceErrorCode('audio_format_error');
      setVoiceCapabilities((current) => ({ ...current, runtimeStatus: 'error', ttsOutputConnected: false }));
    }
  }, [publishVoiceLevel]);

  const stopPlayback = React.useCallback(() => {
    playbackEpochRef.current++;
    window.speechSynthesis?.cancel();
    playbackSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Source may already be stopped.
      }
    });
    playbackSourcesRef.current = [];
    playbackTimeRef.current = 0;
    pendingPlaybackIdleRef.current = false;
    void playbackContextRef.current?.close();
    playbackContextRef.current = null;
    if (mountedRef.current) setVoiceCapabilities((current) => ({ ...current, ttsOutputConnected: false }));
    publishVoiceLevel(0);
  }, [publishVoiceLevel]);

  const stopCapture = React.useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    void captureContextRef.current?.close();
    captureContextRef.current = null;
    publishVoiceLevel(0);
  }, [publishVoiceLevel]);

  const stopLiveSession = React.useCallback((reason = 'client_stop') => {
    voiceHudBridge.clear();
    localGateRef.current.stop();
    cryptoRequestRef.current?.abort(); cryptoRequestRef.current = null;
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    expiryTimerRef.current = readyTimerRef.current = null;
    stopCapture();
    stopPlayback();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'session:stop' }));
      socket.close(1000, reason);
    }
    if (mountedRef.current) {
      setVoiceCapabilities((current) => ({ ...current, runtimeStatus: 'offline', ttsOutputConnected: false, bargeInEnabled: false }));
      setRoomState('idle');
    }
  }, [stopCapture, stopPlayback, voiceHudBridge]);

  const startCapture = React.useCallback(async (socket: WebSocket, generation: number, serverGeneration: number) => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('Web Audio API is not supported in this runtime.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (!mountedRef.current || socketRef.current !== socket || !localGateRef.current.ownsReady(generation, serverGeneration) || socket.readyState !== WebSocket.OPEN) {
      stream.getTracks().forEach(track => track.stop());
      return false;
    }
    if (!stream.active || !stream.getAudioTracks().some(track => track.readyState === 'live')) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Microphone stream is not active.');
    }
    mediaStreamRef.current = stream;

    const context = new AudioContextCtor();
    captureContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      if (mutedRef.current || socketRef.current !== socket || !localGateRef.current.current(generation) || !localGateRef.current.ready || socket.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      publishVoiceLevel(voiceActivityLevel(input));
      const pcm = downsampleFloat32ToInt16Pcm(input, context.sampleRate);
      const audio = int16PcmToBase64(pcm);
      socket.send(JSON.stringify({ type: 'audio:chunk', audio, mimeType: VOICE_LIVE_INPUT_MIME }));
    };

    source.connect(processor);
    processor.connect(context.destination);
    await context.resume();
    if (!localGateRef.current.ownsReady(generation, serverGeneration) || socketRef.current !== socket) {
      stream.getTracks().forEach(track => track.stop());
      void context.close();
      return false;
    }
    if (context.state !== 'running' || !stream.active) throw new Error('Microphone audio context is not active.');
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
      if (localGateRef.current.current(generation) && socketRef.current === socket) stopLiveSession('microphone_ended');
    }, { once: true }));
    return localGateRef.current.activateMicrophone(generation, stream.active && context.state === 'running');
  }, [publishVoiceLevel, stopLiveSession]);

  const interruptLiveSession = () => {
    voiceHudBridge.clear();
    stopPlayback();
    localGateRef.current.pauseMicrophone();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    stopCapture();
    setVoiceCapabilities((current) => ({ ...current, runtimeStatus: 'connecting', ttsOutputConnected: false, bargeInEnabled: false }));
    setRoomState('connecting');
  };

  const runCryptoVoiceCommand = React.useCallback(async (transcript: string, generation: number, socket: WebSocket) => {
    const current = () => mountedRef.current && localGateRef.current.current(generation) && socketRef.current === socket;
    if (!current()) return;
    if (!/(?:binance|kripto|crypto|coin|bitcoin|btc|ethereum|ether|eth|bnb|xrp|ripple|solana|tron|trx|zcash|zec|hyperliquid|hype|dogecoin|doge|cardano|ada|usdt|jev|portföy|portfoy|emir|bakiye)/i.test(transcript)) return;
    setCryptoVoiceBusy(true);
    setVoiceError(null);
    stopPlayback();
    const requestController = new AbortController();
    cryptoRequestRef.current?.abort(); cryptoRequestRef.current = requestController;
    try {
      const response = await ownerMutationFetch('/api/voice/crypto/command', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript }), signal: requestController.signal,
      });
      const payload = await readJsonResponse(response);
      if (!current()) return;
      if (!response.ok || payload.success !== true) throw new Error(payload.safeMessage || 'Crypto voice command failed.');
      if (payload.matched !== true) return;
      const reply = String(payload.reply || 'Crypto komutu tamamlandı.');
      setCryptoVoiceIntent(String(payload.intent || 'crypto'));
      setJarvisReply(reply);
      setRoomState('thinking');
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(reply);
        utterance.lang = 'tr-TR';
        utterance.rate = 0.96;
        utterance.onstart = () => { if (current()) setRoomState('speaking'); };
        utterance.onend = () => { if (current()) setRoomState(localGateRef.current.ready ? 'listening' : 'idle'); };
        window.speechSynthesis.speak(utterance);
      } else {
        setRoomState(socketRef.current?.readyState === WebSocket.OPEN ? 'listening' : 'idle');
      }
      if (payload.intent === 'show_proposal') onNavigate?.('crypto');
    } catch (error: any) {
      if (!current()) return;
      setVoiceError('Crypto voice command could not be completed.');
      setVoiceErrorCode('voice_crypto_failed');
      setRoomState('error');
    } finally {
      if (cryptoRequestRef.current === requestController) cryptoRequestRef.current = null;
      if (current()) setCryptoVoiceBusy(false);
    }
  }, [onNavigate, stopPlayback]);

  const handleServerEvent = React.useCallback((raw: MessageEvent<string>, socket: WebSocket, generation: number) => {
    if (!mountedRef.current || socketRef.current !== socket || !localGateRef.current.current(generation)) return;
    const event = parseVoiceLiveServerEvent(String(raw.data));
    if (!event) return;
    if (localGateRef.current.staleServerEvent(event.generation)) return;
    if (event.type === 'session:ready') {
      if (event.personaId !== assistantProfile.id || !localGateRef.current.acceptReady(generation, event.sessionId, event.generation ?? -1)) return;
      voiceHudBridge.bindReady(event.sessionId, event.generation!, () => mountedRef.current && socketRef.current === socket
        && localGateRef.current.ownsReady(generation, event.generation!));
      stopCapture(); stopPlayback();
      void startCapture(socket, generation, event.generation!).then((active) => {
        if (!active || socketRef.current !== socket || !localGateRef.current.ownsReady(generation, event.generation!)) return;
        if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
        setVoiceCapabilities((current) => ({ ...current, runtimeStatus: 'connected', liveConnectorBound: true, ttsOutputConnected: false, bargeInEnabled: true }));
        setRoomState('listening');
      }).catch((error: any) => {
        if (!localGateRef.current.ownsReady(generation, event.generation!) || socketRef.current !== socket) return;
        stopLiveSession('microphone_failed');
        setVoiceCapabilities((current) => ({ ...current, runtimeStatus: 'error' })); setRoomState('error');
        setVoiceError(error?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Could not start active microphone capture.');
        setVoiceErrorCode(error?.name === 'NotAllowedError' ? 'mic_permission_denied' : 'session_error');
      });
      return;
    }
    if (event.type === 'session:ended' || event.type === 'error' || event.type === 'status' && ['error', 'disconnected'].includes(event.state)) {
      stopLiveSession('backend_ended');
      if (event.type === 'error') {
        setVoiceCapabilities((current) => ({ ...current, runtimeStatus: event.errorCode === 'configuration_required' ? 'configuration_required' : 'error' }));
        setRoomState('error'); setVoiceError(event.safeMessage); setVoiceErrorCode(event.errorCode);
      }
      return;
    }
    if (event.type === 'skill:task_admitted' || event.type === 'hud:presentation') {
      if (localGateRef.current.ownsReady(generation, event.generation!)) voiceHudBridge.receive(event);
      return;
    }
    if (!localGateRef.current.acceptsEvent(generation, event.generation)) return;
    if (event.type === 'status') {
      const hasQueuedPlayback = playbackSourcesRef.current.length > 0;
      pendingPlaybackIdleRef.current = event.state === 'idle' && hasQueuedPlayback;
      setRoomState(event.state === 'speaking' && !hasQueuedPlayback ? 'thinking' : voiceRoomStateAfterServerStatus(event.state, hasQueuedPlayback));
      setVoiceCapabilities((current) => ({ ...current, runtimeStatus: voiceRoomRuntimeStatusAfterServerState(event.state, current.runtimeStatus, localGateRef.current.ready) }));
      return;
    }
    if (event.type === 'transcript:user') {
      if (event.partial) setPartialTranscript(event.text);
      else {
        setFinalTranscript((current) => (current + ' ' + event.text).trim()); setPartialTranscript('');
        const key = String(event.generation) + ':' + event.utteranceId;
        if (!event.utteranceId) return;
        if (!completedTranscriptsRef.current.has(key)) {
          completedTranscriptsRef.current.add(key);
          void runCryptoVoiceCommand(event.text, generation, socket);
        }
      }
      setRoomState('thinking'); return;
    }
    if (event.type === 'transcript:assistant') { setJarvisReply(event.text); return; }
    if (event.type === 'skill:result') {
      setSkillResult({ outcome: event.outcome, taskId: event.taskId, verificationStatus: event.verificationStatus, reasonCode: event.reasonCode });
      return;
    }
    if (event.type === 'audio:chunk') {
      setAudioChunkCount((count) => count + 1); setLastAudioMimeType(event.mimeType); void playPcmAudio(event.audio);
    }
  }, [assistantProfile.id, playPcmAudio, runCryptoVoiceCommand, startCapture, stopCapture, stopPlayback, stopLiveSession, voiceHudBridge]);

  const startListening = async () => {
    if (muted || !micSupported) {
      setVoiceError(muted ? 'Microphone is muted.' : 'Microphone capture is unavailable in this runtime.');
      setVoiceErrorCode('mic_permission_denied'); return;
    }
    stopLiveSession('restart');
    const generation = localGateRef.current.begin();
    completedTranscriptsRef.current.clear();
    setVoiceError(null); setVoiceErrorCode(null); setPartialTranscript('');
    setVoiceCapabilities((current) => ({ ...current, runtimeStatus: 'connecting' })); setRoomState('connecting');
    try {
      clearOwnerSessionMemory();
      const owner = await primeOwnerSession();
      if (!mountedRef.current || !localGateRef.current.current(generation)) return;
      const expiresAt = Date.parse(owner?.expiresAt ?? '');
      if (!owner || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('owner_session_required');
      const socketUrl = voiceLiveSocketUrl(); setLastSocketUrl(socketUrl);
      const socket = new WebSocket(socketUrl, voiceSocketProtocols(owner.csrfToken));
      socketRef.current = socket;
      const current = () => mountedRef.current && localGateRef.current.current(generation) && socketRef.current === socket;
      const failed = (code: string, message: string) => {
        if (!current()) return;
        stopLiveSession('connection_failed'); setRoomState('error'); setVoiceErrorCode(code); setVoiceError(message);
        setVoiceCapabilities((value) => ({ ...value, runtimeStatus: 'error' }));
      };
      let opened = false;
      expiryTimerRef.current = setTimeout(() => { if (current()) stopLiveSession('owner_session_expired'); }, Math.max(0, expiresAt - Date.now()));
      readyTimerRef.current = setTimeout(() => failed('session_error', 'No active microphone and ready voice session within timeout.'), 20000);
      socket.onopen = () => { if (!current()) return; opened = true; socket.send(JSON.stringify({ type: 'session:start', personaId: assistantProfile.id })); };
      socket.onmessage = (event) => handleServerEvent(event, socket, generation);
      socket.onerror = () => { const result = classifyVoiceSocketFailure({ socketUrl, opened }); failed(result.code, result.safeMessage); };
      socket.onclose = (event) => {
        if (!current()) return;
        const result = classifyVoiceSocketFailure({ socketUrl, opened, closeCode: event.code });
        failed(event.code === 4003 ? 'owner_session_expired' : result.code, event.code === 4003 ? 'Owner voice authority ended.' : result.safeMessage);
      };
    } catch {
      if (!mountedRef.current || !localGateRef.current.current(generation)) return;
      stopLiveSession('owner_session_required'); setRoomState('error'); setVoiceErrorCode('owner_session_required');
      setVoiceError('A current same-origin owner session is required for voice.');
      setVoiceCapabilities((current) => ({ ...current, runtimeStatus: 'error' }));
    }
  };

  React.useEffect(() => {
    stopLiveSession('persona_changed');
    setJarvisReply('No local voice session is active for ' + assistantProfile.name + '.');
    const logout = () => { clearOwnerSessionMemory(); stopLiveSession('owner_logout'); };
    window.addEventListener('edith-owner-logout', logout);
    return () => { window.removeEventListener('edith-owner-logout', logout); stopLiveSession('persona_or_component_changed'); };
  }, [assistantProfile.id, stopLiveSession]);

  const stopListening = () => {
    stopLiveSession('button_stop');
  };

  const resetSession = () => {
    stopLiveSession('reset');
    setPartialTranscript('');
    setFinalTranscript('');
    setJarvisReply(voiceCapabilities.statusMessage);
    setAudioChunkCount(0);
    setLastAudioMimeType('none');
    setVoiceError(null);
    setVoiceErrorCode(null);
    setCryptoVoiceIntent('none');
    setCryptoVoiceBusy(false);
    setSkillResult(null);
  };

  const sessionActive = voiceCapabilities.runtimeStatus === 'connecting' || voiceCapabilities.runtimeStatus === 'connected';
  const meterStrength = Math.max(displayState === 'listening' ? 2 : 0, Math.round(voiceLevel * 24));
  const capturedTranscript = partialTranscript || finalTranscript;
  const primaryControlLabel = sessionActive ? 'End voice session' : 'Start voice session';

  return (
    <div className="edith-voice-room custom-scrollbar" data-state={displayState}>
      <div className="edith-voice-grid" />
      <div className="edith-voice-horizon" />
      <header className="edith-voice-header">
        <div className="edith-voice-brand">
          <div className="edith-voice-brand-mark" aria-hidden="true"><CircleDot className="h-4 w-4" /></div>
          <div>
            <strong>E.D.I.T.H.</strong>
            <span>Personal AI System</span>
          </div>
        </div>
        <nav className="edith-voice-nav" aria-label="Primary workspace navigation">
          <button type="button" className="active" onClick={() => onNavigate?.('voice')}><Mic2 className="h-4 w-4" />Voice Room</button>
          <button type="button" onClick={() => onNavigate?.('computer')}><Cpu className="h-4 w-4" />Computer Use</button>
          <button type="button" onClick={() => onNavigate?.('crypto')}><TrendingUp className="h-4 w-4" />Crypto</button>
          <button type="button" onClick={() => onNavigate?.('settings')} title="Settings" aria-label="Settings"><SlidersHorizontal className="h-4 w-4" /><span>Settings</span></button>
        </nav>
        <div className="edith-voice-header-status">
          <div className="edith-voice-live-badge" data-online={voiceCapabilities.runtimeStatus === 'connected'}>
            <span />{liveStatusLabel}
          </div>
          {onBack && (
            <button type="button" onClick={onBack} className="edith-voice-back" title="Return to command center" aria-label="Return to command center">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div className="edith-voice-chamber">
        <aside className="edith-voice-left-rail" aria-label="Voice state">
          <div className="edith-voice-channel-copy">
            <span>VOICE CHANNEL</span>
            <strong>{voiceRoomStateLabel[displayState]}</strong>
            <p>{voiceCapabilities.statusMessage}</p>
          </div>

          <div className="edith-voice-state-list">
            <div className="edith-voice-state-item" data-active={displayState === 'listening'}>
              <div className="edith-voice-state-icon"><Mic2 className="h-4 w-4" /></div>
              <div><strong>Listening</strong><span>{localGateRef.current.ready && displayState === 'listening' ? 'Microphone stream active' : 'Microphone inactive'}</span></div>
            </div>
            <div className="edith-voice-state-item" data-active={displayState === 'thinking'}>
              <div className="edith-voice-state-icon"><Brain className="h-4 w-4" /></div>
              <div><strong>Thinking</strong><span>{displayState === 'thinking' ? 'Processing this turn' : localGateRef.current.ready ? 'Voice session ready' : liveStatusLabel}</span></div>
            </div>
            <div className="edith-voice-state-item" data-active={displayState === 'speaking'}>
              <div className="edith-voice-state-icon"><Volume2 className="h-4 w-4" /></div>
              <div><strong>Speaking</strong><span>{displayState === 'speaking' ? 'Audio response playing' : 'Output channel quiet'}</span></div>
            </div>
          </div>

          <div className="edith-voice-settings-panel">
            <div className="edith-voice-panel-heading"><span>Voice channel</span><Activity className="h-4 w-4" /></div>
            <dl>
              <div><dt>Mode</dt><dd>{safety?.voice?.mode ?? 'DISABLED'}</dd></div>
              <div><dt>Input</dt><dd>PCM 16 kHz</dd></div>
              <div><dt>Output</dt><dd>PCM 24 kHz</dd></div>
              <div><dt>Wake word</dt><dd>{safety?.voice?.wakeWord ?? 'BLOCKED'}</dd></div>
            </dl>
          </div>
        </aside>

        <main className="edith-voice-center">
          <section className="edith-voice-stage" aria-label={`${assistantProfile.name} core: ${voiceRoomStateLabel[displayState]}`}>
            <div
              className="edith-voice-core-wrap"
              data-state={displayState}
              style={{ '--voice-level': voiceLevel.toFixed(3) } as React.CSSProperties}
            >
              <div className="edith-voice-core-axis" />
              <div className="edith-voice-orbit edith-voice-orbit-one" />
              <div className="edith-voice-orbit edith-voice-orbit-two" />
              <div className="edith-voice-orbit edith-voice-orbit-three" />
              <div className="edith-voice-orbit edith-voice-orbit-four" />
              <div className="edith-voice-wave edith-voice-wave-one" />
              <div className="edith-voice-wave edith-voice-wave-two" />
              <div className="edith-voice-core-signal" aria-hidden="true">
                {Array.from({ length: 40 }).map((_, index) => <span key={index} style={{ '--signal-index': index } as React.CSSProperties} />)}
              </div>
              <div className="edith-voice-core">
                <div className="edith-voice-core-shell" />
                <div className="edith-voice-core-inner">
                  <span>E.D.I.T.H.</span>
                  <strong>{assistantProfile.name}</strong>
                  <small>{voiceRoomStateLabel[displayState]}</small>
                </div>
              </div>
              <div className="edith-voice-particle edith-voice-particle-a" />
              <div className="edith-voice-particle edith-voice-particle-b" />
              <div className="edith-voice-particle edith-voice-particle-c" />
            </div>
          </section>

          <footer className="edith-voice-controls">
            <div className="edith-voice-control-row">
              <div className="edith-voice-meter edith-voice-meter-left" aria-hidden="true">
                {Array.from({ length: 12 }).map((_, index) => <span key={index} className={index < Math.ceil(meterStrength / 2) ? 'edith-voice-meter-active' : ''} style={{ '--meter-index': index } as React.CSSProperties} />)}
              </div>
              <div className="edith-voice-mic-cluster">
                <button
                  type="button"
                  onClick={sessionActive ? stopListening : startListening}
                  className={cx('edith-voice-mic-button', sessionActive && 'active')}
                  title={micSupported ? primaryControlLabel : 'Microphone capture is unavailable in this runtime'}
                  aria-label={primaryControlLabel}
                >
                  {sessionActive ? <Square className="h-7 w-7" /> : <Mic2 className="h-8 w-8" />}
                </button>
                <strong>{primaryControlLabel}</strong>
                <span>{muted ? 'Microphone muted' : voiceRoomStateLabel[displayState]}</span>
              </div>
              <div className="edith-voice-meter" aria-label="Live audio activity">
                {Array.from({ length: 12 }).map((_, index) => <span key={index} className={index < Math.ceil(meterStrength / 2) ? 'edith-voice-meter-active' : ''} style={{ '--meter-index': index } as React.CSSProperties} />)}
              </div>
            </div>

            <div className="edith-voice-secondary-controls">
              <button type="button" onClick={() => setMuted((current) => !current)} className="edith-voice-icon-button" title={muted ? 'Unmute microphone' : 'Mute microphone'} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
                {muted ? <MicOff className="h-4 w-4" /> : <Mic2 className="h-4 w-4" />}
              </button>
              <button type="button" onClick={interruptLiveSession} disabled={!sessionActive} className="edith-voice-icon-button" title="Interrupt current response" aria-label="Interrupt current response">
                {displayState === 'speaking' ? <Square className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
              <button type="button" onClick={resetSession} className="edith-voice-icon-button" title="Reset voice session" aria-label="Reset voice session">
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </footer>
        </main>

        <aside className="edith-voice-right-rail">
          <section className="edith-voice-conversation">
            <header>
              <div><MessageSquareText className="h-4 w-4" /><h2>Conversation</h2></div>
              <span className="edith-voice-conversation-live" data-online={voiceCapabilities.runtimeStatus === 'connected'}><i />{voiceCapabilities.runtimeStatus === 'connected' ? 'Live' : 'Offline'}</span>
            </header>
            <div className="edith-voice-transcript custom-scrollbar" aria-live="polite">
              <article className="edith-voice-message edith-voice-message-user">
                <div><span>You</span>{partialTranscript && <em>Listening</em>}</div>
                <p>{capturedTranscript || 'No speech has been captured in this session.'}</p>
              </article>
              <article className="edith-voice-message edith-voice-message-assistant">
                <div><span>{assistantProfile.name}</span><em>{voiceRoomStateLabel[displayState]}</em></div>
                <p>{jarvisReply}</p>
              </article>
              {voiceError && (
                <div className="edith-voice-error" role="status">
                  <AlertTriangle className="h-4 w-4" />
                  <span>{voiceErrorCode ? `${voiceErrorCode}: ` : ''}{voiceError}</span>
                </div>
              )}
            </div>
            <footer>
              <span>{cryptoVoiceBusy ? 'Crypto skill executing' : partialTranscript ? 'Receiving partial transcript' : sessionActive ? 'Voice session active' : 'Start a session to speak'}</span>
              <Activity className="h-4 w-4" />
            </footer>
          </section>

          <section className="edith-voice-session-panel">
            <div className="edith-voice-panel-heading"><span>Session</span><ShieldCheck className="h-4 w-4" /></div>
            <dl>
              <div><dt>State</dt><dd>{voiceRoomStateLabel[displayState]}</dd></div>
              <div><dt>Model</dt><dd>{EDITH_VOICE_ROOM_MODEL}</dd></div>
              <div title={lastSocketUrl || undefined}><dt>WebSocket</dt><dd>{localGateRef.current.ready ? 'Connected' : voiceCapabilities.runtimeStatus === 'connecting' ? 'Connecting' : lastSocketUrl ? 'Previous attempt ended' : 'Not started'}</dd></div>
              <div><dt>Audio</dt><dd>{audioChunkCount > 0 ? `${audioChunkCount} chunks` : 'Waiting'}</dd></div>
              <div><dt>Crypto router</dt><dd>{cryptoVoiceBusy ? 'Executing' : cryptoVoiceIntent}</dd></div>
              <div><dt>Skill router</dt><dd>{skillResult?.outcome ?? 'Not started'}</dd></div>
              <div><dt>API key</dt><dd>{voiceCapabilities.frontendCanReadApiKey ? 'Unsafe exposure' : 'Backend protected'}</dd></div>
            </dl>
            <p>Crypto voice: bağlantı · top 10 · fiyat · yükselen/düşen · karşılaştırma · bakiye · açık emir · portföy · geçmiş · Jev analiz/döngü · emir taslağı · taslak göster/ret · kill switch.</p>
            <p>Crypto yalnız demo ledger ile çalışır; gerçek emir gönderilemez. Demo onayı gereken işlemler Crypto ekranındaki onay akışını kullanır.</p>
            {skillResult && <p role="status">{skillResult.taskId ? `Task ${skillResult.taskId} · Verification ${skillResult.verificationStatus ?? 'unavailable'}` : skillResult.reasonCode === 'VOICE_SKILL_MAPPING_REQUIRED' ? 'Bu komut için hazır ve doğrulanmış bir skill eşlemesi yok.' : 'Skill yürütülmedi veya doğrulanamadı.'}</p>}
            {lastAudioMimeType !== 'none' && <p>{lastAudioMimeType}</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

export function SecurityCenterScreen({ tools = [], integrations = [] }: { tools?: AutomationTool[]; integrations?: IntegrationConfig[] }) {
  const safety = useInteractionSafetySnapshot();
  const highRiskTools = tools.filter((tool) => tool.requiresConfirmation);
  const connectedIntegrations = integrations.filter((integration) => integration.status === 'connected' && integration.enabled);
  return (
    <ScreenFrame title="Güvenlik Merkezi" icon={<LockKeyhole className="h-5 w-5" />} subtitle="Onaylar, yüksek riskli araçlar, oturumlar, kilitler ve acil kontrol" variant="cockpit">
      <CockpitGrid>
        <OSPanel title="Approval UX" eyebrow="RISK REVIEW" icon={<ShieldAlert className="h-4 w-4" />}>
          <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-4">
            <div className="text-sm font-semibold text-amber-100">Efendim, bu işlem için onayınız gerekiyor.</div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <ActionRow label="Agent" value="Computer Agent" />
              <ActionRow label="Tool" value="computer_control_agent" />
              <ActionRow label="Target" value="No active request" />
              <ActionRow label="Risk" value={`${highRiskTools.length} gated tools`} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {['Approve once', 'Approve for session', 'Deny', 'Always ask'].map((action) => <button key={action} type="button" disabled className="rounded-md border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-200 disabled:opacity-40">{action}</button>)}
            </div>
          </div>
        </OSPanel>
        <OSPanel title="Locks" eyebrow="GUARDRAILS" icon={<KeyRound className="h-4 w-4" />}>
          <ActionRow label="Computer-use lock" value={safety?.computer?.mode ?? 'READ ONLY'} />
          <ActionRow label="Trading lock" value="UI ONLY" />
          <ActionRow label="High-risk tools" value="approval required" />
          <ActionRow label="Connected integrations" value={String(connectedIntegrations.length)} />
        </OSPanel>
      </CockpitGrid>
    </ScreenFrame>
  );
}

type CryptoServiceStatus = {
  dashboardUrl?: string;
  projectPath?: string;
  healthy?: boolean;
  managedProcessRunning?: boolean;
  autoStartEnabled?: boolean;
  startedAt?: string;
  error?: string;
  overview?: Record<string, any>;
  health?: Record<string, any>;
  obsidian?: Record<string, any>;
  portfolio?: Record<string, any>;
  models?: Record<string, any>;
  demoLoop?: Record<string, any>;
  runtime?: {
    state?: string;
    observerRunning?: boolean;
    runtimeMode?: string;
    ollamaAvailable?: boolean;
    marketDataAvailable?: boolean | null;
    obsidianAvailable?: boolean;
    lastStartedAt?: string;
    lastStoppedAt?: string;
    lastObservationAt?: string;
    currentSymbol?: string | null;
    watchedSymbols?: string[];
    tradingEnabled?: boolean;
    paperTradingEnabled?: boolean;
    liveTradingEnabled?: boolean;
    safetyStatus?: {
      status?: string;
      message?: string;
    };
  };
};

type CryptoSymbolPermission = {
  symbol: string;
  category: string;
  watch: boolean;
  decision: boolean;
  paper: boolean;
  live: boolean;
  risk: 'Low' | 'Medium' | 'High' | 'Critical';
  approvalRequired?: boolean;
};

type MarketObservation = {
  title: string;
  detail: string;
  signal?: string;
  source?: string;
  timestamp?: string;
};

type LearningNote = {
  title: string;
  detail?: string;
  path?: string;
  timestamp?: string;
};

const SAFE_SYMBOL_PERMISSIONS: CryptoSymbolPermission[] = [
  { symbol: 'BTC/USDT', category: 'Majors', watch: true, decision: true, paper: false, live: false, risk: 'Medium' },
  { symbol: 'ETH/USDT', category: 'Majors', watch: true, decision: true, paper: false, live: false, risk: 'Medium' },
  { symbol: 'DOGE/USDT', category: 'Meme', watch: true, decision: false, paper: false, live: false, risk: 'High', approvalRequired: true },
  { symbol: 'USDC/USDT', category: 'Stablecoins', watch: true, decision: false, paper: false, live: false, risk: 'Low' },
];

const SAFE_CATEGORY_RULES = [
  ['Majors', 'İzleme açık', 'Demo analiz açık', 'Canlı kilitli'],
  ['Meme', 'İzleme açık', 'Karar kapalı', 'Demo işlem kapalı, onay gerekir'],
  ['Stablecoins', 'Sadece izleme', 'İşlem kapalı', 'Canlı kilitli'],
] as const;

const SAFE_OBSERVATIONS: MarketObservation[] = [
  { title: 'Piyasa radarı beklemede', detail: 'Observer servisi kapalı; canlı piyasa gözlemi gösterilmiyor.', signal: 'BEKLEME', source: 'safe-ui' },
  { title: 'Emir katmanı kilitli', detail: 'Bu kokpitte gerçek emir aksiyonu yok. Canlı trading kapalıdır.', signal: 'GÜVENLİK', source: 'safe-ui' },
  { title: 'Demo trade bekleniyor', detail: 'Ders kaydı sadece simüle demo işlem açılıp/kapanınca oluşur.', signal: 'BEKLİYOR', source: 'safe-ui' },
];

const SAFE_LEARNING_NOTES: LearningNote[] = [
  { title: 'Henüz demo işlem dersi yok', detail: 'E.D.I.T.H. ayrı öğrenme yapmaz; sadece demo trade geçmişinden ders çıkarır.' },
];

async function optionalCryptoEndpoint(path: string): Promise<Record<string, any> | undefined> {
  try {
    const response = await fetch(path);
    if (!response.ok) return undefined;
    return await readJsonResponse(response);
  } catch {
    return undefined;
  }
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function money(value: unknown, fallback = 'bağlı değil'): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`;
}

function pct(value: unknown, fallback = 'bağlı değil'): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return `${value.toFixed(2)}%`;
}

function cryptoRisk(value: unknown): CryptoSymbolPermission['risk'] {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('critical')) return 'Critical';
  if (normalized.includes('high') || normalized === '4' || normalized === '5') return 'High';
  if (normalized.includes('low') || normalized === '1') return 'Low';
  return 'Medium';
}

function displayTime(value: unknown): string {
  if (!value) return 'not reported';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

type ObserverState = 'STOPPED' | 'STARTING' | 'OBSERVING' | 'PAUSED' | 'STOPPING' | 'ERROR';

function observerStateFromRuntime(runtime: CryptoServiceStatus['runtime'], serviceOnline: boolean, action: 'start' | 'stop' | null, hasError: boolean): ObserverState {
  if (action === 'start') return 'STARTING';
  if (action === 'stop') return 'STOPPING';
  if (hasError && serviceOnline) return 'ERROR';
  const rawState = String(runtime?.state ?? '').toLowerCase();
  if (rawState.includes('pause')) return 'PAUSED';
  if (runtime?.observerRunning || rawState.includes('observ') || rawState.includes('run')) return 'OBSERVING';
  return 'STOPPED';
}

function observerTone(state: ObserverState): 'success' | 'warning' | 'danger' | 'muted' | 'info' {
  if (state === 'OBSERVING') return 'success';
  if (state === 'STARTING' || state === 'STOPPING' || state === 'PAUSED') return 'warning';
  if (state === 'ERROR') return 'danger';
  return 'muted';
}

export function TradingScreen() {
  return <CryptoExchangeTerminal />;
}

function LegacyTradingScreen({ integrations = [], tools = [], logs = [] }: { integrations?: IntegrationConfig[]; tools?: AutomationTool[]; logs?: ToolExecutionLog[] }) {
  const [serviceStatus, setServiceStatus] = React.useState<CryptoServiceStatus | null>(null);
  const [cryptoData, setCryptoData] = React.useState<Record<string, any>>({});
  const [loading, setLoading] = React.useState(false);
  const [observerAction, setObserverAction] = React.useState<'start' | 'stop' | null>(null);
  const [cryptoAction, setCryptoAction] = React.useState<'analyze' | 'trade' | 'model' | null>(null);
  const [analysisSymbol, setAnalysisSymbol] = React.useState('BTC/USDT');
  const [selectedCryptoModel, setSelectedCryptoModel] = React.useState('');
  const [demoLoopMinutes, setDemoLoopMinutes] = React.useState('0');
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [cryptoError, setCryptoError] = React.useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = React.useState<Date | null>(null);
  const financeTools = tools.filter((tool) => tool.category === 'finance' || tool.permissions.includes('trading:execute'));
  const financeIntegrations = integrations.filter((integration) => integration.id.includes('finance') || integration.id.includes('trading') || integration.id.includes('binance'));
  const financeLogs = logs.filter((log) => financeTools.some((tool) => tool.id === log.toolId));

  const loadCryptoCockpit = React.useCallback(async () => {
    setLoading(true);
    try {
      const statusResponse = await optionalCryptoEndpoint('/api/edith/crypto/status');
      const status = statusResponse?.success ? statusResponse.status as CryptoServiceStatus : undefined;
      let nextData: Record<string, any> = {};
      if (status?.healthy) {
        const [
          permissions,
          symbols,
          categories,
          watchlist,
          risk,
          mode,
          overview,
          trades,
          decisions,
          markets,
          analysis,
          observations,
          learningNotes,
          obsidianStatus,
          demoPortfolio,
          cryptoWatchlist,
          cryptoNews,
          demoTrades,
          demoDecisions,
          cryptoLessons,
          cryptoModels,
          cryptoGraphStatus,
          demoLoop,
        ] = await Promise.all([
          optionalCryptoEndpoint('/api/permissions'),
          optionalCryptoEndpoint('/api/symbols'),
          optionalCryptoEndpoint('/api/categories'),
          optionalCryptoEndpoint('/api/watchlist'),
          optionalCryptoEndpoint('/api/risk'),
          optionalCryptoEndpoint('/api/mode'),
          optionalCryptoEndpoint('/api/overview'),
          optionalCryptoEndpoint('/api/trades'),
          optionalCryptoEndpoint('/api/decisions'),
          optionalCryptoEndpoint('/api/markets'),
          optionalCryptoEndpoint('/api/analysis'),
          optionalCryptoEndpoint('/api/observations'),
          optionalCryptoEndpoint('/api/learning-notes'),
          optionalCryptoEndpoint('/api/obsidian-status'),
          optionalCryptoEndpoint('/api/crypto/portfolio'),
          optionalCryptoEndpoint('/api/crypto/watchlist'),
          optionalCryptoEndpoint('/api/crypto/news'),
          optionalCryptoEndpoint('/api/crypto/trades'),
          optionalCryptoEndpoint('/api/crypto/decisions'),
          optionalCryptoEndpoint('/api/crypto/lessons'),
          optionalCryptoEndpoint('/api/crypto/models'),
          optionalCryptoEndpoint('/api/crypto/obsidian/status'),
          optionalCryptoEndpoint('/api/crypto/demo-loop'),
        ]);
        nextData = {
          permissions, symbols, categories, watchlist, risk, mode, overview, trades, decisions, markets, analysis, observations, learningNotes, obsidianStatus,
          demoPortfolio, cryptoWatchlist, cryptoNews, demoTrades, demoDecisions, cryptoLessons, cryptoModels, cryptoGraphStatus, demoLoop,
        };
      }
      setServiceStatus(status ?? {
        healthy: false,
        dashboardUrl: 'http://localhost:5000',
        error: statusResponse?.error ?? 'Crypto observer service is not running.',
      });
      setCryptoData(nextData);
      setLastCheckedAt(new Date());
      setActionError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadCryptoCockpit();
  }, [loadCryptoCockpit]);

  const runCryptoAnalyze = React.useCallback(async () => {
    setCryptoAction('analyze');
    setCryptoError(null);
    try {
      const response = await ownerMutationFetch('/api/crypto/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: [analysisSymbol] }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error ?? `Analysis failed with ${response.status}`));
      }
      await loadCryptoCockpit();
    } catch (error) {
      setCryptoError(error instanceof Error ? error.message : String(error));
    } finally {
      setCryptoAction(null);
    }
  }, [analysisSymbol, loadCryptoCockpit]);

  const selectCryptoModel = React.useCallback(async () => {
    if (!selectedCryptoModel) return;
    setCryptoAction('model');
    setCryptoError(null);
    try {
      const response = await ownerMutationFetch('/api/crypto/model/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'primary', model: selectedCryptoModel }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error ?? `Model select failed with ${response.status}`));
      }
      await loadCryptoCockpit();
    } catch (error) {
      setCryptoError(error instanceof Error ? error.message : String(error));
    } finally {
      setCryptoAction(null);
    }
  }, [selectedCryptoModel, loadCryptoCockpit]);

  const updateDemoLoop = React.useCallback(async () => {
    setCryptoAction('model');
    setCryptoError(null);
    try {
      const response = await ownerMutationFetch('/api/crypto/demo-loop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMinutes: Number(demoLoopMinutes || 0), autoExecuteDemoTrades: false }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error ?? `Demo döngüsü güncellenemedi: ${response.status}`));
      }
      await loadCryptoCockpit();
    } catch (error) {
      setCryptoError(error instanceof Error ? error.message : String(error));
    } finally {
      setCryptoAction(null);
    }
  }, [demoLoopMinutes, loadCryptoCockpit]);

  const runObserverAction = React.useCallback(async (action: 'start' | 'stop') => {
    setObserverAction(action);
    setActionError(null);
    try {
      const response = await ownerMutationFetch(`/api/edith/crypto/${action}`, { method: 'POST' });
      const data = await readJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(String(data?.error ?? `Observer ${action} failed with ${response.status}`));
      }
      if (data?.success && data.status) {
        setServiceStatus(data.status as CryptoServiceStatus);
      }
      window.setTimeout(() => {
        void loadCryptoCockpit();
      }, 1200);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setObserverAction(null);
    }
  }, [loadCryptoCockpit]);

  const overview = cryptoData.overview ?? serviceStatus?.overview ?? {};
  const demoPortfolio = cryptoData.demoPortfolio?.portfolio ?? serviceStatus?.portfolio ?? {};
  const demoLoop = cryptoData.demoLoop?.settings ?? cryptoData.demoPortfolio?.demoLoop ?? serviceStatus?.demoLoop ?? {};
  const portfolio = demoPortfolio.currentEquity !== undefined ? demoPortfolio : (overview.portfolio ?? {});
  const endpointConnected = Object.values(cryptoData).some(Boolean);
  const serviceOnline = Boolean(serviceStatus?.healthy);
  const runtime = serviceStatus?.runtime;
  const runtimeMeta = runtime as Record<string, any> | undefined;
  const serviceObsidianStatus = serviceStatus?.obsidian ?? (serviceStatus?.health?.obsidian as Record<string, any> | undefined);
  const obsidianStatus = cryptoData.cryptoGraphStatus ?? cryptoData.obsidianStatus ?? serviceObsidianStatus ?? {};
  const canonicalObsidianStatus = serviceObsidianStatus ?? {};
  const observerState = observerStateFromRuntime(runtime, serviceOnline, observerAction, Boolean(actionError));
  const observerRunning = observerState === 'OBSERVING' || observerState === 'STARTING' || observerState === 'PAUSED';
  const ollamaOnline = Boolean(runtime?.ollamaAvailable);
  const obsidianReady = canonicalObsidianStatus.status === 'connected' && Boolean(canonicalObsidianStatus.writable ?? canonicalObsidianStatus.available);
  const pauseResumeSupported = Boolean(runtimeMeta?.supportsPauseResume);
  const canStartObserver = (!serviceOnline || observerState === 'STOPPED' || observerState === 'PAUSED') && !observerAction;
  const canStopObserver = serviceOnline && ['OBSERVING', 'STARTING', 'PAUSED'].includes(observerState) && !observerAction;
  const marketOnline = Boolean(runtime?.marketDataAvailable ?? cryptoData.markets?.online ?? cryptoData.markets?.available ?? cryptoData.overview?.marketDataOnline ?? false);
  const cryptoWatchlistRows = asArray(cryptoData.cryptoWatchlist?.watchlist);
  const symbolsFromBackend = asArray(cryptoData.symbols?.symbols ?? cryptoData.watchlist?.symbols ?? cryptoData.permissions?.symbols);
  const symbolRows: CryptoSymbolPermission[] = symbolsFromBackend.length
    ? symbolsFromBackend.map((item) => ({
        symbol: String(item.symbol ?? item.pair ?? 'UNKNOWN'),
        category: String(item.category ?? 'Uncategorized'),
        watch: Boolean(item.watch ?? item.watchEnabled ?? item.watch_only ?? true),
        decision: Boolean(item.decision ?? item.decisionEnabled ?? item.aiDecision ?? false),
        paper: false,
        live: false,
        risk: cryptoRisk(item.risk ?? item.riskLevel),
        approvalRequired: Boolean(item.approvalRequired ?? item.requiresApproval),
      }))
    : SAFE_SYMBOL_PERMISSIONS;
  const decisions = asArray(cryptoData.demoDecisions?.decisions ?? cryptoData.decisions?.decisions ?? cryptoData.analysis?.decisions);
  const trades = asArray(cryptoData.demoTrades?.trades ?? cryptoData.trades?.trades ?? overview.trades);
  const openPositions = asArray(demoPortfolio.openPositions ?? portfolio.positions);
  const newsItems = asArray(cryptoData.cryptoNews?.items);
  const cryptoLessons = asArray(cryptoData.cryptoLessons?.lessons);
  const cryptoModels = cryptoData.cryptoModels ?? serviceStatus?.models ?? {};
  const availableCryptoModels = asArray(cryptoModels.models).map(String);
  const selectedModel = String(cryptoModels.selected?.primary ?? runtimeMeta?.currentModel ?? runtimeMeta?.model ?? cryptoData.mode?.model ?? 'not reported');
  const risk = cryptoData.risk ?? {};
  const modeLabel = String(serviceStatus?.health?.mode ?? runtime?.mode ?? cryptoData.mode?.trading_mode ?? cryptoData.mode?.mode ?? overview.mode ?? 'OBSERVER_ONLY').replaceAll('_', ' ').toUpperCase();
  const paperTradingEnabled = false;
  const observations = asArray(cryptoData.observations?.observations ?? cryptoData.analysis?.observations);
  const serviceUrl = serviceStatus?.dashboardUrl ?? 'http://localhost:5000';
  const lastChecked = lastCheckedAt ? lastCheckedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'pending';
  const startupCommand = 'npm run crypto:observer';
  const watchedSymbols = Array.isArray(runtime?.watchedSymbols) ? runtime.watchedSymbols : symbolRows.filter((symbol) => symbol.watch).map((symbol) => symbol.symbol);
  const ignoredSymbols = symbolRows.filter((symbol) => !symbol.watch || symbol.approvalRequired).map((symbol) => symbol.symbol);
  const tradeLessonNotes = cryptoLessons;
  const lastLearningNote = tradeLessonNotes[0]?.title ?? (obsidianReady ? 'demo trade dersi bekleniyor' : 'bağlı değil');
  const credits = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' CR' : 'Bildirilmedi';
  const initialLedgerLabel = typeof demoPortfolio.initialBalance === 'number' && Number.isFinite(demoPortfolio.initialBalance) ? Number(demoPortfolio.initialBalance).toLocaleString('tr-TR') + ' CR' : 'Bildirilmedi';
  const portfolioDataLabel = serviceOnline ? `${initialLedgerLabel} · DEMO MODU` : 'DEMO SERVİSİ KAPALI';
  const lastDecision = decisions[0];
  const demoOverview = {
    ...overview,
    stats: {
      ...(overview.stats ?? {}),
      total_trades: demoPortfolio.numberOfTrades ?? 0,
    },
    portfolio: demoPortfolio,
  };
  const hasPortfolioData = Boolean(
    demoPortfolio.initialBalance !== undefined
      || demoPortfolio.currentEquity !== undefined
      || demoPortfolio.currentCash !== undefined
      || demoPortfolio.numberOfTrades !== undefined
      || trades.length
  );
  const modelIsWorking = cryptoAction === 'analyze' || observerState === 'OBSERVING' || observerState === 'STARTING';
  const newsOnline = newsItems.length > 0;
  const safeWatchlistFallback = !cryptoWatchlistRows.length && !cryptoData.symbols && !cryptoData.watchlist;
  const totalDemoTrades = Number(demoPortfolio.numberOfTrades ?? trades.length ?? 0);
  const closedDemoTrades = asArray(demoPortfolio.closedTrades).length;
  const noTradeCount = Number(
    demoPortfolio.numberOfNoTradeDecisions
      ?? decisions.filter((decision: any) => String(decision.decision ?? decision.action ?? '').toUpperCase().includes('NO')).length
      ?? 0
  );
  const bestDecision = demoPortfolio.bestDecision ?? demoPortfolio.best_decision ?? overview?.stats?.bestDecision ?? overview?.stats?.best_decision;
  const worstDecision = demoPortfolio.worstDecision ?? demoPortfolio.worst_decision ?? overview?.stats?.worstDecision ?? overview?.stats?.worst_decision;
  const strongestLesson = tradeLessonNotes[0]?.title ?? demoPortfolio.strongestLesson ?? demoPortfolio.strongest_lesson;
  const marketImpactSummary = cryptoData.news?.marketImpact ?? cryptoData.news?.impactSummary ?? {};

  React.useEffect(() => {
    if (demoLoop.intervalMinutes !== undefined && !Number.isNaN(Number(demoLoop.intervalMinutes))) {
      setDemoLoopMinutes(String(demoLoop.intervalMinutes));
    }
  }, [demoLoop.intervalMinutes]);

  return (
    <div className="edith-workspace edith-responsive-pad overflow-y-auto bg-[#05070b] custom-scrollbar">
      <div className="edith-responsive-container-cockpit edith-crypto-cockpit space-y-4">
        <section className="edith-crypto-hero edith-crypto-panel-reveal relative overflow-hidden rounded-lg border border-cyan-300/18 bg-[radial-gradient(circle_at_18%_0%,rgba(14,165,233,0.17),transparent_34%),linear-gradient(135deg,rgba(8,13,23,0.96),rgba(2,6,12,0.98))] p-4 shadow-[0_0_42px_rgba(14,165,233,0.12)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_clamp(22rem,22vw,30rem)]">
            <div className="min-w-0">
              <CryptoStatusBar
                initialCapital={initialLedgerLabel}
                serviceOnline={serviceOnline}
                marketOnline={marketOnline}
                newsOnline={newsOnline}
                ollamaOnline={ollamaOnline}
                obsidianReady={obsidianReady}
                selectedModel={selectedModel}
                demoLoopLabel={demoLoop.label ?? (Number(demoLoop.intervalMinutes ?? 0) <= 0 ? 'SÜREKLİ' : `${demoLoop.intervalMinutes} DK`)}
                lastAnalysisTime={displayTime(runtime?.lastAnalysisAt ?? lastDecision?.timestamp ?? runtime?.lastObservationAt)}
              />
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="edith-eyebrow">E.D.I.T.H. / KRİPTO ZEKA PANELİ</div>
                  <h1 className="mt-1 text-2xl font-semibold tracking-[0.16em] text-slate-100 sm:text-3xl">DEMO TRADING KOKPİTİ</h1>
                  <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-400">
                    Modelin piyasada neye baktığını, neden işlem yapıp yapmadığını ve 10.000 CR sanal portföyün durumunu gösterir. Canlı Binance emri ve gerçek para kullanımı kapalıdır.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadCryptoCockpit}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-300/15"
                >
                  <Activity className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Yenile
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CryptoAnimatedMetric label="Mod" value={modeLabel.includes('OBSERVER') ? 'DEMO / İZLEME' : modeLabel} tone="cyan" />
              <CryptoAnimatedMetric label="Başlangıç" value={initialLedgerLabel} tone="green" />
              <CryptoAnimatedMetric label="Servis" value={serviceOnline ? 'AÇIK' : 'KAPALI'} tone={serviceOnline ? 'green' : 'amber'} />
              <CryptoAnimatedMetric label="Döngü" value={demoLoop.label ?? 'SÜREKLİ'} tone="cyan" />
              <CryptoAnimatedMetric label="Ollama" value={ollamaOnline ? selectedModel : 'KAPALI'} tone={ollamaOnline ? 'green' : 'amber'} />
              <CryptoAnimatedMetric label="Piyasa Verisi" value={marketOnline ? 'AKTİF' : 'BEKLİYOR'} tone={marketOnline ? 'green' : 'amber'} />
            </div>
          </div>
        </section>

        <CryptoPanel title="Demo Döngü Kontrolü" eyebrow="GÜVENLİ SİMÜLASYON / CANLI EMİR YOK" icon={<RadioTower className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_auto]">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <ControlReadout label="Durum" value={observerState === 'OBSERVING' ? 'ÇALIŞIYOR' : observerState} tone={observerTone(observerState)} pulse={observerState === 'OBSERVING' || observerState === 'STARTING' || observerState === 'STOPPING'} />
              <ControlReadout label="Demo Döngü" value={demoLoop.label ?? 'SÜREKLİ'} tone="info" />
              <ControlReadout label="Güvenlik" value="CANLI EMİR KAPALI" tone="danger" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={() => void runObserverAction('start')}
                disabled={!canStartObserver}
                title={!serviceOnline ? 'Önce güvenli crypto servisini başlat; canlı işlem yine kilitli kalır.' : !ollamaOnline ? 'Ollama kapalı; servis yine durum raporlayabilir.' : canStartObserver ? 'Demo observer döngüsünü başlatır; gerçek emir göndermez.' : 'Başlatma sadece döngü durduğunda kullanılabilir.'}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Play className={`h-3.5 w-3.5 ${observerAction === 'start' ? 'animate-pulse' : ''}`} />
                Demo Döngüyü Başlat
              </button>
              <button
                type="button"
                onClick={() => void runObserverAction('stop')}
                disabled={!canStopObserver}
                title={canStopObserver ? 'Demo observer döngüsünü durdurur; yıkıcı işlem yapmaz.' : 'Durdurma sadece döngü çalışırken kullanılabilir.'}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-300/30 bg-red-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-red-100 transition hover:bg-red-300/15 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Square className={`h-3.5 w-3.5 ${observerAction === 'stop' ? 'animate-pulse' : ''}`} />
                Döngüyü Durdur
              </button>
              <button
                type="button"
                disabled={!pauseResumeSupported || observerState !== 'OBSERVING'}
                title={pauseResumeSupported ? 'Demo observer döngüsünü geçici duraklat.' : 'Duraklatma endpointi henüz bağlı değil.'}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-amber-300/35 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Pause className="h-3.5 w-3.5" />
                Duraklat
              </button>
              <button
                type="button"
                disabled={!pauseResumeSupported || observerState !== 'PAUSED'}
                title={pauseResumeSupported ? 'Demo observer döngüsünü sürdür.' : 'Sürdürme endpointi henüz bağlı değil.'}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Play className="h-3.5 w-3.5" />
                Sürdür
              </button>
              <button
                type="button"
                onClick={loadCryptoCockpit}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-300/15"
              >
                <Activity className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Durumu Yenile
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
            <ActionRow label="Canlı trading" value="KİLİTLİ" />
            <ActionRow label="Demo trading" value={`${initialLedgerLabel} · SANAL`} />
            <ActionRow label="Gerçek emir" value="YOK" />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {!ollamaOnline && (
              <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs font-semibold text-amber-100">
                Ollama kapalı. Crypto servisi yine açık/kapalı durumunu dürüst şekilde raporlar.
              </div>
            )}
            {!obsidianReady && (
              <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs font-semibold text-amber-100">
                Obsidian bağlantısı hazır değil veya yazılabilir değil.
              </div>
            )}
            {actionError && (
              <div className="rounded-md border border-red-300/30 bg-red-300/10 p-3 text-xs font-semibold text-red-100">
                {actionError}
              </div>
            )}
          </div>
        </CryptoPanel>

        {!serviceOnline && (
          <section className="rounded-lg border border-amber-300/28 bg-[linear-gradient(135deg,rgba(245,158,11,0.14),rgba(7,10,18,0.92))] p-4 shadow-[0_0_34px_rgba(245,158,11,0.1)]">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-amber-300/30 bg-amber-300/12 text-amber-200">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-lg font-semibold text-amber-100">Crypto Servisi Kapalı</div>
                  <p className="mt-1 max-w-3xl text-sm leading-relaxed text-amber-100/78">
                    Observer servisi çalışmadığı için gerçek piyasa akışı ve öğrenme notları durakladı. Demo döngüyü başlatmak canlı emir kilidini açmaz.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <StatusPill label="Observer durdu" tone="muted" />
                    <StatusPill label="Canlı trading kilitli" tone="danger" />
                    <StatusPill label="Demo portföy" tone="info" />
                    <StatusPill label="Gerçek emir yok" tone="danger" />
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
                    <ActionRow label="Başlatma komutu" value={startupCommand} />
                    <ActionRow label="Alternatif komut" value="python crypto/run_agent.py" />
                    <ActionRow label="Beklenen servis URL" value={serviceUrl} />
                    <ActionRow label="Son kontrol" value={lastChecked} />
                  </div>
                  {serviceStatus?.error && <p className="mt-3 font-mono text-[11px] text-amber-100/70">{serviceStatus.error}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={loadCryptoCockpit}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-100 transition hover:bg-amber-300/15"
              >
                <Activity className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Tekrar Dene
              </button>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
          <CryptoPanel title="Demo Portfolio Overview" eyebrow={hasPortfolioData ? 'CR DEMO LEDGER / GERÇEK PARA YOK' : 'VERİ BEKLENİYOR / SAFE EMPTY STATE'} icon={<TrendingUp className="h-4 w-4" />}>
            <div className="mb-3 flex flex-wrap gap-2">
              <StatusPill label="DEMO MOD" tone="info" />
              <StatusPill label="STARTING CAPITAL" value={initialLedgerLabel} tone="info" />
              <StatusPill label="GERÇEK PARA YOK" tone="success" />
              <StatusPill label="CANLI EMİR YOK" tone="danger" />
              <StatusPill label="SANAL PORTFÖY" tone="muted" />
            </div>
            {hasPortfolioData ? (
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <CryptoAnimatedMetric label="Başlangıç" value={initialLedgerLabel} tone="slate" />
                <CryptoAnimatedMetric label="Nakit" value={credits(demoPortfolio.currentCash)} tone="cyan" />
                <CryptoAnimatedMetric label="Varlık" value={credits(demoPortfolio.currentEquity)} tone="green" />
                <CryptoAnimatedMetric label="Pozisyon" value={pct(demoPortfolio.currentExposurePct ?? 0)} tone="amber" />
                <CryptoAnimatedMetric label="Demo Net K/Z" value={credits(demoPortfolio.realizedPnl)} tone={(demoPortfolio.realizedPnl ?? 0) >= 0 ? 'green' : 'amber'} />
                <CryptoAnimatedMetric label="Açık Demo K/Z" value={credits(demoPortfolio.unrealizedPnl)} tone={(demoPortfolio.unrealizedPnl ?? 0) >= 0 ? 'green' : 'amber'} />
                <CryptoAnimatedMetric label="Win Rate" value={pct(demoPortfolio.winRate ?? 0)} tone="cyan" />
                <CryptoAnimatedMetric label="NO TRADE" value={String(noTradeCount)} tone="slate" />
              </div>
            ) : (
              <CryptoEmptyState
                title="No demo portfolio data yet"
                text="Demo başlangıç bakiyesi ve performansı backend portföy kaydı gelince gösterilir."
                icon={<TrendingUp className="h-4 w-4" />}
              />
            )}
          </CryptoPanel>

          <CryptoPanel title="Ollama Model Activity / Demo Controls" eyebrow={cryptoModels.available ? 'YEREL MODEL HAZIR' : 'MODEL ULAŞILAMAZ'} icon={<Cpu className="h-4 w-4" />}>
            <div className="space-y-3">
              <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.045] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">Model görevi</div>
                    <div className="mt-1 text-sm font-semibold text-slate-100">
                      {modelIsWorking ? 'Piyasa verisi okunuyor / risk değerlendiriliyor' : 'Beklemede'}
                    </div>
                  </div>
                  <StatusPill label={modelIsWorking ? 'ACTIVE' : cryptoModels.available ? 'READY' : 'OFFLINE'} tone={modelIsWorking ? 'info' : cryptoModels.available ? 'success' : 'warning'} />
                </div>
                <CryptoActivityWaveform active={modelIsWorking && cryptoModels.available} />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  value={selectedCryptoModel || selectedModel}
                  onChange={(event) => setSelectedCryptoModel(event.target.value)}
                  className="min-h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-xs font-semibold text-slate-100 outline-none transition focus:border-cyan-300/50"
                >
                  <option value={selectedModel}>{selectedModel}</option>
                  {availableCryptoModels.filter((model) => model !== selectedModel).map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={selectCryptoModel}
                  disabled={!selectedCryptoModel || cryptoAction === 'model'}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Seç
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={demoLoopMinutes}
                  onChange={(event) => setDemoLoopMinutes(event.target.value)}
                  placeholder="0 = sürekli"
                  className="min-h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-xs font-semibold text-slate-100 outline-none transition focus:border-cyan-300/50"
                />
                <button
                  type="button"
                  onClick={updateDemoLoop}
                  disabled={cryptoAction === 'model'}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Clock3 className="h-3.5 w-3.5" />
                  Döngüyü Ayarla
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  value={analysisSymbol}
                  onChange={(event) => setAnalysisSymbol(event.target.value)}
                  className="min-h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-xs font-semibold text-slate-100 outline-none transition focus:border-emerald-300/50"
                >
                  {(cryptoWatchlistRows.length ? cryptoWatchlistRows : symbolRows).map((row: any) => (
                    <option key={row.symbol} value={row.symbol}>{row.symbol} - {row.mode ?? 'WATCH'}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={runCryptoAnalyze}
                  disabled={!serviceOnline || cryptoAction === 'analyze'}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Bot className={`h-3.5 w-3.5 ${cryptoAction === 'analyze' ? 'animate-pulse' : ''}`} />
                  Analiz Yap
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs">
                <ActionRow label="Seçili model" value={selectedModel} />
                <ActionRow label="Ollama durumu" value={cryptoModels.available ? `aktif / ${cryptoModels.latencyMs ?? '-'}ms` : String(cryptoModels.error ?? 'ulaşılamıyor')} />
                <ActionRow label="Demo döngü" value={demoLoop.label ?? 'SÜREKLİ'} />
                <ActionRow label="Son model görevi" value={String(cryptoModels.lastActivity?.[0]?.task ?? 'henüz crypto çıkarımı yok')} />
              </div>
              {cryptoError && (
                <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs font-semibold text-amber-100">
                  {cryptoError}
                </div>
              )}
            </div>
          </CryptoPanel>
        </div>

        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_clamp(23rem,21vw,31rem)]">
          <div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[clamp(22rem,24vw,32rem)_minmax(0,1fr)]">
              <CryptoPanel title="Market Radar" eyebrow={endpointConnected ? 'READ-ONLY MARKET DATA' : 'VERİ BEKLENİYOR'} icon={<Radar className="h-4 w-4" />}>
                <CryptoMarketTerminal
                  symbols={symbolRows}
                  observerRunning={observerRunning}
                  marketOnline={marketOnline}
                  lastChecked={lastChecked}
                  markets={cryptoData.markets?.markets}
                  risk={cryptoData.risk?.risk ?? cryptoData.risk}
                  overview={demoOverview}
                />
              </CryptoPanel>

              <CryptoPanel title="Watchlist / Asset Modes" eyebrow={safeWatchlistFallback ? 'SAFE DEFAULTS / BACKEND LİSTESİ YOK' : 'BACKEND VARLIK MODLARI'} icon={<Database className="h-4 w-4" />}>
                {safeWatchlistFallback && (
                  <div className="mb-3 rounded-md border border-amber-300/25 bg-amber-300/10 p-3 text-xs text-amber-100/80">
                    Backend watchlist verisi gelmediği için güvenli varsayılan izinler gösteriliyor. Bunlar canlı fiyat veya gerçek sinyal değildir.
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {(cryptoWatchlistRows.length ? cryptoWatchlistRows : symbolRows).map((symbol: any) => (
                    <div key={symbol.symbol} className="edith-crypto-radar-pulse rounded-lg border border-white/10 bg-white/[0.035] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-sm font-semibold text-slate-100">{symbol.symbol}</div>
                          <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">{symbol.mode ?? `Kategori: ${symbol.category ?? 'izleme'}`}</div>
                        </div>
                        <StatusPill label={String(symbol.signal ?? symbol.latestSignal ?? symbol.mode ?? 'WATCH').toUpperCase()} tone={symbol.demoTradingEnabled ? 'warning' : symbol.analysisEnabled ? 'info' : 'muted'} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <MiniFlag label="İzle" value={symbol.watchEnabled ?? symbol.watch ? 'Açık' : 'Kapalı'} good={Boolean(symbol.watchEnabled ?? symbol.watch)} />
                        <MiniFlag label="Analiz" value={symbol.analysisEnabled ?? symbol.decision ? 'İzinli' : 'Kapalı'} good={Boolean(symbol.analysisEnabled ?? symbol.decision)} />
                        <MiniFlag label="Demo" value={symbol.demoTradingEnabled ? 'İzinli' : 'Kapalı'} good={Boolean(symbol.demoTradingEnabled)} />
                        <MiniFlag label="Canlı" value="Kilitli" good={false} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <ActionRow label="Fiyat" value={symbol.price ? money(symbol.price) : 'veri yok'} />
                        <ActionRow label="24s değişim" value={pct(symbol.change24hPct ?? symbol.change24h ?? symbol.change_pct, 'veri yok')} />
                        <ActionRow label="Hacim" value={symbol.volume ? compactNumber(Number(symbol.volume)) : 'veri yok'} />
                        <ActionRow label="Trend" value={String(symbol.trend ?? 'veri yok')} />
                        <ActionRow label="Sentiment" value={String(symbol.sentiment ?? 'veri yok')} />
                        <ActionRow label="Confidence" value={typeof symbol.confidence === 'number' ? `${Math.round(symbol.confidence * 100)}%` : 'veri yok'} />
                      </div>
                      {symbol.approvalRequired && <p className="mt-2 text-[11px] text-amber-200">Yüksek riskli varlıklar backend aksiyonundan önce onay ister.</p>}
                    </div>
                  ))}
                </div>
              </CryptoPanel>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <CryptoPanel title="AI Analysis Panel" eyebrow={lastDecision ? 'SON DEMO KARAR / GİZLİ DÜŞÜNCE YOK' : 'ANALİZ BEKLİYOR'} icon={<Eye className="h-4 w-4" />}>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label={modelIsWorking ? 'THINKING PULSE' : 'STANDBY'} tone={modelIsWorking ? 'info' : 'muted'} />
                    <StatusPill label={`TARGET ${String(lastDecision?.symbol ?? analysisSymbol)}`} tone="info" />
                    <StatusPill label={`MODEL ${selectedModel}`} tone={ollamaOnline ? 'success' : 'warning'} />
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs">
                    <ActionRow label="Varlık" value={String(lastDecision?.symbol ?? analysisSymbol)} />
                    <ActionRow label="Market regime" value={String(lastDecision?.market_regime ?? lastDecision?.marketRegime ?? 'backend bildirmedi')} />
                    <ActionRow label="Karar" value={String(lastDecision?.decision ?? lastDecision?.action ?? 'Henüz yok')} />
                    <ActionRow label="Güven" value={typeof lastDecision?.confidence === 'number' ? `${Math.round(lastDecision.confidence * 100)}%` : String(lastDecision?.confidence ?? '-')} />
                    <ActionRow label="Risk sonucu" value={String(lastDecision?.riskStatus ?? lastDecision?.risk_status ?? 'bekliyor')} />
                    <ActionRow label="Teknik veri" value={String(lastDecision?.technical_summary ?? 'RSI, trend, MACD, ATR, fiyat verisi bekleniyor')} />
                    <ActionRow label="Haber etkisi" value={String(lastDecision?.news_summary ?? 'Haber etkisi henüz yok')} />
                    <ActionRow label="Neden işlem / no-trade" value={String(lastDecision?.why_trade ?? lastDecision?.whyNoTrade ?? lastDecision?.decision_reason ?? 'karar özeti bekleniyor')} />
                  </div>
                  <div className={`rounded-md border border-cyan-400/20 bg-cyan-400/10 p-3 text-xs leading-relaxed text-cyan-100/80 ${modelIsWorking ? 'edith-crypto-status-pulse' : ''}`}>
                    {lastDecision?.decision_reason ?? 'Analiz çalıştırıldığında modelin baktığı veriler ve kısa karar sebebi burada görünür. Gizli düşünce zinciri gösterilmez.'}
                  </div>
                </div>
              </CryptoPanel>

              <CryptoPanel title="News Intelligence" eyebrow={newsItems.length ? 'GERÇEK RSS / ÖZETLENMİŞ' : 'OFFLINE / NOT CONFIGURED'} icon={<Globe2 className="h-4 w-4" />}>
                <div className="mb-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                  <ActionRow label="Bullish drivers" value={String(marketImpactSummary.bullishDrivers ?? marketImpactSummary.bullish ?? 'veri yok')} />
                  <ActionRow label="Bearish drivers" value={String(marketImpactSummary.bearishDrivers ?? marketImpactSummary.bearish ?? 'veri yok')} />
                  <ActionRow label="Noise / neutral" value={String(marketImpactSummary.neutralDrivers ?? marketImpactSummary.neutral ?? 'veri yok')} />
                </div>
                <div className="space-y-3">
                  {(newsItems.length ? newsItems : [{ title: 'News ingestion offline or not configured', summary: 'Son crypto haberi henüz toplanmadı. E.D.I.T.H. sahte haber üretmez.', sentiment: 'unknown', source: 'system' }]).slice(0, 4).map((item: any, index: number) => (
                    <div key={`${item.title ?? 'news'}-${index}`} className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-100">{item.title ?? 'News item'}</div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">{item.summary ?? 'No summary reported.'}</p>
                        </div>
                        <StatusPill label={String(item.sentiment ?? 'UNKNOWN').toUpperCase()} tone={item.sentiment === 'positive' ? 'success' : item.sentiment === 'negative' ? 'warning' : 'muted'} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-slate-500">
                        <span>Kaynak: {item.source ?? 'bildirilmedi'}</span>
                        <span>Varlık: {asArray(item.relatedAssets).join(', ') || 'genel piyasa'}</span>
                        <span>Güvenilirlik: {typeof item.credibility === 'number' ? Math.round(item.credibility * 100) : 0}%</span>
                        <span>Önem: {typeof item.importance === 'number' ? Math.round(item.importance * 100) : 0}%</span>
                        <span>Zaman: {displayTime(item.timestamp)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CryptoPanel>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <CryptoPanel title="Demo Karar Geçmişi" eyebrow={decisions.length ? 'MODEL KARARLARI' : 'HENÜZ KARAR YOK'} icon={<Bot className="h-4 w-4" />}>
                <div className="space-y-3">
                  {decisions.length ? decisions.slice(0, 5).map((decision: any, index: number) => (
                    <div key={`${decision.symbol}-${index}`} className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-sm font-semibold text-slate-100">{decision.symbol ?? 'UNKNOWN'}</div>
                          <div className="mt-1 text-[11px] text-slate-500">Model: {decision.model_used ?? decision.provider ?? decision.modelProvider ?? 'bildirilmedi'}</div>
                        </div>
                        <StatusPill label={String(decision.decision ?? decision.action ?? 'NO DATA').toUpperCase()} tone={String(decision.decision ?? decision.action ?? '').toUpperCase() === 'BUY' || String(decision.decision ?? decision.action ?? '').toUpperCase() === 'SELL' ? 'warning' : 'muted'} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <ActionRow label="Güven" value={typeof decision.confidence === 'number' ? `${Math.round(decision.confidence * 100)}%` : String(decision.confidence ?? '-')} />
                        <ActionRow label="Risk" value={String(decision.riskStatus ?? decision.risk_status ?? decision.riskResult ?? decision.risk_result ?? 'bağlı değil')} />
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Sebep: {decision.decision_reason ?? decision.reasoning ?? decision.reason ?? 'Net kurulum bildirilmedi.'}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">Risk: {decision.risk_reason ?? decision.risk_summary ?? 'Risk özeti yok.'}</p>
                    </div>
                  )) : (
                    <CryptoEmptyState
                      title="Henüz demo karar yok"
                      text="NO TRADE kararları da burada saygıyla gösterilecek; backend karar üretmeden E.D.I.T.H. sahte BUY/SELL veya başarı sinyali göstermez."
                      icon={<Bot className="h-4 w-4" />}
                    />
                  )}
                </div>
              </CryptoPanel>

              <CryptoPanel title="Demo İşlemden Öğrendikleri" eyebrow="SADECE TRADE SONRASI" icon={<Brain className="h-4 w-4" />}>
                <div className="grid grid-cols-1 gap-2">
                  <ActionRow label="Vault yolu" value={String(obsidianStatus.vaultPath || 'Yapılandırılmadı')} />
                  <ActionRow label="Ders kaynağı" value="sadece demo trade" />
                  <ActionRow label="Trade klasörü" value="Trading/Crypto/Trade Journal" />
                  <ActionRow label="Yazılabilir" value={obsidianReady ? 'evet' : 'hayır / bildirilmedi'} />
                  <ActionRow label="Senkron durumu" value={obsidianReady ? 'bağlı' : String(canonicalObsidianStatus.status ?? obsidianStatus.status ?? 'bağlı değil')} />
                  <ActionRow label="Son senkron" value={displayTime(obsidianStatus.lastSync ?? obsidianStatus.updatedAt ?? runtime?.lastObservationAt)} />
                </div>
                <div className="mt-3 space-y-2">
                  {(tradeLessonNotes.length ? tradeLessonNotes : obsidianReady ? SAFE_LEARNING_NOTES : [{ title: 'Obsidian bağlı değil', detail: 'Backend durumuna göre vault bağlı/yazılabilir değil.' }]).slice(0, 3).map((note: any, index: number) => (
                    <div key={`${note.title ?? 'note'}-${index}`} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="text-xs font-semibold text-slate-200">{note.title ?? 'Demo trade dersi'}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{note.detail ?? note.summary ?? note.path ?? 'Demo işlem yapılınca burada trade sonrası ders görünür.'}</div>
                    </div>
                  ))}
                </div>
              </CryptoPanel>

              <CryptoPanel title="Demo İşlem Geçmişi" eyebrow={portfolioDataLabel} icon={<FileText className="h-4 w-4" />}>
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusPill label={portfolioDataLabel} tone="muted" />
                  <StatusPill label="CANLI TRADING KİLİTLİ" tone="danger" />
                  <StatusPill label="GERÇEK PERFORMANS DEĞİL" tone="warning" />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <ActionRow label="Başlangıç bakiyesi" value={credits(demoPortfolio.initialBalance)} />
                  <ActionRow label="Mevcut demo varlık" value={credits(demoPortfolio.currentEquity)} />
                  <ActionRow label="Açık demo pozisyon" value={String(openPositions.length)} />
                  <ActionRow label="Kapanan işlem" value={String(asArray(demoPortfolio.closedTrades).length)} />
                  <ActionRow label="Gerçekleşen demo K/Z" value={credits(demoPortfolio.realizedPnl)} />
                  <ActionRow label="İşlem günlüğü" value={trades.length ? `${trades.length} kayıt` : 'henüz kayıt yok'} />
                </div>
                <div className="mt-3 space-y-2">
                  {trades.length ? trades.slice(0, 3).map((trade: any) => (
                    <div key={trade.id ?? `${trade.symbol}-${trade.timestamp}`} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-100">{trade.symbol}</span>
                        <StatusPill label={`DEMO ${String(trade.side ?? 'TRADE')}`} tone="info" />
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">Tutar {credits(trade.cost)} / Piyasa fiyatı {money(trade.price)} / K/Z {credits(trade.pnl)}</div>
                    </div>
                  )) : (
                    <CryptoEmptyState
                      title="No demo trades yet"
                      text="E.D.I.T.H. demo trade veya önemli NO TRADE kararı gelmeden işlem kaydı üretmez. Bu alan gerçek para performansı değildir."
                      icon={<FileText className="h-4 w-4" />}
                    />
                  )}
                </div>
                <p className="mt-3 rounded-md border border-cyan-400/20 bg-cyan-400/10 p-3 text-xs text-cyan-100/75">
                  Bu günlük sadece simülasyon değerlerini gösterir. Bu kokpitten gerçek Binance emri gönderilemez.
                </p>
              </CryptoPanel>

              <CryptoPerformancePanel
                totalTrades={totalDemoTrades}
                closedTrades={closedDemoTrades}
                noTradeCount={noTradeCount}
                bestDecision={bestDecision}
                worstDecision={worstDecision}
                strongestLesson={strongestLesson}
                hasHistory={Boolean(totalDemoTrades || closedDemoTrades || noTradeCount || bestDecision || worstDecision || strongestLesson)}
              />
            </div>
          </div>

          <aside className="space-y-4">
            <CryptoPanel title="Güvenlik Kilitleri" eyebrow="HER ZAMAN AÇIK" icon={<LockKeyhole className="h-4 w-4" />}>
              <div className="space-y-2">
                <SafetyLine label="Canlı trading kapalı" />
                <SafetyLine label="Gerçek Binance emri yok" />
                <SafetyLine label="Demo işlem risk motorundan geçer" />
                <SafetyLine label="API anahtarları gösterilmez" />
                <SafetyLine label="Para çekme / yatırma / transfer yok" />
                <SafetyLine label="Yüksek riskli varlıklar onay ister" />
                <SafetyLine label="Finansal tavsiye değildir" />
                <ActionRow label="Mod" value="demo / izleme" />
                <ActionRow label="Güvenlik durumu" value={runtime?.safetyStatus?.status ?? 'LOCKED'} />
                <ActionRow label="Finans entegrasyonu" value={String(financeIntegrations.length)} />
                <ActionRow label="Audit kaydı" value={String(financeLogs.length)} />
              </div>
            </CryptoPanel>

            <CryptoPanel title="Ollama Model Durumu" eyebrow="YEREL MODEL" icon={<Cpu className="h-4 w-4" />}>
              <div className="space-y-2">
                <ActionRow label="Durum" value={ollamaOnline ? 'Açık' : 'Kapalı'} />
                <ActionRow label="Model" value={String(runtimeMeta?.currentModel ?? runtimeMeta?.model ?? cryptoData.mode?.model ?? 'not reported')} />
                <ActionRow label="Son kontrol" value={lastChecked} />
                <ActionRow label="Hata kodu" value={String(runtimeMeta?.ollamaErrorCode ?? runtimeMeta?.errorCode ?? (ollamaOnline ? 'yok' : 'bildirilmedi'))} />
              </div>
              {!ollamaOnline && (
                <p className="mt-3 rounded-md border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-100/80">
                  Ollama kapalı. Crypto servisi yine piyasa ve güvenlik durumunu ayrı raporlayabilir.
                </p>
              )}
            </CryptoPanel>

            <CryptoPanel title="Obsidian Durumu" eyebrow={obsidianReady ? 'BAĞLI' : 'YAPILANDIRMA GEREKİYOR'} icon={<Archive className="h-4 w-4" />}>
              <div className="space-y-2">
                <ActionRow label="Vault" value={String(obsidianStatus.vaultPath || 'Yapılandırılmadı')} />
                <ActionRow label="Klasör" value={String(obsidianStatus.folder ?? 'Trading/Crypto Market Learning')} />
                <ActionRow label="Yazılabilir" value={obsidianReady ? 'evet' : 'hayır'} />
                <ActionRow label="Son export" value={displayTime(obsidianStatus.lastExport ?? obsidianStatus.lastSync ?? runtime?.lastObservationAt)} />
              </div>
              {!obsidianReady && (
                <p className="mt-3 rounded-md border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-100/80">
                  Obsidian export yapılandırması hazır değil.
                </p>
              )}
            </CryptoPanel>

            <CryptoPanel title="Binance Bağlantısı" eyebrow={endpointConnected ? 'SERVİS VERİSİ' : 'VERİ BEKLENİYOR'} icon={<Network className="h-4 w-4" />}>
              <div className="space-y-2">
                <ActionRow label="Public piyasa verisi" value={marketOnline ? 'aktif' : observerRunning ? 'kontrol ediliyor' : 'beklemede'} />
                <ActionRow label="Read-only hesap" value="yapılandırılmadı" />
                <ActionRow label="Trading izni" value="kapalı / kilitli" />
                <ActionRow label="API key" value="asla gösterilmez" />
              </div>
              {!marketOnline && (
                <p className="mt-3 rounded-md border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-100/80">
                  Piyasa verisi şu an yok. Kokpit gerçek feed göstermeden önce backend Binance durumunu doğrulamalı.
                </p>
              )}
            </CryptoPanel>

            <CryptoPanel title="Risk Motoru" eyebrow="VETO KATMANI" icon={<ShieldCheck className="h-4 w-4" />}>
              <div className="space-y-2">
                <ActionRow label="Maks açık pozisyon" value={String(risk.maxOpenPositions ?? risk.max_open_positions ?? 'bağlı değil')} />
                <ActionRow label="Maks portföy payı" value={pct(risk.maxAllocationPct ?? risk.max_allocation_pct)} />
                <ActionRow label="Maks işlem boyutu" value={pct(risk.maxPositionSizePct ?? risk.max_position_size_pct)} />
                <ActionRow label="Stop-loss" value={pct(risk.stopLossPct ?? risk.stop_loss_pct)} />
                <ActionRow label="Take-profit" value={pct(risk.takeProfitPct ?? risk.take_profit_pct)} />
                <ActionRow label="Risk veto sayısı" value={String(risk.vetoCount ?? risk.veto_count ?? 'bağlı değil')} />
                <ActionRow label="Son red sebebi" value={String(risk.lastRejectionReason ?? risk.last_rejection_reason ?? 'bildirilmedi')} />
              </div>
            </CryptoPanel>

            <CryptoPanel title="Observer Akışı" eyebrow="DÖNGÜ DURUMU" icon={<RadioTower className="h-4 w-4" />}>
              <div className="space-y-2">
                {[
                  ['Durum', observerState],
                  ['Bakılan varlık', runtime?.currentSymbol ?? 'yok'],
                  ['Son gözlem', displayTime(runtime?.lastObservationAt)],
                  ['Son demo trade dersi', lastLearningNote],
                  ['İzlenenler', watchedSymbols.join(', ') || 'yok'],
                  ['Yok sayılanlar', ignoredSymbols.join(', ') || 'yok'],
                  ['Emir gönderimi', 'kilitli'],
                ].map(([label, value], index) => (
                  <div key={label} className="flex items-center gap-3 rounded-md border border-white/10 bg-slate-950/45 px-3 py-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${observerState === 'OBSERVING' && index < 2 ? 'animate-pulse bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.9)]' : value === 'kilitli' ? 'bg-red-300' : 'bg-slate-500'}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-200">{label}</div>
                      <div className="truncate text-[11px] uppercase tracking-wide text-slate-500">{value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CryptoPanel>

            <CryptoPanel title="Varlık İzinleri" eyebrow="GÜVENLİ MODLAR" icon={<ShieldAlert className="h-4 w-4" />}>
              <div className="space-y-2">
                {SAFE_CATEGORY_RULES.map(([category, watch, paper, live]) => (
                  <div key={category} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <div className="font-semibold text-slate-100">{category}</div>
                    <div className="mt-2 space-y-1 text-[11px] text-slate-400">
                      <div>{watch}</div>
                      <div>{paper}</div>
                      <div>{live}</div>
                    </div>
                  </div>
                ))}
              </div>
              {!cryptoData.categories && (
                <p className="mt-3 text-[11px] leading-relaxed text-amber-200/80">
                  Coin izin yapılandırması bağlı değil. Güvenli varsayılanlar gösteriliyor.
                </p>
              )}
            </CryptoPanel>
          </aside>
        </div>
      </div>
    </div>
  );
}

type MarketSnapshot = {
  price?: number;
  rsi?: number;
  atr?: number;
  volume?: number;
  trend?: string;
  macd_signal?: string;
  timestamp?: string;
};

function CryptoMarketTerminal({
  symbols,
  observerRunning,
  marketOnline,
  lastChecked,
  markets,
  risk,
  overview,
}: {
  symbols: CryptoSymbolPermission[];
  observerRunning: boolean;
  marketOnline: boolean;
  lastChecked: string;
  markets?: Record<string, MarketSnapshot>;
  risk?: Record<string, any>;
  overview?: Record<string, any>;
}) {
  const [selectedSymbol, setSelectedSymbol] = React.useState(symbols[0]?.symbol ?? 'BTC/USDT');
  const marketMap = markets && typeof markets === 'object' ? markets : {};
  const radarSymbols = React.useMemo(() => symbols.slice(0, 12), [symbols]);
  const rows = radarSymbols.map((symbol) => ({
    ...symbol,
    market: marketMap[symbol.symbol] ?? {},
  }));
  const selected = radarSymbols.find((symbol) => symbol.symbol === selectedSymbol) ?? radarSymbols[0];
  const selectedMarket = marketMap[selected?.symbol ?? ''] ?? {};
  const marketValues = rows.filter((row) => typeof row.market.price === 'number');
  const bullishCount = rows.filter((row) => String(row.market.trend ?? '').toLowerCase().includes('bull')).length;
  const bearishCount = rows.filter((row) => String(row.market.trend ?? '').toLowerCase().includes('bear')).length;
  const avgRsi = average(rows.map((row) => row.market.rsi));
  const atrPctValues = rows.map((row) => percentOf(row.market.atr, row.market.price));
  const avgAtrPct = average(atrPctValues);
  const volumes = rows.map((row) => Number(row.market.volume ?? 0));
  const maxVolume = Math.max(...volumes, 1);
  const volumeIndex = volumes.reduce((sum, value) => sum + value, 0);
  const exposurePct = Number(risk?.exposure_ratio ?? 0) * 100;
  const drawdownPct = Number(risk?.drawdown_pct ?? 0);
  const regime = bullishCount > bearishCount ? 'YÜKSELİŞ' : bearishCount > bullishCount ? 'DÜŞÜŞ' : 'KARIŞIK';
  const selectedAtrPct = percentOf(selectedMarket.atr, selectedMarket.price);
  const selectedVolumePct = Math.round((Number(selectedMarket.volume ?? 0) / maxVolume) * 100);

  return (
    <div className="space-y-2 font-mono" data-testid="crypto-market-terminal">
      <div className="rounded-md border border-white/10 bg-[#080806]">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            CRYPTOBASE <span className="text-amber-400">/ DEMO GÖZLEM TERMİNALİ</span>
          </div>
          <div className="text-[9px] uppercase tracking-wide text-slate-500">
            {observerRunning ? 'OBSERVER ÇALIŞIYOR' : 'OBSERVER DURDU'} / {lastChecked}
          </div>
        </div>
        <div className="grid grid-cols-2 border-b border-white/10 lg:grid-cols-5">
          <TerminalMetric title="Rejim" value={regime} detail={`${bullishCount} güçlü / ${bearishCount} zayıf`} tone={regime === 'YÜKSELİŞ' ? 'green' : regime === 'DÜŞÜŞ' ? 'amber' : 'cyan'} values={rows.map((row) => row.market.rsi ?? 50)} />
          <TerminalMetric title="Trend Gücü" value={`${Math.round((bullishCount / Math.max(rows.length, 1)) * 100)}%`} detail={`${marketValues.length}/${rows.length} canlı varlık`} tone="cyan" values={rows.map((row) => row.market.rsi ?? 50)} />
          <TerminalMetric title="Ortalama RSI" value={Number.isFinite(avgRsi) ? avgRsi.toFixed(1) : '--'} detail={avgRsi >= 60 ? 'momentum yüksek' : avgRsi <= 40 ? 'baskı yüksek' : 'nötr bant'} tone={avgRsi >= 60 ? 'green' : avgRsi <= 40 ? 'amber' : 'cyan'} values={rows.map((row) => row.market.rsi ?? 50)} />
          <TerminalMetric title="ATR Volatilite" value={`${Number.isFinite(avgAtrPct) ? avgAtrPct.toFixed(2) : '--'}%`} detail="ortalama atr / fiyat" tone="amber" values={atrPctValues.map((value) => value * 100)} />
          <TerminalMetric title="Likidite Endeksi" value={compactNumber(volumeIndex)} detail={marketOnline ? 'public piyasa feed' : 'feed beklemede'} tone="green" values={volumes} />
        </div>
        <div className="border-b border-amber-400/15 bg-amber-400/[0.035] px-3 py-1.5 text-center text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-500/80">
          GERÇEK PİYASA SİNYALLERİ / SADECE DEMO / GERÇEK EMİR YOK / CANLI TRADING KİLİTLİ
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[1fr_1.05fr]">
        <div className="rounded-md border border-white/10 bg-[#0a0a08]">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-100">Crypto Sinyalleri</div>
              <div className="text-[9px] uppercase text-slate-500">çubuklar mevcut gösterge gücünü gösterir</div>
            </div>
            <div className="text-[10px] text-cyan-300">{marketValues.length} canlı</div>
          </div>
          <div className="grid grid-cols-2 gap-px bg-white/10 p-px">
            {rows.slice(0, 12).map((row) => {
              const rsi = Number(row.market.rsi ?? 50);
              const strength = Math.max(8, Math.min(100, Math.round(rsi)));
              const mode = String((row as any).mode ?? '').toUpperCase();
              const analysisAllowed = Boolean((row as any).analysisEnabled ?? row.decision ?? row.watch);
              const blocked = mode === 'DISABLED' || !analysisAllowed || row.approvalRequired;
              return (
                <button
                  key={row.symbol}
                  type="button"
                  onClick={() => setSelectedSymbol(row.symbol)}
                  className={`min-h-[4.3rem] bg-[#11110f] p-2 text-left transition hover:bg-[#171712] ${selected?.symbol === row.symbol ? 'outline outline-1 outline-cyan-300/70' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[10px] font-semibold text-slate-100">{row.symbol}</div>
                    <div className={`rounded border px-1.5 py-0.5 text-[8px] uppercase ${blocked ? 'border-amber-400/40 text-amber-300' : String(row.market.trend).toLowerCase().includes('bull') ? 'border-emerald-400/35 text-emerald-300' : 'border-cyan-400/35 text-cyan-300'}`}>
                      {blocked ? 'kapalı' : row.market.trend ?? 'izle'}
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-black/50">
                    <div className={blocked ? 'h-full bg-amber-400' : 'h-full bg-emerald-400'} style={{ width: `${strength}%` }} />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-[9px] text-slate-500">
                    <span>RSI <b className="text-slate-300">{formatNumber(row.market.rsi, 1)}</b></span>
                    <span>ATR <b className="text-slate-300">{formatNumber(percentOf(row.market.atr, row.market.price), 2)}%</b></span>
                    <span>VOL <b className="text-slate-300">{Math.round((Number(row.market.volume ?? 0) / maxVolume) * 100)}%</b></span>
                  </div>
                </button>
              );
            })}
            {rows.length % 2 === 1 && <div className="min-h-[4.3rem] bg-[#11110f]" aria-hidden="true" />}
          </div>
        </div>

        <div className="rounded-md border border-white/10 bg-[#0a0a08]">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-100">Gösterge Dağılımı</div>
              <div className="text-[9px] uppercase text-slate-500">varlık bazında RSI / ATR% / göreli hacim</div>
            </div>
            <span className="rounded border border-white/10 px-2 py-1 text-[9px] uppercase text-slate-400">
              Anlık
            </span>
          </div>
          <SignalSpreadChart
            labels={rows.map((row) => row.symbol.replace('/USDT', ''))}
            series={[
              { name: 'RSI', color: '#22d3ee', values: rows.map((row) => row.market.rsi ?? 50) },
              { name: 'ATR%', color: '#f59e0b', values: atrPctValues.map((value) => value * 100) },
              { name: 'VOL', color: '#f472b6', values: volumes.map((value) => (value / maxVolume) * 100) },
            ]}
          />
          <div className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 p-px text-[10px]">
            <TerminalReadout label="Seçili" value={selected?.symbol ?? 'bağlı değil'} />
            <TerminalReadout label="Fiyat" value={formatMoney(selectedMarket.price)} />
            <TerminalReadout label="RSI" value={formatNumber(selectedMarket.rsi, 2)} />
            <TerminalReadout label="ATR / Price" value={`${formatNumber(selectedAtrPct, 2)}%`} />
            <TerminalReadout label="Hacim Endeksi" value={`${selectedVolumePct}%`} />
            <TerminalReadout label="Risk Motoru" value={String(risk?.risk_level ?? selected?.risk ?? 'bağlı değil')} />
            <TerminalReadout label="Maruziyet" value={`${formatNumber(exposurePct, 2)}%`} />
            <TerminalReadout label="Drawdown" value={`${formatNumber(drawdownPct, 2)}%`} />
            <TerminalReadout label="Demo İşlem" value={String(overview?.stats?.total_trades ?? 'bağlı değil')} />
            <TerminalReadout label="Emir" value="KİLİTLİ" danger />
          </div>
        </div>
      </div>
    </div>
  );
}

function TerminalMetric({ title, value, detail, tone, values }: { title: string; value: string; detail: string; tone: 'cyan' | 'green' | 'amber'; values: Array<number | undefined> }) {
  const toneClass = {
    cyan: 'text-cyan-300',
    green: 'text-emerald-300',
    amber: 'text-amber-300',
  }[tone];
  return (
    <div className="min-h-[5.5rem] border-r border-white/10 px-3 py-2 last:border-r-0">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
      <div className="text-[9px] uppercase text-slate-500">{detail}</div>
      <Sparkline values={values} color={tone === 'green' ? '#34d399' : tone === 'amber' ? '#f59e0b' : '#22d3ee'} />
    </div>
  );
}

function Sparkline({ values, color }: { values: Array<number | undefined>; color: string }) {
  const nums = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const points = polylinePoints(nums.length > 1 ? nums : [0, 0], 150, 24, 3);
  return (
    <svg viewBox="0 0 150 24" className="mt-1 h-6 w-full" role="img" aria-label="Real market metric sparkline">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}

function SignalSpreadChart({ labels, series }: { labels: string[]; series: Array<{ name: string; color: string; values: number[] }> }) {
  return (
    <div className="p-3">
      <svg viewBox="0 0 360 190" className="h-[13.5rem] w-full" role="img" aria-label="Real crypto indicator spread chart">
        {[0, 1, 2, 3, 4].map((line) => (
          <line key={`h-${line}`} x1="22" x2="344" y1={24 + line * 32} y2={24 + line * 32} stroke="rgba(148,163,184,0.13)" />
        ))}
        {labels.map((label, index) => {
          const x = 28 + (index / Math.max(labels.length - 1, 1)) * 306;
          return (
            <g key={label}>
              <line x1={x} x2={x} y1="20" y2="154" stroke="rgba(148,163,184,0.08)" />
              <text x={x} y="174" textAnchor="middle" fill="rgb(100,116,139)" fontSize="8">{label}</text>
            </g>
          );
        })}
        {series.map((item) => (
          <polyline key={item.name} points={polylinePoints(item.values, 322, 132, 22, 20)} fill="none" stroke={item.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      <div className="flex flex-wrap gap-2 text-[9px] uppercase text-slate-500">
        {series.map((item) => (
          <span key={item.name} className="inline-flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-sm" style={{ backgroundColor: item.color }} />
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function CryptoStatusBar({
  initialCapital,
  serviceOnline,
  marketOnline,
  newsOnline,
  ollamaOnline,
  obsidianReady,
  selectedModel,
  demoLoopLabel,
  lastAnalysisTime,
}: {
  initialCapital: string;
  serviceOnline: boolean;
  marketOnline: boolean;
  newsOnline: boolean;
  ollamaOnline: boolean;
  obsidianReady: boolean;
  selectedModel: string;
  demoLoopLabel: string;
  lastAnalysisTime: string;
}) {
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
      <StatusPill label="DEMO MODE" tone={serviceOnline ? 'success' : 'warning'} value={serviceOnline ? 'SERVICE READY' : 'SERVICE OFFLINE'} />
      <StatusPill label="STARTING CAPITAL" tone="info" value={initialCapital} />
      <StatusPill label="REAL MONEY" tone="danger" value="OFF" />
      <StatusPill label="LIVE EXECUTION" tone="danger" value="LOCKED" />
      <StatusPill label="BINANCE DATA" tone={marketOnline ? 'success' : 'warning'} value={marketOnline ? 'READ-ONLY ONLINE' : 'OFFLINE / WAITING'} />
      <StatusPill label="NEWS" tone={newsOnline ? 'success' : 'muted'} value={newsOnline ? 'ACTIVE' : 'OFFLINE / EMPTY'} />
      <StatusPill label="OLLAMA" tone={ollamaOnline ? 'success' : 'warning'} value={ollamaOnline ? selectedModel : 'UNAVAILABLE'} />
      <StatusPill label="OBSIDIAN" tone={obsidianReady ? 'success' : 'warning'} value={obsidianReady ? 'SYNC READY' : 'NOT CONFIGURED'} />
      <div className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 sm:col-span-2 xl:col-span-4 2xl:col-span-8">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">
          <span>Demo döngü: {demoLoopLabel}</span>
          <span>Son analiz: {lastAnalysisTime}</span>
        </div>
      </div>
    </div>
  );
}

function CryptoAnimatedMetric({ label, value, tone }: { label: string; value: string; tone: 'cyan' | 'green' | 'amber' | 'slate' }) {
  const toneClass = {
    cyan: 'border-cyan-300/22 bg-cyan-300/10 text-cyan-100',
    green: 'border-emerald-300/22 bg-emerald-300/10 text-emerald-100',
    amber: 'border-amber-300/24 bg-amber-300/10 text-amber-100',
    slate: 'border-white/10 bg-white/[0.04] text-slate-200',
  }[tone];
  return (
    <div className={`edith-crypto-metric-glow rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-65">{label}</div>
      <div className="mt-1 truncate font-mono text-xs font-semibold">{value}</div>
    </div>
  );
}

function CryptoEmptyState({ title, text, icon }: { title: string; text: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-cyan-300/20 bg-cyan-300/[0.035] p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
          {icon ?? <AlertTriangle className="h-4 w-4" />}
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-100">{title}</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{text}</p>
        </div>
      </div>
    </div>
  );
}

function CryptoActivityWaveform({ active }: { active: boolean }) {
  return (
    <div className={`edith-crypto-waveform mt-3 ${active ? 'is-active' : ''}`} aria-hidden="true">
      {Array.from({ length: 18 }).map((_, index) => (
        <span key={index} style={{ animationDelay: `${index * 80}ms` }} />
      ))}
    </div>
  );
}

function TerminalReadout({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-2 bg-[#11110f] px-3 py-2">
      <span className="uppercase text-slate-500">{label}</span>
      <span className={danger ? 'font-semibold text-red-300' : 'text-slate-200'}>{value}</span>
    </div>
  );
}

function average(values: Array<number | undefined>): number {
  const nums = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!nums.length) return NaN;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function percentOf(value: unknown, base: unknown): number {
  const num = Number(value);
  const den = Number(base);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return (num / den) * 100;
}

function formatNumber(value: unknown, digits = 0): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

function formatMoney(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  if (Math.abs(num) < 1) return num.toFixed(4);
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '--';
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function polylinePoints(values: number[], width: number, height: number, pad = 0, offsetX = 0): string {
  const nums = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  return nums.map((value, index) => {
    const x = offsetX + pad + (index / Math.max(nums.length - 1, 1)) * (width - pad * 2);
    const y = pad + (1 - ((value - min) / range)) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function CryptoPerformancePanel({
  totalTrades,
  closedTrades,
  noTradeCount,
  bestDecision,
  worstDecision,
  strongestLesson,
  hasHistory,
}: {
  totalTrades: number;
  closedTrades: number;
  noTradeCount: number;
  bestDecision: unknown;
  worstDecision: unknown;
  strongestLesson: unknown;
  hasHistory: boolean;
}) {
  return (
    <CryptoPanel title="Performance / Lessons" eyebrow={hasHistory ? 'DEMO HISTORY' : 'NOT ENOUGH HISTORY YET'} icon={<Sparkles className="h-4 w-4" />}>
      {hasHistory ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <CryptoAnimatedMetric label="Demo trades" value={String(totalTrades)} tone="cyan" />
            <CryptoAnimatedMetric label="Closed" value={String(closedTrades)} tone="slate" />
            <CryptoAnimatedMetric label="No-trade" value={String(noTradeCount)} tone="green" />
            <CryptoAnimatedMetric label="Risk mode" value="LOCKED" tone="amber" />
          </div>
          <div className="grid grid-cols-1 gap-2 text-xs">
            <ActionRow label="Best decision" value={String(bestDecision ?? 'backend bildirmedi')} />
            <ActionRow label="Worst decision" value={String(worstDecision ?? 'backend bildirmedi')} />
            <ActionRow label="Strongest learned pattern" value={String(strongestLesson ?? 'öğrenme notu bekleniyor')} />
          </div>
        </div>
      ) : (
        <CryptoEmptyState
          title="Not enough demo history yet"
          text="E.D.I.T.H. analizler ve demo sonuçları biriktikçe performans derslerini burada gösterecek. Şimdilik kâr, başarı veya haber etkisi uydurulmuyor."
          icon={<Sparkles className="h-4 w-4" />}
        />
      )}
    </CryptoPanel>
  );
}

function CryptoPanel({
  title,
  eyebrow,
  icon,
  children,
  className = '',
}: {
  title: string;
  eyebrow?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`edith-crypto-panel-reveal relative overflow-hidden rounded-lg border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.74),rgba(2,6,12,0.88))] shadow-[0_18px_55px_rgba(0,0,0,0.24)] backdrop-blur-xl ${className}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/45 to-transparent" />
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon && <div className="edith-icon-cell">{icon}</div>}
          <div className="min-w-0">
            {eyebrow && <div className="edith-eyebrow">{eyebrow}</div>}
            <h3 className="truncate text-sm font-semibold text-slate-100">{title}</h3>
          </div>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function CryptoMetric({ label, value, tone }: { label: string; value: string; tone: 'cyan' | 'green' | 'amber' | 'slate' }) {
  const toneClass = {
    cyan: 'border-cyan-300/22 bg-cyan-300/10 text-cyan-100',
    green: 'border-emerald-300/22 bg-emerald-300/10 text-emerald-100',
    amber: 'border-amber-300/24 bg-amber-300/10 text-amber-100',
    slate: 'border-white/10 bg-white/[0.04] text-slate-200',
  }[tone];
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-65">{label}</div>
      <div className="mt-1 truncate font-mono text-xs font-semibold">{value}</div>
    </div>
  );
}

function ControlReadout({
  label,
  value,
  tone,
  pulse = false,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'danger' | 'muted' | 'info';
  pulse?: boolean;
}) {
  const toneClass = {
    info: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
    success: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
    warning: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
    danger: 'border-red-300/30 bg-red-300/10 text-red-100',
    muted: 'border-white/10 bg-white/[0.04] text-slate-300',
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide opacity-70">
        <span className={`h-2 w-2 rounded-full bg-current shadow-[0_0_10px_currentColor] ${pulse ? 'animate-pulse' : ''}`} />
        {label}
      </div>
      <div className="mt-2 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function MiniFlag({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/45 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-[11px] ${good ? 'text-emerald-300' : 'text-amber-300'}`}>{value}</div>
    </div>
  );
}

function SafetyLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-white/10 bg-slate-950/45 px-3 py-2 text-xs text-slate-300">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
      <span>{label}</span>
    </div>
  );
}

export function FileSendPanel({fileId,disabled=false}: {fileId:string;disabled?:boolean}) {
  const [bridge]=React.useState(()=>new CrossDeviceDesktopBridge());
  const [snapshot,setSnapshot]=React.useState<CrossDeviceBridgeSnapshot>();
  const [sendStatus,setSendStatus]=React.useState('unverified');
  const [deviceId,setDeviceId]=React.useState('');
  const [target,setTarget]=React.useState<FileSendTarget>();
  const [accepted,setAccepted]=React.useState<FileSendResult>();
  const [checkpoint,setCheckpoint]=React.useState<FileSendCheckpoint>();
  const [message,setMessage]=React.useState('Mobil hedef seçin; telefon teslimatı henüz doğrulanmadı.');
  const [pending,setPending]=React.useState(false);
  const epoch=React.useRef(0),actionAbort=React.useRef<AbortController>(),scope=React.useRef(''),selected=React.useRef('');
  const operation=React.useRef<{fileId:string;target:FileSendTarget;key:string}>();
  const invalidate=React.useCallback(()=>{++epoch.current;actionAbort.current?.abort();bridge.clearFileSendTarget();operation.current=undefined;setTarget(undefined);setAccepted(undefined);setCheckpoint(undefined);setPending(false);},[bridge]);
  React.useEffect(()=>{const abort=new AbortController();let live=true,polling=false;
    const poll=async()=>{if(polling)return;polling=true;try {const [next,status]=await Promise.all([bridge.refreshFileSendCandidates(abort.signal),fetchFilesStatus(abort.signal)]);if(!live)return;
      const candidate=next.devices.find(device=>device.deviceId===selected.current);
      const nextScope=JSON.stringify([next.tauriAvailable,next.ownerAuthorized,next.killSwitchActive,candidate?.deviceId,candidate?.workspaceId,candidate?.ownerSessionBindingId,candidate?.ownerBindingExpiresAt]);
      const ready=next.tauriAvailable&&next.backendAvailable&&next.ownerAuthorized&&next.producer.configured&&next.killSwitchActive===false&&next.native?.pcToMobileTransfer==='available'&&next.native.controlPlaneConnected===true&&status.actions.send==='native_adapter_available';
      if(scope.current&&scope.current!==nextScope||!ready||operation.current&&Date.parse(operation.current.target.expiresAt)<=Date.now()){invalidate();if(selected.current&&!candidate){selected.current='';setDeviceId('');}setMessage('Gönderim kapsamını ve native bağlantıyı yeniden doğrulayın.');}
      scope.current=nextScope;setSnapshot(next);setSendStatus(status.actions.send);
    }catch{if(live){invalidate();setSnapshot(undefined);setSendStatus('unverified');setMessage('Mobil gönderim durumu doğrulanamadı.');}}finally{polling=false;}};
    invalidate();void poll();const timer=window.setInterval(()=>void poll(),10_000);
    return()=>{live=false;abort.abort();window.clearInterval(timer);++epoch.current;actionAbort.current?.abort();bridge.clearFileSendTarget();operation.current=undefined;};
  },[bridge,fileId,invalidate]);
  const candidate=snapshot?.devices.find(device=>device.deviceId===deviceId);
  const ready=!!candidate&&candidate.trustStatus==='trusted'&&Date.parse(candidate.ownerBindingExpiresAt??'')>Date.now()&&snapshot?.devices.filter(device=>device.deviceId===deviceId).length===1&&snapshot.tauriAvailable===true&&snapshot.backendAvailable===true&&snapshot.ownerAuthorized===true&&snapshot.producer.configured===true&&snapshot.killSwitchActive===false&&snapshot.native?.pcToMobileTransfer==='available'&&snapshot.native.controlPlaneConnected===true&&sendStatus==='native_adapter_available';
  const currentTarget=target&&target.deviceId===deviceId&&Date.parse(target.expiresAt)>Date.now();
  const perform=async(kind:'prepare'|'send'|'checkpoint')=>{if(disabled||pending||!ready)return;
    if(kind==='prepare')invalidate();
    actionAbort.current?.abort();const abort=new AbortController();actionAbort.current=abort;const request=++epoch.current;setPending(true);
    const live=()=>request===epoch.current&&!abort.signal.aborted;
    try {if(kind==='prepare'){const prepared=await bridge.prepareFileSendTarget(deviceId,abort.signal);if(!live())return;
        setTarget(prepared);operation.current={fileId,target:prepared,key:crypto.randomUUID()};setMessage('Seçili mobil hedef için native gönderici hazır. Teslimat doğrulanmadı.');setPending(false);return;}
      if(!target||!currentTarget)throw new Error('Gönderici hedefini yeniden hazırlayın.');await bridge.recheckFileSendTarget(target,abort.signal);if(!live())return;
      if(kind==='send'){const logical=operation.current;if(!logical||logical.fileId!==fileId||logical.target!==target)throw new Error('Gönderim kapsamını yeniden hazırlayın.');
        const result=await sendFile(fileId,{deviceId:target.deviceId,idempotencyKey:logical.key,signal:abort.signal});if(!live())return;await bridge.recheckFileSendTarget(target,abort.signal);if(!live())return;
        setAccepted(result);setCheckpoint(undefined);setMessage('Gönderim kabul edildi. Telefonda kalıcı alıcı kaydı henüz doğrulanmadı.');
      }else {if(!accepted)return;const result=await bridge.readFileSendCheckpoint(target,accepted.descriptor,abort.signal);if(!live())return;setCheckpoint(result);setMessage(result.durableReceiverCommit?'Telefonda kalıcı alıcı kaydı doğrulandı.':'Alıcı tamamlanması doğrulanmadı; bayt ilerlemesi teslimat değildir.');}
    }catch(cause){if(live()){setCheckpoint(undefined);setAccepted(undefined);if(cause instanceof CrossDeviceBridgeError)invalidate();setMessage(cause instanceof Error?cause.message:'Mobil gönderim tamamlanmadı.');}}
    finally{if(live())setPending(false);}
  };
  return <section aria-label="Seçili dosyayı telefona gönder" className="space-y-2 rounded border border-white/10 p-3 text-xs">
    <label>Mobil hedef<select aria-label="Dosya gönderim mobil hedefi" value={deviceId} disabled={pending||disabled} onChange={event=>{invalidate();selected.current=event.target.value;setDeviceId(event.target.value);scope.current='';setMessage('Hedef seçildi; native göndericiyi hazırlayın.');}} className="ml-2 max-w-full rounded bg-slate-950 p-2"><option value="">Hedef seçin</option>{snapshot?.devices.map(device=><option key={device.deviceId} value={device.deviceId}>{device.displayName} · {device.deviceId}</option>)}</select></label>
    <div className="flex flex-wrap gap-2"><button disabled={disabled||pending||!ready} onClick={()=>void perform('prepare')} className="rounded border border-white/10 p-2 disabled:opacity-40">Gönderici hedefini hazırla</button>
    <button disabled={disabled||pending||!ready||!currentTarget} onClick={()=>void perform('send')} className="rounded border border-white/10 p-2 disabled:opacity-40">{accepted?'Aynı gönderimi yeniden dene':'Telefona gönder'}</button>
    <button disabled={disabled||pending||!ready||!currentTarget||!accepted} onClick={()=>void perform('checkpoint')} className="rounded border border-white/10 p-2 disabled:opacity-40">Alıcı kaydını doğrula</button>
    <button onClick={()=>{invalidate();setMessage('Yerel görünüm iptal edildi; native aktarım iptal edilmedi.');}} className="rounded border border-white/10 p-2">Yerel görünümü iptal et</button></div>
    <p role="status">{pending?'Gönderim kapsamı doğrulanıyor…':message}</p><p>Native gönderim: {sendStatus}{!isTauriShell()?' · Tauri masaüstü gerekli.':''}</p>
    {accepted&&<div className="break-words"><p>Aktarım: {accepted.transferId} · {accepted.descriptor.sizeBytes} bytes</p><p>Native kaynak SHA-256: {accepted.descriptor.sha256}</p><p>{checkpoint?`${checkpoint.acknowledgedBytes} bytes · ${checkpoint.status} · ${checkpoint.durableReceiverCommit?'kalıcı alıcı kaydı doğrulandı':'teslimat doğrulanmadı'}`:'Kabul edildi · teslimat doğrulanmadı'}</p></div>}
  </section>;
}

export function FilesScreen({onExplorerRequest,undoReceipt}: {onExplorerRequest?: (request: ComputerAppWorkflowRequest) => void; undoReceipt?: ExplorerUndoReceipt} = {}) {
  const taskActivity = useSharedTaskActivity();
  const reaContext = React.useMemo(() => ({observer: taskActivity.observer, generation: taskActivity.snapshot.scopeGeneration,
    workspaceId: taskActivity.snapshot.workspaceId}), [taskActivity.observer, taskActivity.snapshot.scopeGeneration, taskActivity.snapshot.workspaceId]);
  const reaContextRef = React.useRef(reaContext); reaContextRef.current = reaContext;
  const reaMounted = React.useRef(false);
  const reaRevokedObserver = React.useRef<typeof taskActivity.observer>();
  const reaScope = reaContext.workspaceId && reaRevokedObserver.current !== reaContext.observer ? reaContext.generation + ':' + reaContext.workspaceId : undefined;
  const reaContextCurrent = () => {const live = reaContext.observer.getSnapshot();return reaContextRef.current === reaContext
    && reaMounted.current && reaRevokedObserver.current !== reaContext.observer
    && live.scopeGeneration === reaContext.generation && live.workspaceId === reaContext.workspaceId && !!live.workspaceId;};
  const reaController = React.useMemo(() => {
    const observer = taskActivity.observer;
    return createReaSelectionController({scope: () => {const live = observer.getSnapshot();return reaMounted.current && reaContextRef.current.observer === observer && reaRevokedObserver.current !== observer && live.workspaceId
      ? live.scopeGeneration + ':' + live.workspaceId : undefined;}});
  }, [taskActivity.observer]);
  const reaSnapshot = React.useSyncExternalStore(reaController.subscribe, reaController.getSnapshot, reaController.getSnapshot);
  const reaVisible = reaSnapshot.scope === reaScope && !!reaScope;
  const [reaTarget, setReaTarget] = React.useState('');
  const [reaProfile, setReaProfile] = React.useState<ReaLocalProfile | ''>('');
  const [reaConfirmed, setReaConfirmed] = React.useState<{context: typeof reaContext; selectionRef: string; id: string; kind: 'file'|'directory'; name: string; profile: ReaLocalProfile}>();
  const [filesContext, setFilesContext] = React.useState<typeof reaContext>();
  const [directoriesContext, setDirectoriesContext] = React.useState<typeof reaContext>();
  const filesRead = React.useRef<AbortController>();
  React.useEffect(() => {
    reaMounted.current = true;
    let lastScope = reaScope;
    const invalidate = () => {reaController.invalidate();setReaTarget('');setReaProfile('');setReaConfirmed(undefined);};
    const unsubscribe = taskActivity.observer.subscribe(() => {const live = taskActivity.observer.getSnapshot();
      const next = live.workspaceId ? live.scopeGeneration + ':' + live.workspaceId : undefined;
      if (next !== lastScope) {lastScope = next;invalidate();filesRead.current?.abort();}
    });
    const logout = () => {reaRevokedObserver.current = taskActivity.observer;invalidate();filesRead.current?.abort();setFilesContext(undefined);setDirectoriesContext(undefined);};
    window.addEventListener('edith-owner-logout', logout);
    return () => {reaMounted.current = false;unsubscribe();window.removeEventListener('edith-owner-logout', logout);filesRead.current?.abort();reaController.invalidate();};
  }, [reaController, taskActivity.observer]);
  React.useEffect(() => {reaController.invalidate();setReaTarget('');setReaProfile('');setReaConfirmed(undefined);}, [reaController, reaContext]);
  const [state, setState] = React.useState<FilesSurfaceState>('loading');
  const [status, setStatus] = React.useState<FilesStatus>();
  const [files, setFiles] = React.useState<FileEntry[]>([]);
  const [content, setContent] = React.useState<FileContent>();
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState('');
  const [truncated, setTruncated] = React.useState(false);
  const [summary, setSummary] = React.useState('');
  const [openMessage, setOpenMessage] = React.useState('');
  const [cloudConsent, setCloudConsent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState<FileEntry>();
  const [directories, setDirectories] = React.useState<ExplorerDirectory[]>([]);
  const [destinationId, setDestinationId] = React.useState('');
  const [explorerStatus, setExplorerStatus] = React.useState<ExplorerStatus>();
  const [explorerState, setExplorerState] = React.useState('loading');
  const [explorerConsent, setExplorerConsent] = React.useState(false);
  const [explorerError, setExplorerError] = React.useState('');
  const [receiptClock, setReceiptClock] = React.useState(Date.now());
  React.useEffect(()=>{
    const abort = new AbortController();let live=true;
    setDirectories([]);setDirectoriesContext(undefined);setExplorerState('loading');
    void Promise.all([fetchExplorerDirectories('',abort.signal),fetchExplorerStatus(abort.signal)]).then(([result,status])=>{
      if(!live||!reaContextCurrent())return;setDirectories(result.directories);setDirectoriesContext(reaContext);setExplorerStatus(status);setExplorerState(result.truncated?'truncated':'ready');
    }).catch(cause=>{if(live&&reaContextCurrent()){setExplorerState(filesErrorState(cause));setExplorerError(cause instanceof FilesClientError?cause.message:'Explorer model unavailable.');}});
    return()=>{live=false;abort.abort();};
  },[reaContext]);
  React.useEffect(()=>{setExplorerConsent(false);setReceiptClock(Date.now());if(!undoReceipt)return;const timer=window.setInterval(()=>setReceiptClock(Date.now()),1000);return()=>window.clearInterval(timer);},[undoReceipt]);
  const requestExplorer = (workflow: 'find' | 'copy' | 'move' | 'undo') => {
    if (!onExplorerRequest || !explorerConsent || busy) return;
    let request: ComputerAppWorkflowRequest;
    if(workflow==='undo'){
      if(!undoReceipt || undoReceipt.expiresAt<=Date.now()){setExplorerError('EXPLORER_UNDO_UNAVAILABLE');return;}
      request={app:'explorer',workflow,undoReceiptId:undoReceipt.undoReceiptId};
    } else {
      if(!selectedFile || !files.some(f=>f.id===selectedFile.id))return;
      if(workflow==='find')request={app:'explorer',workflow,sourceFileId:selectedFile.id};
      else {
        const directory=directories.find(d=>d.id===destinationId&&d.rootId===selectedFile.root);
        if(!directory)return;
        request={app:'explorer',workflow,sourceFileId:selectedFile.id,destinationDirectoryId:directory.id};
      }
    }
    setExplorerConsent(false);setExplorerError('');onExplorerRequest(request);
  };
  const generation = React.useRef(0);
  const refresh = React.useCallback(async (search = '', recoveryMessage = '') => { const request = ++generation.current;filesRead.current?.abort();const abort=new AbortController();filesRead.current=abort;
    reaController.invalidate();setReaTarget('');setReaProfile('');setReaConfirmed(undefined);setFiles([]);setFilesContext(undefined);setBusy(true);setState('loading'); setContent(undefined);setSelectedFile(undefined);setDestinationId('');setExplorerConsent(false); setSummary('');setOpenMessage(''); setError(''); setCloudConsent(false);
    try { if(!reaContextCurrent())return;const nextStatus = await fetchFilesStatus(abort.signal); if (request !== generation.current||!reaContextCurrent()||abort.signal.aborted) return; setStatus(nextStatus);
      if (nextStatus.state==='configuration_required') {setFiles([]);setState('configuration_required');return;}
      const result = await searchFiles(search,abort.signal); if(request!==generation.current||!reaContextCurrent()||abort.signal.aborted)return;setFiles(result.files);setFilesContext(reaContext);setTruncated(result.truncated);setState(result.files.length?'ready':'empty');setError(recoveryMessage);void reaController.refreshStatus();
    } catch(cause) {if(request!==generation.current||!reaContextCurrent()||abort.signal.aborted)return;setFiles([]);setState(filesErrorState(cause));setError(cause instanceof FilesClientError?cause.message:'Dosya servisine ulaşılamadı.');}
    finally {if(request===generation.current)setBusy(false);}
  }, [reaContext, reaController]);
  React.useEffect(()=>{void refresh();return()=>{++generation.current;filesRead.current?.abort();};},[refresh]);
  const reaTargets = [
    ...(filesContext === reaContext ? files.map(file => ({key: 'file:' + file.id, id: file.id, kind: 'file' as const, name: file.name})) : []),
    ...(directoriesContext === reaContext ? directories.map(directory => ({key: 'directory:' + directory.id, id: directory.id, kind: 'directory' as const, name: directory.name})) : []),
  ];
  const reaChosen = reaTargets.find(target => target.key === reaTarget);
  const reaConfirmedCurrent = reaVisible && reaConfirmed?.context === reaContext && reaConfirmed.selectionRef === reaSnapshot.selection?.selectionRef ? reaConfirmed : undefined;
  const selectReaTarget = async () => {
    const target = reaTargets.find(candidate => candidate.key === reaTarget);
    if (!reaContextCurrent() || !target || !reaProfile || (target.kind === 'directory' && reaProfile !== 'static-javascript') || reaSnapshot.state === 'loading') return;
    const profile = reaProfile, prior = reaController.getSnapshot().selection?.selectionRef;
    await reaController.select({id: target.id, kind: target.kind}, profile);
    const selection = reaController.getSnapshot().selection;
    if (reaContextCurrent() && selection && selection.profile === profile && selection.selectionRef !== prior) {
      setReaConfirmed({context: reaContext, selectionRef: selection.selectionRef, id: target.id, kind: target.kind, name: target.name, profile});
    }
  };
  const choose=async(file:FileEntry)=>{const request=++generation.current;setSelectedFile(file);setDestinationId('');setExplorerConsent(false);setBusy(true);setState('loading');setContent(undefined);setSummary('');setOpenMessage('');setError('');setCloudConsent(false);
    try {if(!file.readable){setState('ready');return;}const result=await readFileContent(file.id);if(request===generation.current){setContent(result);setState('ready');}}
    catch(cause){if(request!==generation.current)return;if(cause instanceof FilesClientError&&cause.status===404){await refresh(query,'Dosya ID süresi doldu; liste yenilendi. Dosyayı yeniden seçin.');}else{setState(filesErrorState(cause));setError(cause instanceof FilesClientError?cause.message:'Dosya okunamadı.');}}
    finally{if(request===generation.current)setBusy(false);}
  };
  const action=async(kind:'open'|'summarize',cloud=false)=>{if(!content)return;const fileId=content.id;const request=++generation.current;setBusy(true);setError('');setSummary('');setOpenMessage('');
    try {
      let expectedOpenDigest: string | undefined;
      if (kind === 'open') {
        setOpenMessage('Yerel açma doğrulaması bekleniyor.');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content.text));
        expectedOpenDigest = [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
        if (request !== generation.current) return;
      }
      const result = await actOnFile(fileId,kind,{provider:cloud?'gemini':'ollama',allowCloud:cloud&&cloudConsent,expectedOpenDigest});
      if (request !== generation.current) return;
      if (kind === 'summarize' && 'summary' in result) setSummary(result.summary);
      if (kind === 'open') {setState('ready');setOpenMessage('Yerel açma: aynı dosya ve süreç receipt ile doğrulandı.');}
    }
    catch(cause){if(request!==generation.current)return;setOpenMessage('');if(cause instanceof FilesClientError&&cause.status===404){await refresh(query,'Dosya ID süresi doldu; liste yenilendi.');}else {if(kind==='open')setState(filesErrorState(cause));setError(cause instanceof FilesClientError?cause.message:'Dosya eylemi tamamlanmadı.');}}
    finally{if(request===generation.current)setBusy(false);}
  };
  return <ScreenFrame title="Files / Documents" icon={<Archive className="h-5 w-5" />} subtitle="Yerel kapsam · yalnız sunucunun verdiği dosya kimlikleri" variant="wide">
    <form onSubmit={event=>{event.preventDefault();void refresh(query);}} className="mb-4 flex min-w-0 flex-wrap items-end gap-2"><label className="min-w-0 flex-1 basis-40 text-xs">Dosya ara<input value={query} maxLength={160} onChange={event=>setQuery(event.target.value)} className="mt-1 block w-full min-w-0 rounded bg-slate-950 p-2" /></label><button disabled={busy||state==='loading'} className="min-h-8 shrink-0 rounded border border-white/10 px-3 text-xs">Ara / yenile</button></form>
    <p role="status" className="mb-4 text-xs text-amber-200">{error||state}{truncated?' · Sonuç sınırı; aramayı daraltın.':''}</p>
    <div className="grid gap-4 lg:grid-cols-2"><OSPanel title="Dosyalar" eyebrow="CANONICAL FILES" icon={<Archive className="h-4 w-4" />}>
      {files.map(file=><button key={file.id} disabled={busy} onClick={()=>void choose(file)} className="mb-2 block w-full break-words rounded border border-white/10 p-3 text-left text-xs disabled:opacity-40"><span>{file.root}/{file.relativePath}</span><p>{file.size} bytes · {file.modifiedAt}{!file.readable?' · Metin okuma desteklenmiyor':''}</p></button>)}
      {!files.length&&<EmptyState icon={<FileText className="h-4 w-4" />} title={state==='loading'?'Dosyalar yükleniyor':state==='configuration_required'?'Workspace yapılandırması gerekli':'Dosya sonucu yok'} text="Gerçek veri gelmeden dosya listesi üretilmez." />}
    </OSPanel><OSPanel title="Dosya İçeriği" eyebrow="UTF-8 READ" icon={<FileText className="h-4 w-4" />}>
      {content?<div className="space-y-3 text-xs"><p>{content.root}/{content.relativePath} · {content.bytes} bytes</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3">{content.text}</pre>
        <div className="flex flex-wrap gap-2"><button disabled={busy||status?.actions.open!=='native_adapter_available'} title={status?.actions.open==='native_adapter_available'?'':'FILES_NATIVE_OPEN_ADAPTER_UNAVAILABLE · Yerel açma entegrasyonu henüz mevcut değil'} onClick={()=>void action('open')} className="rounded border border-white/10 p-2 disabled:opacity-40">Aç</button>
        <button disabled={busy} onClick={()=>void action('summarize')} className="rounded border border-white/10 p-2 disabled:opacity-40">Yerel Ollama ile özetle</button></div>
        {openMessage&&<p role="status">{openMessage}</p>}
        <FileSendPanel fileId={content.id} disabled={busy}/>
        <p>Native açma: {status?.actions.open??'unverified'} · Mobil gönderim: {status?.actions.send??'unverified'}</p>
        <label className="block"><input type="checkbox" checked={cloudConsent} onChange={event=>setCloudConsent(event.target.checked)} /> Bu seçili dosyanın içeriğini Gemini bulutuna göndermeyi açıkça onaylıyorum.</label>
        <button disabled={!cloudConsent||busy} onClick={()=>void action('summarize',true)} className="rounded border border-white/10 p-2 disabled:opacity-40">Gemini ile özetle</button>
        {summary&&<p className="whitespace-pre-wrap break-words">{summary}</p>}
      </div>:<p className="text-xs text-slate-500">Okunabilir bir dosya seçin.</p>}
    </OSPanel></div>
    <OSPanel title="Analiz hedefi" icon={<Archive className="h-4 w-4" />}>
      <div className="space-y-3 text-xs">
        <p>Bu seçim, daha sonra Voice Room’da “bu uygulamayı analiz et” komutu için hedefi belirtir. Analiz başlatmaz.</p>
        <label className="block">İndeksteki hedef<select aria-label="Analiz için indeks hedefi" value={reaChosen ? reaTarget : ''} disabled={!reaScope||reaSnapshot.state==='loading'} onChange={event=>{setReaTarget(event.target.value);setReaProfile('');}} className="mt-1 block w-full rounded bg-slate-950 p-2"><option value="">Dosya veya klasör seçin</option>{reaTargets.map(target=><option key={target.key} value={target.key}>{target.kind==='directory'?'Klasör':'Dosya'}: {target.name}</option>)}</select></label>
        <label className="block">Yerel analiz profili<select aria-label="Yerel analiz profili" value={reaProfile} disabled={!reaChosen||reaSnapshot.state==='loading'} onChange={event=>setReaProfile(event.target.value as ReaLocalProfile | '')} className="mt-1 block w-full rounded bg-slate-950 p-2"><option value="">Profili açıkça seçin</option>{REA_LOCAL_PROFILES.filter(profile=>reaChosen?.kind!=='directory'||profile==='static-javascript').map(profile=><option key={profile} value={profile}>{profile}</option>)}</select></label>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={!reaChosen||!reaProfile||!reaScope||reaSnapshot.state==='loading'} onClick={selectReaTarget} className="rounded border border-white/10 p-2 disabled:opacity-40">Analiz hedefi olarak seç</button>
          <button type="button" disabled={!reaVisible||!reaSnapshot.selection||reaSnapshot.state==='loading'} onClick={()=>{if(reaContextCurrent())void reaController.forget();}} className="rounded border border-white/10 p-2 disabled:opacity-40">Seçimi unut</button></div>
        <p role="status">{!reaScope?'Çalışma alanı ve oturum bağlamı doğrulanmalı.':!reaVisible?'Bu görünümde doğrulanmış hedef seçimi yok.':reaSnapshot.error||(reaSnapshot.state==='selected'?'Hedef ön seçimi kaydedildi ('+reaSnapshot.selection?.profile+'); analiz başlatılmadı. Seçim süreyle sınırlıdır.':reaSnapshot.state==='loading'?'Seçim bilgisi doğrulanıyor…':reaSnapshot.state==='expired'?'Seçimin süresi doldu. Hedefi yeniden seçin.':'Bu görünümde doğrulanmış hedef seçimi yok.')}</p>
        {reaConfirmedCurrent&&<p>Kaydedilen hedef: {reaConfirmedCurrent.kind==='directory'?'Klasör':'Dosya'}: {reaConfirmedCurrent.name} · {reaConfirmedCurrent.profile}{(reaChosen?.id!==reaConfirmedCurrent.id||reaChosen.kind!==reaConfirmedCurrent.kind||reaProfile!==reaConfirmedCurrent.profile)&&<span> · Yeni seçim henüz kaydedilmedi.</span>}</p>}
        <p>Hedef veya profil değişiklikleri ancak seçim düğmesine basıldığında kaydedilir. Ekranı kapatmak sunucudaki seçimi silmez.</p>
        <p className="text-amber-200">Yerel analiz çalıştırıcısı henüz hazır değil. Hedef seçilmesi hazır veya tamamlanmış analiz anlamına gelmez.</p>
        {!reaTargets.length&&<p>Bu bağlamda güncel indeks hedefi yok. Dosya aramasını yenileyin; indeksin sağlamadığı hedef seçilemez.</p>}
      </div>
    </OSPanel>
    <OSPanel title="Explorer işlemleri" eyebrow="OPAQUE FILE / DIRECTORY" icon={<Archive className="h-4 w-4" />}>
      <div className="space-y-3 text-xs">
        <p>Kaynak: {selectedFile?selectedFile.root+'/'+selectedFile.relativePath:'Dosya seçilmedi'}</p>
        <label className="block">Hedef klasör<select aria-label="Explorer hedef klasörü" value={destinationId} disabled={busy||explorerState==='loading'} onChange={event=>{setDestinationId(event.target.value);setExplorerConsent(false);}} className="ml-2 max-w-full rounded bg-slate-950 p-2"><option value="">Klasör seçin</option>{directories.filter(d=>!selectedFile||d.rootId===selectedFile.root).map(d=><option key={d.id} value={d.id}>{d.rootId}/{d.relativePath}</option>)}</select></label>
        <p role="status">{explorerError||('Explorer model: '+explorerState+' · native: '+(explorerStatus?.consumerState??'unverified'))}</p>
        <p>İşlem Computer Use oturumuna aktarılır; aktif oturum yoksa mevcut yerel sahibi onayı gerekir. Üzerine yazma kapalı.</p>
        <label className="block"><input type="checkbox" checked={explorerConsent} onChange={event=>setExplorerConsent(event.target.checked)} /> Seçili Explorer işlemini onaylıyorum</label>
        <div className="flex flex-wrap gap-2">
          <button disabled={!onExplorerRequest||!explorerConsent||!selectedFile||busy} onClick={()=>requestExplorer('find')} className="rounded border border-white/10 p-2 disabled:opacity-40">Explorer’da bul</button>
          <button disabled={!onExplorerRequest||!explorerConsent||!selectedFile||!destinationId||busy} onClick={()=>requestExplorer('copy')} className="rounded border border-white/10 p-2 disabled:opacity-40">Kopyala</button>
          <button disabled={!onExplorerRequest||!explorerConsent||!selectedFile||!destinationId||busy} onClick={()=>requestExplorer('move')} className="rounded border border-white/10 p-2 disabled:opacity-40">Taşı</button>
          <button disabled={!onExplorerRequest||!explorerConsent||!undoReceipt||undoReceipt.expiresAt<=receiptClock||busy} onClick={()=>requestExplorer('undo')} className="rounded border border-white/10 p-2 disabled:opacity-40">Son işlemi geri al</button>
        </div>
        <p>{undoReceipt?(undoReceipt.expiresAt>receiptClock?'Geri alma receipt: '+undoReceipt.operationId+' · task '+undoReceipt.taskId:'Geri alma süresi doldu.'):'Doğrulanmış geri alma receipt yok.'}</p>
      </div>
    </OSPanel></ScreenFrame>;
}

export function SystemHealthScreen({ ollamaConnected = false, settings, tools = [], logs = [], providerHealth, providerProfiles = [] }: { ollamaConnected?: boolean; settings?: UserSettings; tools?: AutomationTool[]; logs?: ToolExecutionLog[]; providerHealth?: ProviderHealthSnapshot; providerProfiles?: ProviderProfile[] }) {
  const runningTools = tools.filter((tool) => tool.status === 'running').length;
  const safety = useInteractionSafetySnapshot();
  const [shellStatus, setShellStatus] = React.useState<DesktopShellStatus | null>(null);
  const [computerDesktopStatus, setComputerDesktopStatus] = React.useState<ComputerDesktopStatus | null>(null);
  const [backendOnline, setBackendOnline] = React.useState<boolean | null>(null);
  const [toolsHealth, setToolsHealth] = React.useState<Array<{ toolId: string; state: string; highRisk: boolean; enabled: boolean }>>([]);
  const [permissionMode, setPermissionMode] = React.useState<string>('PENDING');
  const [killSwitchActive, setKillSwitchActive] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function loadDiagnostics() {
      try {
        const shell = await getDesktopShellStatus();
        if (!cancelled) setShellStatus(shell);
      } catch {
        if (!cancelled) setShellStatus({ tauri: false });
      }
      try {
        const nativeStatus = await getComputerDesktopStatus();
        if (!cancelled) setComputerDesktopStatus(nativeStatus);
      } catch {
        if (!cancelled) setComputerDesktopStatus(null);
      }
      try {
        const response = await fetch(`/api/health?ollamaUrl=${encodeURIComponent(settings?.ollamaUrl ?? 'http://localhost:11434')}`);
        if (!cancelled) setBackendOnline(response.ok);
      } catch {
        if (!cancelled) setBackendOnline(false);
      }
      try {
        const response = await fetch('/api/edith/tools/health');
        const payload = await readJsonResponse(response);
        if (!cancelled) setToolsHealth(Array.isArray(payload.health) ? payload.health : []);
      } catch {
        if (!cancelled) setToolsHealth([]);
      }
      try {
        const response = await fetch('/api/edith/permissions/policy');
        const payload = await readJsonResponse(response);
        if (!cancelled) setPermissionMode(payload?.policy?.mode ? String(payload.policy.mode).toUpperCase() : 'PENDING');
      } catch {
        if (!cancelled) setPermissionMode('PENDING');
      }
      try {
        const response = await fetch('/api/edith/kill-switch');
        if (!response.ok) throw new Error('Kill switch status unavailable.');
        const payload = await readJsonResponse(response);
        if (!cancelled) setKillSwitchActive(Boolean(payload?.state?.active));
      } catch {
        if (!cancelled) setKillSwitchActive(null);
      }
    }
    loadDiagnostics();
    const desktopTimer = window.setInterval(async () => {
      try {
        const [nativeStatus, killSwitchResponse] = await Promise.all([
          getComputerDesktopStatus(),
          fetch('/api/edith/kill-switch'),
        ]);
        if (cancelled) return;
        setComputerDesktopStatus(nativeStatus);
        if (killSwitchResponse.ok) {
          const payload = await readJsonResponse(killSwitchResponse);
          if (!cancelled) setKillSwitchActive(Boolean(payload?.state?.active));
        }
      } catch {
        if (!cancelled) setComputerDesktopStatus(null);
      }
    }, 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(desktopTimer);
    };
  }, [settings?.ollamaUrl]);

  const providerTruthAvailable = providerHealth?.source === 'backend';
  const ollamaProfile = providerProfiles.find((profile) => profile.provider === 'ollama');
  const geminiProfile = providerProfiles.find((profile) => profile.provider === 'gemini');
  const browserMode = safety?.browser?.mode ?? 'READ_ONLY';
  const providerDiagnostic = (profile: ProviderProfile | undefined): 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'CONFIGURATION REQUIRED' | 'UNVERIFIED' => {
    if (!providerTruthAvailable || !profile) return 'UNVERIFIED';
    if (profile.status === 'available') return 'ONLINE';
    if (profile.status === 'configuration_required') return 'CONFIGURATION REQUIRED';
    if (profile.status === 'offline' || profile.status === 'unavailable') return 'OFFLINE';
    return 'DEGRADED';
  };
  const diagnosticRows: Array<[string, string, 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'CONFIGURATION REQUIRED' | 'BLOCKED' | 'UNVERIFIED']> = [
    ['Frontend', 'React/Vite UI mounted', 'ONLINE'],
    ['Backend', backendOnline === null ? 'pending health check' : backendOnline ? 'Express API responded' : 'local API unavailable', backendOnline === null ? 'DEGRADED' : backendOnline ? 'ONLINE' : 'OFFLINE'],
    ['Database', 'persistence health is not reported by this endpoint', 'UNVERIFIED'],
    ['Memory', settings?.memoryEnabled ? 'memory UI enabled' : 'disabled in settings', settings?.memoryEnabled ? 'DEGRADED' : 'OFFLINE'],
    ['Ollama', providerTruthAvailable ? (ollamaProfile?.notes || (ollamaConnected ? 'local provider reachable' : 'local provider unavailable')) : 'provider health not verified by backend', providerDiagnostic(ollamaProfile)],
    ['Gemini', providerTruthAvailable ? (geminiProfile?.notes || 'backend provider health response') : 'provider health not verified by backend', providerDiagnostic(geminiProfile)],
    ['Voice', safety?.voice?.stt ?? 'browser STT only after permission', 'CONFIGURATION REQUIRED'],
    ['Tauri shell', shellStatus?.tauri ? `desktop shell v${shellStatus.version ?? 'unknown'}` : 'browser/dev mode', shellStatus?.tauri ? 'ONLINE' : 'DEGRADED'],
    ['Tauri package build', safety?.desktopPackaging?.warning ?? 'Cargo detected or check pending', safety?.desktopPackaging?.tauriPackageBuildAvailable ? 'ONLINE' : 'CONFIGURATION REQUIRED'],
    ['Tool registry', `${toolsHealth.length || tools.length} tools visible; backend health ${toolsHealth.length ? 'reported' : 'unverified'}`, toolsHealth.length ? 'ONLINE' : 'DEGRADED'],
    ['Permissions', permissionMode, permissionMode === 'PENDING' ? 'UNVERIFIED' : permissionMode === 'FULL_ACCESS' ? 'DEGRADED' : 'ONLINE'],
    ['Kill switch', killSwitchActive === null ? 'pending' : killSwitchActive ? 'active' : 'inactive', killSwitchActive === null ? 'UNVERIFIED' : killSwitchActive ? 'BLOCKED' : 'ONLINE'],
    ['Browser Use mode', browserMode, browserMode === 'READ_ONLY' ? 'BLOCKED' : 'DEGRADED'],
    ['Computer Use mode', computerDesktopStatus?.mode ?? safety?.computer?.mode ?? 'READ_ONLY', computerDesktopStatus?.ownerCommandMode ? 'ONLINE' : computerDesktopStatus?.runtime === 'tauri' && computerDesktopStatus.mode === 'read_only' ? 'CONFIGURATION REQUIRED' : 'BLOCKED'],
    ['Trading mode', 'live execution locked', 'BLOCKED'],
  ];

  const toneFor = (status: string): 'success' | 'warning' | 'danger' | 'muted' =>
    status === 'ONLINE' ? 'success' : status === 'BLOCKED' || status === 'OFFLINE' ? 'danger' : status === 'DEGRADED' || status === 'CONFIGURATION REQUIRED' ? 'warning' : 'muted';

  return (
    <ScreenFrame title="System Diagnostics" icon={<Activity className="h-5 w-5" />} subtitle="Desktop shell, providers, permissions, tools and safe local runtime state" variant="cockpit">
      <CockpitGrid>
        <OSPanel title="Self-Test Matrix" eyebrow="DIAGNOSTICS" icon={<Activity className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {diagnosticRows.map(([label, detail, status]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-200">{label}</div>
                  <StatusPill label={status} tone={toneFor(status)} />
                </div>
                <div className="mt-2 text-[11px] leading-relaxed text-slate-500">{detail}</div>
              </div>
            ))}
          </div>
        </OSPanel>
        <OSPanel title="Desktop Safety" eyebrow="LOCAL-FIRST" icon={<ShieldCheck className="h-4 w-4" />}>
          <div className="space-y-2">
            <ActionRow label="Registered tools" value={String(tools.length)} />
            <ActionRow label="Running tools" value={String(runningTools)} />
            <ActionRow label="Audit events" value={String(logs.length)} />
            <ActionRow label="Tray" value={shellStatus?.trayConfigured ? 'configured' : 'planned'} />
            <ActionRow label="Uncontrolled device access" value={shellStatus?.unsafeComputerControl ? 'enabled' : 'blocked'} />
            <ActionRow label="Native computer bridge" value={computerDesktopStatus ? `${computerDesktopStatus.runtime}: ${computerDesktopStatus.mode} / ${computerDesktopStatus.screenCapture}` : 'status unavailable'} />
            <ActionRow label="Downloads/forms" value="approval required" />
            <ActionRow label="Policy warning" value={safety?.computer?.policyWarning ? 'elevated policy detected' : 'none'} />
            <ActionRow label="Tauri package build" value={safety?.desktopPackaging?.tauriPackageBuildAvailable ? 'available' : 'Cargo not found'} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill label="Ctrl Shift K" value="Command Center" tone="muted" />
            <StatusPill label="Ctrl Shift S" value="Stop speech" tone="muted" />
            <StatusPill label="Ctrl Shift M" value="Mute voice" tone="muted" />
            <StatusPill label="Ctrl Shift F" value="Fullscreen" tone="muted" />
            <StatusPill label="Ctrl Shift E" value="Emergency stop" tone="danger" />
          </div>
          {safety?.computer?.policyWarning && (
            <div className="mt-4 rounded-lg border border-red-400/25 bg-red-500/10 p-3 text-[11px] leading-relaxed text-red-100">
              {safety.computer.policyWarning}
            </div>
          )}
          {safety?.desktopPackaging?.warning && (
            <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-[11px] font-semibold leading-relaxed text-amber-100">
              {safety.desktopPackaging.warning}
            </div>
          )}
        </OSPanel>
        <AdvancedStatusSummary />
      </CockpitGrid>
      <div className="mt-4">
        <OSPanel title="Capability Review" eyebrow="SAFE BOUNDARY" icon={<ShieldAlert className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
            {(safety?.classifications ?? []).slice(0, 12).map((capability) => (
              <div key={capability.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-200">{capability.id}</div>
                    <div className="mt-1 font-mono text-[10px] uppercase text-slate-500">{capability.area} / risk {capability.riskLevel}</div>
                  </div>
                  <StatusPill
                    label={capability.status}
                    tone={capability.status === 'blocked' || capability.status === 'unsafe' ? 'danger' : capability.status === 'stub' || capability.status === 'partial' ? 'warning' : 'success'}
                  />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  <ActionRow label="Mode" value={capability.mode} />
                  <ActionRow label="Permissions" value={Array.isArray(capability.requiredPermissions) ? capability.requiredPermissions.join(', ') || 'none' : 'none'} />
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{capability.verification}</p>
              </div>
            ))}
            {!safety?.classifications?.length && (
              <div className="xl:col-span-3">
                <EmptyState icon={<ShieldAlert className="h-4 w-4" />} title="Capability snapshot pending" text="Backend safety snapshot yüklenemediğinde gerçek yetenek iddiası gösterilmez." />
              </div>
            )}
          </div>
        </OSPanel>
      </div>
      <CrossDeviceBridgePanel />
    </ScreenFrame>
  );
}

export function SettingsArchitectureScreen({
  settings,
  integrations = [],
  assistant,
  providerProfiles = [],
  providerHealth,
  availableModels = [],
  onUpdateSettings,
  onTestConnection,
  isTestingConnection = false,
}: {
  settings?: UserSettings;
  integrations?: IntegrationConfig[];
  assistant?: AssistantProfile;
  providerProfiles?: ProviderProfile[];
  providerHealth?: { source: 'backend' | 'placeholder'; geminiAvailable: boolean; ollamaConnected: boolean; checkedAt?: number };
  availableModels?: string[];
  onUpdateSettings?: (updates: Partial<UserSettings>) => void;
  onTestConnection?: () => void;
  isTestingConnection?: boolean;
}) {
  const activeProvider = providerProfiles.find((profile) => profile.provider === settings?.aiProvider);
  const modelOptions = settings ? modelsForProvider(settings.aiProvider, providerProfiles, availableModels) : ['auto'];
  const selectedModel = settings ? selectValidModelForProvider(settings.aiProvider, providerProfiles, availableModels, settings.selectedModel) : 'auto';
  React.useEffect(() => {
    if (settings && selectedModel !== settings.selectedModel) {
      onUpdateSettings?.({ selectedModel });
    }
  }, [onUpdateSettings, selectedModel, settings]);
  const canEdit = Boolean(settings && onUpdateSettings);
  const [providerApiKeys, setProviderApiKeys] = React.useState<Record<string, string>>({});
  const [providerKeyStatus, setProviderKeyStatus] = React.useState<Record<string, { tone: 'success' | 'warning' | 'danger'; text: string }>>({});
  const apiKeyProviders = providerProfiles.filter((profile) =>
    ['gemini', 'openai', 'anthropic', 'openrouter'].includes(profile.provider) ||
    profile.requiredEnv.some((envName) => envName.endsWith('_API_KEY'))
  );

  const handleProviderChange = (provider: AiProvider) => {
    if (!settings || !onUpdateSettings) return;
    const nextModel = selectValidModelForProvider(provider, providerProfiles, availableModels, settings.selectedModel);
    onUpdateSettings({
      aiProvider: provider,
      selectedModel: nextModel,
    });
  };

  const handleProviderKeySave = async (provider: AiProvider) => {
    const apiKey = providerApiKeys[provider]?.trim();
    if (!apiKey) {
      setProviderKeyStatus((prev) => ({
        ...prev,
        [provider]: { tone: 'warning', text: 'API key boş olamaz.' },
      }));
      return;
    }

    setProviderApiKeys((prev) => ({ ...prev, [provider]: '' }));
    setProviderKeyStatus((prev) => ({
      ...prev,
      [provider]: {
        tone: 'warning',
        text: 'API keys are backend-only. Set GEMINI_API_KEY in the server environment and restart EDITH.',
      },
    }));
  };

  return (
    <ScreenFrame title="Settings" icon={<SlidersHorizontal className="h-5 w-5" />} subtitle="Grouped settings architecture for E.D.I.T.H." variant="wide">
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <ActionRow label="Assistant" value={assistant?.name ?? settings?.assistantPersona ?? 'unknown'} />
        <ActionRow label="Memory namespace" value={assistant?.memoryNamespace ?? 'not configured'} />
        <ActionRow label="Provider" value={activeProvider?.displayName ?? settings?.aiProvider ?? 'unknown'} />
        <ActionRow label="Model" value={selectedModel === 'auto' ? 'AUTO' : selectedModel} />
        <ActionRow label="Configured integrations" value={String(integrations.length)} />
        <ActionRow label="Provider source" value={providerHealth?.source === 'backend' ? 'backend endpoint' : 'frontend placeholder'} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[clamp(20rem,22vw,28rem)_minmax(0,1fr)]">
        <OSPanel title="Active Model Route" eyebrow="MODELS / PROVIDERS" icon={<Cpu className="h-4 w-4" />}>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-wide text-slate-500" htmlFor="settings-provider-selector">Provider</label>
              <select
                id="settings-provider-selector"
                value={settings?.aiProvider ?? 'ollama'}
                disabled={!canEdit}
                onChange={(event) => handleProviderChange(event.target.value as AiProvider)}
                className="w-full rounded-lg border border-white/10 bg-slate-950/75 px-3 py-2 text-xs text-slate-100 outline-none focus:border-[var(--assistant-primary)]"
              >
                {providerProfiles.map((profile) => (
                  <option key={profile.provider} value={profile.provider} className="bg-slate-950 text-slate-100">
                    {profile.displayName} ({providerStatusLabel(profile.status)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-wide text-slate-500" htmlFor="settings-model-selector">Model</label>
              <select
                id="settings-model-selector"
                value={selectedModel}
                disabled={!canEdit}
                onChange={(event) => onUpdateSettings?.({ selectedModel: event.target.value })}
                className="w-full rounded-lg border border-white/10 bg-slate-950/75 px-3 py-2 text-xs text-slate-100 outline-none focus:border-[var(--assistant-primary)]"
              >
                {modelOptions.map((model) => {
                  const disabledReason = settings ? modelDisabledReason(settings.aiProvider, model, providerProfiles, availableModels) : undefined;
                  return (
                  <option key={model} value={model} disabled={Boolean(disabledReason)} className="bg-slate-950 text-slate-100">
                    {model === 'auto' ? 'AUTO' : model}{disabledReason ? ` (${disabledReason})` : ''}
                  </option>
                );})}
              </select>
            </div>
            <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/8 p-3">
              <div className="flex flex-wrap gap-1.5">
                <StatusPill label="Assistant" value={assistant?.name ?? 'Persona'} tone="info" />
                <StatusPill label="Provider" value={activeProvider?.displayName ?? 'Unknown'} tone={providerTone(activeProvider?.status ?? 'unknown')} />
                <StatusPill label="Model" value={selectedModel === 'auto' ? 'AUTO ROUTED' : selectedModel} tone={selectedModel === 'auto' ? 'info' : 'muted'} />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Assistant persona, model and provider are separate. Selecting Gemini or Ollama here does not change {assistant?.name ?? 'the active assistant'}.
              </p>
            </div>
            {onTestConnection && (
              <button
                type="button"
                onClick={onTestConnection}
                disabled={isTestingConnection}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-[var(--assistant-primary)]/40 disabled:opacity-60"
              >
                <Activity className={`h-3.5 w-3.5 ${isTestingConnection ? 'animate-spin' : ''}`} />
                Test provider status
              </button>
            )}
          </div>
        </OSPanel>

        <OSPanel title="Provider Matrix" eyebrow="STATUS" icon={<Network className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {providerProfiles.map((profile) => (
              <ProviderMatrixCard
                key={profile.provider}
                profile={profile}
                active={profile.provider === settings?.aiProvider}
                selectedModel={profile.provider === settings?.aiProvider ? settings?.selectedModel : undefined}
                onSelect={canEdit ? handleProviderChange : undefined}
              />
            ))}
          </div>
        </OSPanel>
      </div>

      <div className="mb-4">
        <OSPanel title="Provider API Keys" eyebrow="DEV CONFIG" icon={<KeyRound className="h-4 w-4" />}>
          <div className="mb-3 rounded-lg border border-amber-300/20 bg-amber-300/8 p-3 text-[11px] leading-relaxed text-amber-100/90">
            API anahtarları localStorage'a kaydedilmez ve ekranda geri gösterilmez. Kaydet tuşundan sonra sadece çalışan backend oturumu için env olarak ayarlanır; sunucuyu yeniden başlatırsan tekrar girmen gerekir.
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {apiKeyProviders.map((profile) => {
              const status = providerKeyStatus[profile.provider];
              return (
                <div key={profile.provider} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{profile.displayName}</div>
                      <div className="mt-1 font-mono text-[10px] uppercase text-slate-500">
                        {profile.requiredEnv.join(', ') || `${profile.provider.toUpperCase()}_API_KEY`}
                      </div>
                    </div>
                    <StatusPill label={providerStatusLabel(profile.status)} tone={providerTone(profile.status)} />
                  </div>
                  <div className="flex flex-col gap-2 md:flex-row">
                    <input
                      type="password"
                      value={providerApiKeys[profile.provider] ?? ''}
                      onChange={(event) => setProviderApiKeys((prev) => ({ ...prev, [profile.provider]: event.target.value }))}
                      placeholder={`${profile.displayName} API key gir`}
                      autoComplete="off"
                      spellCheck={false}
                      className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/75 px-3 py-2 text-xs font-mono text-slate-100 outline-none focus:border-[var(--assistant-primary)]"
                    />
                    <button
                      type="button"
                      onClick={() => handleProviderKeySave(profile.provider)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:border-amber-200/60"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Kaydet
                    </button>
                  </div>
                  {status && (
                    <div className={`mt-2 text-[11px] font-mono ${
                      status.tone === 'success' ? 'text-emerald-300' : status.tone === 'danger' ? 'text-red-300' : 'text-amber-300'
                    }`}>
                      {status.text}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    Provider seçimi ayrı, asistan personası ayrıdır. Bu key sadece provider bağlantısı içindir.
                  </p>
                </div>
              );
            })}
            {!apiKeyProviders.length && (
              <EmptyState icon={<KeyRound className="h-4 w-4" />} title="API key gerektiren provider yok" text="Backend provider listesi yüklendiğinde cloud sağlayıcıların anahtar alanları burada görünür." />
            )}
          </div>
        </OSPanel>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {['General', 'Appearance', 'Assistants', 'Models', 'Providers', 'Voice', 'Memory', 'Agents', 'Tools', 'Computer Use', 'Browser', 'Automation', 'Security', 'Trading', 'Integrations', 'Notifications', 'System', 'Advanced'].map((group) => (
          <div key={group} className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-200">{group}</div>
        ))}
      </div>
    </ScreenFrame>
  );
}

function ProviderMatrixCard({
  profile,
  active,
  selectedModel,
  onSelect,
}: {
  key?: React.Key;
  profile: ProviderProfile;
  active: boolean;
  selectedModel?: string;
  onSelect?: (provider: AiProvider) => void;
}) {
  const status = providerStatusLabel(profile.status);
  const setupInstruction = profile.provider === 'gemini'
    ? 'Set GEMINI_API_KEY in environment configuration.'
    : profile.requiredEnv.length
    ? `Set ${profile.requiredEnv.join(', ')} in environment configuration.`
    : '';

  return (
    <button
      type="button"
      onClick={() => onSelect?.(profile.provider)}
      disabled={!onSelect}
      className={`rounded-lg border p-3 text-left transition ${
        active
          ? 'border-[var(--assistant-primary)]/55 bg-[var(--assistant-primary)]/10 shadow-[0_0_22px_var(--assistant-glow)]'
          : 'border-white/10 bg-white/[0.03] hover:border-white/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">{profile.displayName}</div>
          <div className="mt-1 font-mono text-[10px] uppercase text-slate-500">
            {profile.privacy} / default {profile.defaultModel}
          </div>
        </div>
        <StatusPill label={status} tone={providerTone(profile.status)} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        <ActionRow label="Configured" value={profile.configured === true ? 'yes' : profile.configured === false ? 'missing env' : profile.requiredEnv.length ? 'unknown env' : 'not required'} />
        <ActionRow label="Available" value={profile.available === true ? 'yes' : profile.available === false ? 'no' : 'unknown'} />
        <ActionRow label="Selected model" value={selectedModel === 'auto' ? 'AUTO' : selectedModel ?? 'not selected'} />
        <ActionRow label="Fallback model" value={profile.provider === 'gemini' ? 'Ollama / EDITH Mock' : profile.provider === 'ollama' ? 'Gemini / EDITH Mock' : 'EDITH Mock'} />
        <ActionRow label="Backend" value={profile.pendingBackend ? 'pending integration' : 'endpoint reported'} />
        <ActionRow label="Streaming" value={profile.supportsStreaming ? 'supported' : 'not reported'} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(profile.models?.length ? profile.models : profile.modelExamples).map((model) => (
          <span key={model} className="rounded border border-white/10 bg-slate-950/55 px-2 py-0.5 font-mono text-[10px] text-slate-400">
            {model === 'auto' ? 'AUTO' : model}
          </span>
        ))}
      </div>
      {setupInstruction && profile.status !== 'available' && (
        <p className="mt-3 text-[11px] leading-relaxed text-amber-200/85">{setupInstruction}</p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{profile.notes}</p>
    </button>
  );
}

export function ContextPanel({
  aiState,
  assistant,
  tools,
  logs,
}: {
  aiState: AiState;
  assistant: AssistantTheme;
  tools: AutomationTool[];
  logs: ToolExecutionLog[];
}) {
  return (
    <aside className="hidden w-[clamp(19rem,18vw,26rem)] shrink-0 border-l border-white/10 bg-slate-950/55 p-3 backdrop-blur-2xl 2xl:block">
      <div className="space-y-3">
        <OSPanel title="Inspector" eyebrow="LIVE CONTEXT" icon={<Radar className="h-4 w-4" />}>
          <div className="space-y-2">
            <ActionRow label="Assistant" value={assistant.name} />
            <ActionRow label="State" value={statusCopy[aiState]} />
            <ActionRow label="Tools" value={String(tools.length)} />
            <ActionRow label="Audit logs" value={String(logs.length)} />
          </div>
        </OSPanel>
        <OSPanel title="Source List" eyebrow="RESEARCH" icon={<Database className="h-4 w-4" />}>
          <EmptyState icon={<Globe2 className="h-4 w-4" />} title="Kaynak yok" text="Browser Agent kaynak kullandığında burada listelenir." />
        </OSPanel>
      </div>
    </aside>
  );
}

export function ScreenFrame({
  title,
  subtitle,
  icon,
  children,
  variant = 'wide',
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  variant?: ScreenFrameVariant;
}) {
  return (
    <div className="edith-workspace edith-responsive-pad overflow-y-auto custom-scrollbar">
      <div className={cx(screenContainerClass[variant], 'min-w-0')}>
        <div className="mb-4 flex flex-col gap-3 border-b border-white/10 pb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="edith-icon-cell h-11 w-11">{icon}</div>
            <div className="min-w-0 break-words">
              <h1 className="text-xl font-semibold tracking-wide text-slate-100">{title}</h1>
              <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
            </div>
          </div>
          <StatusPill label="E.D.I.T.H. MODULE" tone="info" />
        </div>
        {children}
      </div>
    </div>
  );
}

function LoopBar({ items, active }: { items: string[]; active: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item, index) => (
        <React.Fragment key={item}>
          <span className={`rounded-md border px-2.5 py-1.5 font-mono text-[10px] ${index === active ? 'border-[var(--assistant-primary)] bg-[var(--assistant-primary)]/15 text-slate-100' : 'border-white/10 bg-white/[0.025] text-slate-500'}`}>{item}</span>
          {index < items.length - 1 && <ChevronRight className="h-3 w-3 text-slate-600" />}
        </React.Fragment>
      ))}
    </div>
  );
}

function ActionRow({ label, value }: { key?: React.Key; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-slate-950/45 px-3 py-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-right font-mono text-[11px] text-slate-300">{value}</span>
    </div>
  );
}

function MonitorIcon() {
  return <Cpu className="h-4 w-4" />;
}

function SearchIcon() {
  return <Globe2 className="h-4 w-4" />;
}
