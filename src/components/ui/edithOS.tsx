import React from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  Bot,
  Brain,
  CheckCircle2,
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
  WifiOff,
  Wrench,
  Zap,
} from 'lucide-react';
import { AiProvider, AiState, AssistantProfile, AutomationTool, ChatMessage, IntegrationConfig, MemoryItem, ProviderProfile, ToolExecutionLog, UserSettings } from '../../types';
import { modelDisabledReason, modelsForProvider, providerDisplayName, providerStatusLabel, providerTone, selectValidModelForProvider } from '../../edith/providerService';
import { getDesktopShellStatus, type DesktopShellStatus } from '../../edith/desktopShell';
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
  downsampleFloat32ToInt16Pcm,
  int16PcmToBase64,
  parseVoiceLiveServerEvent,
  VOICE_LIVE_INPUT_MIME,
  VOICE_LIVE_OUTPUT_RATE,
  voiceLiveSocketUrl,
} from '../../edith/voiceLiveClient';

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
    fetch('/api/edith/interaction-safety')
      .then((response) => response.ok ? readJsonResponse(response) : undefined)
      .then((payload) => {
        if (!cancelled && payload?.success) setSnapshot(payload.snapshot);
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null);
      });
    return () => {
      cancelled = true;
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

export function TaskTimeline({
  aiState = 'idle',
  hasObjective = false,
  logs = [],
}: {
  aiState?: AiState;
  hasObjective?: boolean;
  logs?: ToolExecutionLog[];
}) {
  const active = aiState !== 'idle' && aiState !== 'success';
  const steps = [
    ['Intent', hasObjective ? 'Chat command present' : 'Awaiting user command', hasObjective ? 'complete' : 'pending'],
    ['Runtime state', statusCopy[aiState], active ? 'active' : 'pending'],
    ['Tools', logs.length > 0 ? `${logs.length} audit events recorded` : 'No tool audit events yet', logs.length > 0 ? 'complete' : 'pending'],
    ['Approval', 'High-risk actions remain gated', 'pending'],
    ['Verification', logs.some((log) => log.status === 'success') ? 'Latest tool result logged' : 'No verified task result', logs.some((log) => log.status === 'success') ? 'complete' : 'pending'],
  ];
  return (
    <div className="space-y-3">
      {steps.map(([title, text, state], index) => (
        <div key={title} className="grid grid-cols-[1.25rem_1fr] gap-3">
          <div className="relative flex justify-center">
            <span className={`mt-1 h-3 w-3 rounded-full border ${state === 'complete' ? 'border-emerald-300 bg-emerald-300/30' : state === 'active' ? 'border-[var(--assistant-primary)] bg-[var(--assistant-primary)]/30 shadow-[0_0_18px_var(--assistant-glow)]' : 'border-slate-600 bg-slate-800'}`} />
            {index < steps.length - 1 && <span className="absolute top-5 h-8 w-px bg-white/10" />}
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-200">{title}</span>
              <span className="font-mono text-[10px] text-slate-600">{state === 'pending' ? 'not started' : new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
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
  settings,
  providerProfiles = [],
  assistantName,
  onSpeak,
}: {
  key?: React.Key;
  message: ChatMessage;
  settings: UserSettings;
  providerProfiles?: ProviderProfile[];
  assistantName: string;
  onSpeak?: (text: string) => void;
}) {
  const user = message.sender === 'user';
  const providerUsed = message.providerUsed ?? message.requestedProvider ?? settings.aiProvider;
  const modelUsed = message.modelUsed ?? message.requestedModel ?? settings.selectedModel ?? 'auto';
  const providerStatus = message.providerStatus ?? providerProfiles.find((profile) => profile.provider === providerUsed)?.status ?? 'unknown';
  const fallbackLabel = message.fallbackUsed
    ? `${providerDisplayName(message.fallbackProvider ?? providerUsed)}${message.fallbackModel ? ` / ${message.fallbackModel}` : ''}`
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
            {user ? 'YOU // COMMAND' : `${assistantName} // RESPONSE`}
          </span>
        </div>
        <span className="font-mono text-[10px] text-slate-600">
          {new Date(message.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {!user && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <StatusPill label="Model" value={modelUsed === 'auto' ? 'AUTO' : modelUsed} tone={modelUsed === 'auto' ? 'info' : 'muted'} />
          <StatusPill label="Provider" value={providerDisplayName(providerUsed as AiProvider)} tone={providerTone(providerStatus)} />
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
  const runningTools = tools.filter((tool) => tool.status === 'running').length;
  const agents = [
    ['Orchestrator', 'Görev ayrıştırma, handoff ve genel kontrol', aiState === 'thinking' ? 'ACTIVE' : 'STANDBY', ['planner', 'router']],
    ['Research Agent', 'Kaynak toplama, güvenilirlik ve çelişki kontrolü', aiState === 'browser_use' || aiState === 'searching' ? 'ACTIVE' : 'STANDBY', ['browser', 'sources']],
    ['Computer Agent', 'Observe -> Understand -> Plan -> Action -> Verify döngüsü', 'READ ONLY', ['vision', 'screen']],
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

export function ComputerUseScreen({ tools = [], logs = [] }: { tools?: AutomationTool[]; logs?: ToolExecutionLog[] }) {
  const safety = useInteractionSafetySnapshot();
  const computerTools = tools.filter((tool) =>
    tool.category === 'computer' ||
    tool.permissions.some((permission) => permission.includes('computer') || permission.includes('control'))
  );
  const latestComputerLog = logs.find((log) => computerTools.some((tool) => tool.id === log.toolId));
  return (
    <ScreenFrame title="Bilgisayar Kullanımı" icon={<Cpu className="h-5 w-5" />} subtitle="Görünür algı-eylem kokpiti. Varsayılan mod: SADECE OKUMA." variant="cockpit">
      <CockpitGrid>
        <OSPanel title="Live Observation" eyebrow="SCREEN" icon={<Eye className="h-4 w-4" />}>
          <div className="aspect-video rounded-lg border border-white/10 bg-[radial-gradient(circle_at_center,var(--assistant-glow),transparent_34%),linear-gradient(135deg,rgba(15,23,42,.9),rgba(2,6,23,.96))] p-4">
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-white/15 bg-black/30 text-center">
              <EmptyState icon={<MonitorIcon />} title="Read-only observation hazır" text="Computer Agent ekran görüntüsü aldığında UI elementleri, hedef ve doğrulama sonucu burada görünür." />
            </div>
          </div>
        </OSPanel>
        <OSPanel title="Sonraki İşlem" eyebrow="GÜVENLİK DÖNGÜSÜ" icon={<ShieldCheck className="h-4 w-4" />}>
          <LoopBar items={['OBSERVE', 'UNDERSTAND', 'PLAN', 'ACTION', 'VERIFY']} active={0} />
          <div className="mt-4 space-y-2">
            <StatusPill label={safety?.computer?.mode ?? 'READ ONLY'} tone="success" />
            <StatusPill label={safety?.computer?.approvalRequired ? 'Kontrol için onay gerekli' : 'Onay durumu bilinmiyor'} tone="warning" />
            <ActionRow label="Kontrol bağdaştırıcıları" value={String(computerTools.length)} />
            <ActionRow label="Son denetim" value={latestComputerLog?.status ?? 'yok'} />
            <ActionRow label="Çalışma ortamı bağlı" value={safety?.computer?.runtimeBound ? 'evet' : 'hayır'} />
            <ActionRow label="Risk" value="Bekleyen işlem yok" />
          </div>
          {safety?.computer?.phases && (
            <div className="mt-4 space-y-1">
              {safety.computer.phases.slice(0, 4).map((phase) => (
                <ActionRow key={phase.name} label={phase.name} value={phase.status} />
              ))}
            </div>
          )}
          <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100">
            <Square className="h-4 w-4" /> Bilgisayar Ajanını Durdur
          </button>
        </OSPanel>
      </CockpitGrid>
    </ScreenFrame>
  );
}

export function BrowserResearchScreen({ tools = [], logs = [] }: { tools?: AutomationTool[]; logs?: ToolExecutionLog[] }) {
  const safety = useInteractionSafetySnapshot();
  const browserTools = tools.filter((tool) =>
    tool.category === 'browser' ||
    tool.category === 'web' ||
    tool.permissions.some((permission) => permission.includes('browser') || permission.includes('network'))
  );
  const blockedCapabilities = safety?.browser?.capabilities?.filter((capability) =>
    capability.runtimeStatus === 'BLOCKED' || capability.requiresApproval
  ) ?? [];
  return (
    <ScreenFrame title="Tarayıcı / Araştırma" icon={<Globe2 className="h-5 w-5" />} subtitle="Kaynaklar, iddialar, çelişkiler ve sentez için yapay zeka araştırma kokpiti" variant="cockpit">
      <CockpitGrid>
        <OSPanel title="Araştırma Oturumu" eyebrow="TARAYICI AJANI" icon={<Globe2 className="h-4 w-4" />}>
          <EmptyState icon={<SearchIcon />} title="Browser Agent hazır" text="Araştırma görevi başladığında aktif URL, tabs, extracted facts ve source board burada görünür." />
        </OSPanel>
        <OSPanel title="Source Board" eyebrow="VERIFICATION" icon={<Database className="h-4 w-4" />}>
          <div className="space-y-2">
            <ActionRow label="Tarayıcı uyumlu araçlar" value={String(browserTools.length)} />
            <ActionRow label="Araştırma denetim olayları" value={String(logs.filter((log) => browserTools.some((tool) => tool.id === log.toolId)).length)} />
            <ActionRow label="Tarayıcı modu" value={safety?.browser?.mode ?? 'SADECE_OKUMA'} />
            <ActionRow label="Onay gerektiren işlemler" value={String(blockedCapabilities.length)} />
            <ActionRow label="Değerlendirilen kaynaklar" value="etkin kaynak yok" />
            <ActionRow label="Son yanıt taslağı" value="oluşturulmadı" />
          </div>
          {safety?.browser?.capabilities && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {safety.browser.capabilities.slice(0, 6).map((capability) => (
                <StatusPill key={capability.action} label={capability.action} value={capability.runtimeStatus} tone={capability.runtimeStatus === 'BLOCKED' ? 'danger' : capability.requiresApproval ? 'warning' : 'muted'} />
              ))}
            </div>
          )}
        </OSPanel>
      </CockpitGrid>
    </ScreenFrame>
  );
}

export function TasksScreen({ aiState = 'idle', messages = [], logs = [], assistant }: { aiState?: AiState; messages?: ChatMessage[]; logs?: ToolExecutionLog[]; assistant?: AssistantProfile }) {
  return (
    <ScreenFrame title="Görevler" icon={<Clock3 className="h-5 w-5" />} subtitle="Kontrol noktaları, araçlar, onaylar ve sonuç durumlarıyla otonom görev zaman akışı" variant="wide">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[clamp(20rem,24vw,30rem)_minmax(0,1fr)]">
        <OSPanel title="Görev Durum Modeli" eyebrow="KUYRUK" icon={<CircleDot className="h-4 w-4" />}>
          {assistant && (
            <div className="mb-3 space-y-2">
              <ActionRow label="Report identity" value={assistant.taskReportSignature} />
              <ActionRow label="Assistant" value={assistant.name} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {['QUEUED', 'PLANNING', 'RUNNING', 'WAITING_FOR_APPROVAL', 'BLOCKED', 'RECOVERING', 'COMPLETED', 'FAILED', 'CANCELLED'].map((state) => (
              <StatusPill key={state} label={state} tone={state.includes('FAILED') || state === 'BLOCKED' ? 'danger' : state.includes('WAITING') ? 'warning' : state === 'COMPLETED' ? 'success' : 'muted'} />
            ))}
          </div>
        </OSPanel>
        <OSPanel title="Etkin Görev Zaman Akışı" eyebrow="GÖREV GÜNLÜĞÜ" icon={<Route className="h-4 w-4" />}>
          <TaskTimeline aiState={aiState} hasObjective={messages.length > 1} logs={logs} />
        </OSPanel>
      </div>
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

  const [graphNodes, setGraphNodes] = React.useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = React.useState<GraphEdge[]>([]);
  const [status, setStatus] = React.useState<GraphStatus | null>(null);
  const [activity, setActivity] = React.useState<{ auditEvents?: any[]; syncEvents?: any[]; toolRuns?: any[]; realtime?: string } | null>(null);
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
        const [graphJson, statusJson, activityJson] = await Promise.all([
          requestJson('/api/knowledge/graph?limit=900'),
          requestJson('/api/knowledge/status'),
          requestJson('/api/knowledge-graph/activity'),
        ]);
        if (!alive) return;
        setGraphNodes(graphJson.graph?.nodes ?? []);
        setGraphEdges(graphJson.graph?.relationships ?? []);
        setStatus(statusJson.status ?? null);
        setActivity(activityJson.activity ?? null);
      } catch {
        if (!alive) return;
        setGraphNodes([]);
        setGraphEdges([]);
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
  const statusOnline = status?.connectionStatus === 'synced' || status?.connectionStatus === 'connected';
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
            <p className="text-xs text-slate-400">Everything connected. Greater together.</p>
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
                <div className="mt-2 text-[11px] text-slate-400">Vault Path <span className="float-right max-w-44 truncate text-slate-300">{status?.settings?.vaultPath ?? 'D:\\EDİTH\\EDİTH'}</span></div>
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
  return (
    <ScreenFrame title="Araçlar / MCP Kayıt Defteri" icon={<Wrench className="h-5 w-5" />} subtitle="Araç riski, izinler, durum, gecikme ve çalıştırma geçmişi" variant="wide">
      <WorkspaceGrid>
        {tools.map((tool) => (
          <OSPanel key={tool.id} title={tool.name} eyebrow={tool.category.toUpperCase()} icon={<Wrench className="h-4 w-4" />}>
            <p className="text-xs leading-relaxed text-slate-400">{tool.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <RiskBadge level={tool.requiresConfirmation ? 'HIGH' : 'LOW'} />
              <StatusPill label={tool.status} tone={tool.status === 'error' ? 'danger' : tool.status === 'success' ? 'success' : tool.status === 'running' ? 'warning' : 'muted'} />
            </div>
            <div className="mt-3 text-[10px] text-slate-500">{tool.permissions.join(', ') || 'no permissions declared'}</div>
          </OSPanel>
        ))}
        {tools.length === 0 && <div className="xl:col-span-3"><EmptyState icon={<Wrench className="h-4 w-4" />} title="Tool registry boş" text="Registry yüklendiğinde tool izinleri ve risk seviyeleri burada görünür." /></div>}
      </WorkspaceGrid>
      <div className="mt-4">
        <OSPanel title="Recent Tool Logs" eyebrow="AUDIT" icon={<Terminal className="h-4 w-4" />}>
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

const voiceRoomStateTone: Record<VoiceRoomState, 'info' | 'success' | 'warning' | 'danger' | 'muted'> = {
  idle: 'muted',
  connecting: 'warning',
  listening: 'success',
  thinking: 'info',
  speaking: 'info',
  muted: 'warning',
  disconnected: 'warning',
  error: 'danger',
};

export function VoiceScreen({ onBack }: { onBack?: () => void }) {
  const safety = useInteractionSafetySnapshot();
  const [roomState, setRoomState] = React.useState<VoiceRoomState>('idle');
  const [micSupported, setMicSupported] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [voiceCapabilities, setVoiceCapabilities] = React.useState(() => getVoiceRoomCapabilitySnapshot());
  const [partialTranscript, setPartialTranscript] = React.useState('');
  const [finalTranscript, setFinalTranscript] = React.useState('');
  const [jarvisReply, setJarvisReply] = React.useState(() => getVoiceRoomCapabilitySnapshot().statusMessage);
  const [voiceError, setVoiceError] = React.useState<string | null>(null);
  const [audioChunkCount, setAudioChunkCount] = React.useState(0);
  const [lastAudioMimeType, setLastAudioMimeType] = React.useState<string>('none');
  const socketRef = React.useRef<WebSocket | null>(null);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const captureContextRef = React.useRef<AudioContext | null>(null);
  const playbackContextRef = React.useRef<AudioContext | null>(null);
  const processorRef = React.useRef<ScriptProcessorNode | null>(null);
  const playbackSourcesRef = React.useRef<AudioBufferSourceNode[]>([]);
  const playbackTimeRef = React.useRef(0);
  const mutedRef = React.useRef(false);

  React.useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  React.useEffect(() => {
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
    }

    return () => {
      stopLiveSession('component_unmount');
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/voice/live/status')
      .then((response) => response.ok ? readJsonResponse(response) : undefined)
      .then((payload) => {
        if (!cancelled && payload?.success) {
          setVoiceCapabilities(normalizeVoiceRoomStatusPayload(payload, micSupported));
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

  const displayState: VoiceRoomState = muted ? 'muted' : roomState;
  const liveStatusLabel = voiceCapabilities.runtimeStatus === 'connected'
    ? 'Connected'
    : voiceCapabilities.runtimeStatus === 'connecting'
    ? 'Connecting'
    : voiceCapabilities.runtimeStatus === 'configuration_required'
    ? 'Configuration required'
    : 'Offline';
  const liveStatusTone = voiceCapabilities.runtimeStatus === 'connected'
    ? 'success'
    : voiceCapabilities.runtimeStatus === 'configuration_required'
    ? 'warning'
    : 'warning';

  const playPcmAudio = React.useCallback((base64Audio: string) => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      setVoiceError('Audio playback is not supported in this runtime.');
      return;
    }

    const context = playbackContextRef.current ?? new AudioContextCtor({ sampleRate: VOICE_LIVE_OUTPUT_RATE });
    playbackContextRef.current = context;
    void context.resume();

    const pcm = base64ToInt16Pcm(base64Audio);
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
    playbackTimeRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.push(source);
    source.onended = () => {
      playbackSourcesRef.current = playbackSourcesRef.current.filter((candidate) => candidate !== source);
    };
  }, []);

  const stopPlayback = React.useCallback(() => {
    playbackSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Source may already be stopped.
      }
    });
    playbackSourcesRef.current = [];
    playbackTimeRef.current = 0;
  }, []);

  const stopCapture = React.useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    void captureContextRef.current?.close();
    captureContextRef.current = null;
  }, []);

  const stopLiveSession = React.useCallback((reason = 'client_stop') => {
    stopCapture();
    stopPlayback();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'session:stop' }));
    }
    socketRef.current?.close(1000, reason);
    socketRef.current = null;
    setRoomState('idle');
  }, [stopCapture, stopPlayback]);

  const startCapture = React.useCallback(async (socket: WebSocket) => {
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
    mediaStreamRef.current = stream;

    const context = new AudioContextCtor();
    captureContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      if (mutedRef.current || socket.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = downsampleFloat32ToInt16Pcm(input, context.sampleRate);
      const audio = int16PcmToBase64(pcm);
      socket.send(JSON.stringify({ type: 'audio:chunk', audio, mimeType: VOICE_LIVE_INPUT_MIME }));
    };

    source.connect(processor);
    processor.connect(context.destination);
    await context.resume();
  }, []);

  const interruptLiveSession = () => {
    stopPlayback();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    setRoomState('listening');
  };

  const handleServerEvent = React.useCallback((raw: MessageEvent<string>) => {
    const event = parseVoiceLiveServerEvent(String(raw.data));
    if (!event) return;

    if (event.type === 'status') {
      setRoomState(event.state);
      if (event.safeMessage) setVoiceError(event.state === 'error' ? event.safeMessage : null);
      return;
    }

    if (event.type === 'session:ready') {
      setVoiceCapabilities((current) => ({ ...current, runtimeStatus: 'connected', liveConnectorBound: true }));
      setRoomState('listening');
      if (socketRef.current && !mediaStreamRef.current) {
        void startCapture(socketRef.current).catch((error: any) => {
          setRoomState('error');
          setVoiceError(error?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : error?.message ?? 'Could not start microphone capture.');
        });
      }
      return;
    }

    if (event.type === 'transcript:user') {
      if (event.partial) {
        setPartialTranscript(event.text);
      } else {
        setFinalTranscript((current) => `${current} ${event.text}`.trim());
        setPartialTranscript('');
      }
      setRoomState('thinking');
      return;
    }

    if (event.type === 'transcript:assistant') {
      setJarvisReply(event.text);
      setRoomState('speaking');
      return;
    }

    if (event.type === 'audio:chunk') {
      setRoomState('speaking');
      setAudioChunkCount((count) => count + 1);
      setLastAudioMimeType(event.mimeType);
      playPcmAudio(event.audio);
      return;
    }

    if (event.type === 'error') {
      setRoomState('error');
      setVoiceError(event.safeMessage);
      return;
    }

    if (event.type === 'session:ended') {
      stopCapture();
      setRoomState('idle');
    }
  }, [playPcmAudio, startCapture, stopCapture]);

  const startListening = async () => {
    if (muted) {
      setVoiceError('Microphone is muted. Unmute before starting push-to-talk.');
      return;
    }

    if (!micSupported) {
      setRoomState('disconnected');
      setVoiceError('Push-to-talk requires microphone access in this desktop WebView/browser.');
      return;
    }

    try {
      setVoiceError(null);
      setPartialTranscript('');
      setRoomState('connecting');
      stopLiveSession('restart');
      const socket = new WebSocket(voiceLiveSocketUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'session:start' }));
      };
      socket.onmessage = handleServerEvent;
      socket.onerror = () => {
        setRoomState('error');
        setVoiceError('Voice Room WebSocket failed.');
      };
      socket.onclose = () => {
        stopCapture();
        setRoomState((current) => current === 'error' ? current : 'idle');
      };
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Voice Room socket open timeout.')), 7000);
        socket.addEventListener('open', () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
        socket.addEventListener('error', () => {
          window.clearTimeout(timeout);
          reject(new Error('Voice Room socket connection failed.'));
        }, { once: true });
      });
    } catch (error: any) {
      setRoomState('error');
      const message = error?.name === 'NotAllowedError'
        ? 'Microphone permission was denied.'
        : error?.message
        ? `Could not start live voice: ${error.message}`
        : 'Could not start live voice.';
      setVoiceError(message);
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'session:stop' }));
      }
      socketRef.current?.close();
    }
  };

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
  };

  const previewStates: VoiceRoomState[] = ['idle', 'listening', 'thinking', 'speaking'];

  return (
    <div className="edith-voice-room custom-scrollbar">
      <div className="edith-voice-stars" />
      <header className="edith-voice-header">
        <div className="min-w-0">
          <div className="edith-eyebrow">E.D.I.T.H. / Voice Room</div>
          <h2 className="mt-2 text-xl font-semibold text-slate-100 sm:text-2xl">JARVIS conversation chamber</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusPill label={liveStatusLabel} tone={liveStatusTone} />
          <StatusPill label="Model" value={EDITH_VOICE_ROOM_MODEL} tone="info" />
          {onBack && (
            <button onClick={onBack} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-300/35 hover:bg-cyan-300/10">
              Back
            </button>
          )}
        </div>
      </header>

      <section className="edith-voice-stage">
        <div className="edith-voice-core-wrap" data-state={displayState}>
          <div className="edith-voice-orbit edith-voice-orbit-one" />
          <div className="edith-voice-orbit edith-voice-orbit-two" />
          <div className="edith-voice-orbit edith-voice-orbit-three" />
          <div className="edith-voice-wave edith-voice-wave-one" />
          <div className="edith-voice-wave edith-voice-wave-two" />
          <div className="edith-voice-core">
            <div className="edith-voice-core-inner">
              <Sparkles className="h-10 w-10 text-cyan-100 drop-shadow-[0_0_18px_rgba(103,232,249,0.95)]" />
            </div>
          </div>
          <div className="edith-voice-particle edith-voice-particle-a" />
          <div className="edith-voice-particle edith-voice-particle-b" />
          <div className="edith-voice-particle edith-voice-particle-c" />
        </div>

        <div className="edith-voice-status-strip">
          <StatusPill label={voiceRoomStateLabel[displayState]} tone={voiceRoomStateTone[displayState]} />
          <StatusPill label="Assistant" value={EDITH_VOICE_ROOM_ASSISTANT} tone="muted" />
          <StatusPill label="Mode" value={safety?.voice?.mode ?? 'PUSH_TO_TALK'} tone="muted" />
        </div>
      </section>

      <section className="edith-voice-transcript">
        <div className="edith-voice-transcript-line">
          <span>You said</span>
          <p>{partialTranscript || finalTranscript || 'Awaiting push-to-talk input. No wake word listener is active.'}</p>
        </div>
        <div className="edith-voice-transcript-line">
          <span>JARVIS replied</span>
          <p>{jarvisReply}</p>
        </div>
        {voiceError && (
          <div className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
            {voiceError}
          </div>
        )}
      </section>

      <footer className="edith-voice-controls">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={displayState === 'listening' ? stopListening : startListening}
            className={cx(
              'edith-voice-control-button',
              displayState === 'listening' ? 'edith-voice-control-button-active' : ''
            )}
            title={micSupported ? 'Start or stop Gemini Live push-to-talk' : 'Microphone capture is unavailable in this runtime'}
          >
            {displayState === 'listening' ? <Square className="h-5 w-5" /> : <Mic2 className="h-5 w-5" />}
            <span>{displayState === 'listening' ? 'Stop listening' : 'Start listening'}</span>
          </button>
          <button
            onClick={() => setMuted((current) => !current)}
            className="edith-voice-icon-button"
            title={muted ? 'Unmute microphone controls' : 'Mute microphone controls'}
          >
            {muted ? <MicOff className="h-5 w-5" /> : <Mic2 className="h-5 w-5" />}
          </button>
          <button onClick={resetSession} className="edith-voice-icon-button" title="End and reset the local voice room session">
            <RotateCcw className="h-5 w-5" />
          </button>
          <button onClick={interruptLiveSession} className="edith-voice-icon-button" title="Interrupt current Gemini Live audio playback">
            {displayState === 'speaking' ? <Square className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
          </button>
        </div>

        <div className="edith-voice-meter" aria-label="Input meter">
          {Array.from({ length: 20 }).map((_, index) => (
            <span key={index} className={displayState === 'listening' && index < 12 ? 'edith-voice-meter-active' : ''} />
          ))}
        </div>

        <div className="edith-voice-safety-grid">
          <ActionRow label="Gemini Live" value={voiceCapabilities.liveConnectorBound ? 'backend connector bound' : 'backend connector not wired'} />
          <ActionRow label="Wake word" value={safety?.voice?.wakeWord ?? 'Not enabled'} />
          <ActionRow label="Barge-in" value={voiceCapabilities.bargeInEnabled ? 'Enabled' : 'Not enabled'} />
          <ActionRow label="Audio output" value={audioChunkCount > 0 ? `${audioChunkCount} chunks / ${lastAudioMimeType}` : 'waiting'} />
          <ActionRow label="API key exposure" value={voiceCapabilities.frontendCanReadApiKey ? 'Unsafe' : 'Frontend has no key access'} />
        </div>

        <div className="edith-voice-preview">
          <span>Animation preview</span>
          {previewStates.map((state) => (
            <button key={state} onClick={() => setRoomState(state)} className={displayState === state ? 'active' : ''}>
              {voiceRoomStateLabel[state]}
            </button>
          ))}
          <span className="inline-flex items-center gap-1 text-amber-200"><WifiOff className="h-3.5 w-3.5" /> UI-only preview, not a live session</span>
        </div>
      </footer>
    </div>
  );
}

export function SecurityCenterScreen({ tools = [], integrations = [] }: { tools?: AutomationTool[]; integrations?: IntegrationConfig[] }) {
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
              {['Approve once', 'Approve for session', 'Deny', 'Always ask'].map((action) => <button key={action} className="rounded-md border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-200">{action}</button>)}
            </div>
          </div>
        </OSPanel>
        <OSPanel title="Locks" eyebrow="GUARDRAILS" icon={<KeyRound className="h-4 w-4" />}>
          <ActionRow label="Computer-use lock" value="READ ONLY" />
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

export function TradingScreen({ integrations = [], tools = [], logs = [] }: { integrations?: IntegrationConfig[]; tools?: AutomationTool[]; logs?: ToolExecutionLog[] }) {
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
      const response = await fetch('/api/crypto/analyze', {
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
      const response = await fetch('/api/crypto/model/select', {
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
      const response = await fetch('/api/crypto/demo-loop', {
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
      const response = await fetch(`/api/edith/crypto/${action}`, { method: 'POST' });
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
  const portfolioDataLabel = serviceOnline ? '100 USD DEMO MODU' : 'DEMO SERVİSİ KAPALI';
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
                    Modelin piyasada neye baktığını, neden işlem yapıp yapmadığını ve 100 USD sanal portföyün durumunu gösterir. Canlı Binance emri ve gerçek para kullanımı kapalıdır.
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
              <CryptoAnimatedMetric label="Başlangıç" value="100 USD" tone="green" />
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
            <ActionRow label="Demo trading" value="100 USD SANAL" />
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
                    <StatusPill label="Demo portföy 100 USD" tone="info" />
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
          <CryptoPanel title="Demo Portfolio Overview" eyebrow={hasPortfolioData ? '100 USD SANAL BAŞLANGIÇ / GERÇEK PARA YOK' : 'VERİ BEKLENİYOR / SAFE EMPTY STATE'} icon={<TrendingUp className="h-4 w-4" />}>
            <div className="mb-3 flex flex-wrap gap-2">
              <StatusPill label="DEMO MOD" tone="info" />
              <StatusPill label="STARTING CAPITAL 100 USD" tone="info" />
              <StatusPill label="GERÇEK PARA YOK" tone="success" />
              <StatusPill label="CANLI EMİR YOK" tone="danger" />
              <StatusPill label="SANAL PORTFÖY" tone="muted" />
            </div>
            {hasPortfolioData ? (
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <CryptoAnimatedMetric label="Başlangıç" value={`${Number(demoPortfolio.initialBalance ?? 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`} tone="slate" />
                <CryptoAnimatedMetric label="Nakit" value={money(demoPortfolio.currentCash ?? 100)} tone="cyan" />
                <CryptoAnimatedMetric label="Varlık" value={money(demoPortfolio.currentEquity ?? 100)} tone="green" />
                <CryptoAnimatedMetric label="Pozisyon" value={pct(demoPortfolio.currentExposurePct ?? 0)} tone="amber" />
                <CryptoAnimatedMetric label="Demo Net K/Z" value={money(demoPortfolio.realizedPnl ?? 0)} tone={(demoPortfolio.realizedPnl ?? 0) >= 0 ? 'green' : 'amber'} />
                <CryptoAnimatedMetric label="Açık Demo K/Z" value={money(demoPortfolio.unrealizedPnl ?? 0)} tone={(demoPortfolio.unrealizedPnl ?? 0) >= 0 ? 'green' : 'amber'} />
                <CryptoAnimatedMetric label="Win Rate" value={pct(demoPortfolio.winRate ?? 0)} tone="cyan" />
                <CryptoAnimatedMetric label="NO TRADE" value={String(noTradeCount)} tone="slate" />
              </div>
            ) : (
              <CryptoEmptyState
                title="No demo portfolio data yet"
                text="E.D.I.T.H. 100 USD demo başlangıcını güvenlik etiketi olarak koruyor; backend portföy verisi gelmeden kâr, fiyat veya performans üretmez."
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
                  <ActionRow label="Vault yolu" value={String(obsidianStatus.vaultPath ?? 'D:\\EDİTH\\EDİTH')} />
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
                  <ActionRow label="Başlangıç bakiyesi" value={money(demoPortfolio.initialBalance ?? 100)} />
                  <ActionRow label="Mevcut demo varlık" value={money(demoPortfolio.currentEquity ?? 100)} />
                  <ActionRow label="Açık demo pozisyon" value={String(openPositions.length)} />
                  <ActionRow label="Kapanan işlem" value={String(asArray(demoPortfolio.closedTrades).length)} />
                  <ActionRow label="Gerçekleşen demo K/Z" value={money(demoPortfolio.realizedPnl ?? 0)} />
                  <ActionRow label="İşlem günlüğü" value={trades.length ? `${trades.length} kayıt` : 'henüz kayıt yok'} />
                </div>
                <div className="mt-3 space-y-2">
                  {trades.length ? trades.slice(0, 3).map((trade: any) => (
                    <div key={trade.id ?? `${trade.symbol}-${trade.timestamp}`} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-100">{trade.symbol}</span>
                        <StatusPill label={`DEMO ${String(trade.side ?? 'TRADE')}`} tone="info" />
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">Tutar {money(trade.cost)} / Fiyat {money(trade.price)} / K/Z {money(trade.pnl ?? 0)}</div>
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
                <ActionRow label="Vault" value={String(obsidianStatus.vaultPath ?? 'D:\\EDİTH\\EDİTH')} />
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
  serviceOnline,
  marketOnline,
  newsOnline,
  ollamaOnline,
  obsidianReady,
  selectedModel,
  demoLoopLabel,
  lastAnalysisTime,
}: {
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
      <StatusPill label="STARTING CAPITAL" tone="info" value="100 USD" />
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

export function FilesScreen() {
  return <ScreenFrame title="Files / Documents" icon={<Archive className="h-5 w-5" />} subtitle="File context, document references and generated artifacts"><EmptyState icon={<FileText className="h-4 w-4" />} title="Dosya oturumu bekleniyor" text="E.D.I.T.H. dosya araçları çalıştığında kaynaklar, çıktılar ve doküman referansları burada görünür." /></ScreenFrame>;
}

export function SystemHealthScreen({ ollamaConnected = false, settings, tools = [], logs = [] }: { ollamaConnected?: boolean; settings?: UserSettings; tools?: AutomationTool[]; logs?: ToolExecutionLog[] }) {
  const runningTools = tools.filter((tool) => tool.status === 'running').length;
  const safety = useInteractionSafetySnapshot();
  const [shellStatus, setShellStatus] = React.useState<DesktopShellStatus | null>(null);
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
        const payload = await readJsonResponse(response);
        if (!cancelled) setKillSwitchActive(Boolean(payload?.state?.active));
      } catch {
        if (!cancelled) setKillSwitchActive(null);
      }
    }
    loadDiagnostics();
    return () => {
      cancelled = true;
    };
  }, [settings?.ollamaUrl]);

  const diagnosticRows: Array<[string, string, 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'CONFIGURATION REQUIRED' | 'BLOCKED']> = [
    ['Frontend', 'React/Vite UI mounted', 'ONLINE'],
    ['Backend', backendOnline === null ? 'pending health check' : backendOnline ? 'Express API responded' : 'local API unavailable', backendOnline === null ? 'DEGRADED' : backendOnline ? 'ONLINE' : 'OFFLINE'],
    ['Database', 'local persistence layer configured by backend', backendOnline ? 'ONLINE' : 'DEGRADED'],
    ['Memory', settings?.memoryEnabled ? 'memory UI enabled' : 'disabled in settings', settings?.memoryEnabled ? 'DEGRADED' : 'OFFLINE'],
    ['Ollama', ollamaConnected ? 'local provider reachable' : 'not reachable; local UI still usable', ollamaConnected ? 'ONLINE' : 'OFFLINE'],
    ['Gemini', settings?.aiProvider === 'gemini' ? 'selected provider; key verified by backend health' : 'not selected or key not verified here', settings?.aiProvider === 'gemini' ? 'DEGRADED' : 'CONFIGURATION REQUIRED'],
    ['Voice', safety?.voice?.stt ?? 'browser STT only after permission', 'CONFIGURATION REQUIRED'],
    ['Tauri shell', shellStatus?.tauri ? `desktop shell v${shellStatus.version ?? 'unknown'}` : 'browser/dev mode', shellStatus?.tauri ? 'ONLINE' : 'DEGRADED'],
    ['Tauri package build', safety?.desktopPackaging?.warning ?? 'Cargo detected or check pending', safety?.desktopPackaging?.tauriPackageBuildAvailable ? 'ONLINE' : 'CONFIGURATION REQUIRED'],
    ['Tool registry', `${toolsHealth.length || tools.length} tools visible`, toolsHealth.length || tools.length ? 'ONLINE' : 'DEGRADED'],
    ['Permissions', permissionMode, permissionMode === 'FULL_ACCESS' ? 'DEGRADED' : 'ONLINE'],
    ['Kill switch', killSwitchActive === null ? 'pending' : killSwitchActive ? 'active' : 'inactive', killSwitchActive ? 'BLOCKED' : 'ONLINE'],
    ['Browser Use mode', safety?.browser?.mode ?? 'READ_ONLY', safety?.browser?.mode === 'READ_ONLY' ? 'BLOCKED' : 'DEGRADED'],
    ['Computer Use mode', safety?.computer?.mode ?? 'READ_ONLY', 'BLOCKED'],
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
            <ActionRow label="Unsafe computer control" value={shellStatus?.unsafeComputerControl ? 'enabled' : 'blocked'} />
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
          <div className="flex items-center gap-3">
            <div className="edith-icon-cell h-11 w-11">{icon}</div>
            <div>
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
