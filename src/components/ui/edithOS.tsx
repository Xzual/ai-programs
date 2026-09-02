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
  Network,
  Pause,
  Play,
  Radar,
  RadioTower,
  Route,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  TrendingUp,
  Wrench,
  Zap,
} from 'lucide-react';
import { AiProvider, AiState, AssistantProfile, AutomationTool, ChatMessage, IntegrationConfig, MemoryItem, ProviderProfile, ToolExecutionLog, UserSettings } from '../../types';
import { modelsForProvider, providerDisplayName, providerStatusLabel, providerTone } from '../../edith/providerService';
import { getDesktopShellStatus, type DesktopShellStatus } from '../../edith/desktopShell';

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
  const responseStatusLabel = message.error
    ? 'FAILED'
    : message.isStreaming
    ? 'STREAMING'
    : providerStatus === 'available'
    ? 'VERIFIED'
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
          <StatusPill label={responseStatusLabel} tone={message.error ? 'danger' : message.isStreaming ? 'warning' : providerStatus === 'available' ? 'success' : providerTone(providerStatus)} />
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
    <div className="edith-workspace custom-scrollbar">
      <div className="grid grid-cols-1 gap-4 p-4 2xl:grid-cols-[1fr_24rem]">
        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_18rem]">
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
    </div>
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
    <ScreenFrame title="Agent Operations" icon={<Network className="h-5 w-5" />} subtitle="Multi-agent orchestration graph and operational units">
      <OSPanel title="Agent Network" eyebrow="FLOW" icon={<Route className="h-4 w-4" />}>
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
        <ActionRow label="Registered tools" value={String(tools.length)} />
        <ActionRow label="Running tools" value={String(runningTools)} />
        <ActionRow label="Audit events" value={String(logs.length)} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {agents.map(([name, role, status, tools]) => <AgentCard key={name} name={name} role={role} status={status} tools={[...tools]} />)}
      </div>
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
    <ScreenFrame title="Computer Use" icon={<Cpu className="h-5 w-5" />} subtitle="Visible perception-action cockpit. Default mode: READ ONLY.">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
        <OSPanel title="Live Observation" eyebrow="SCREEN" icon={<Eye className="h-4 w-4" />}>
          <div className="aspect-video rounded-lg border border-white/10 bg-[radial-gradient(circle_at_center,var(--assistant-glow),transparent_34%),linear-gradient(135deg,rgba(15,23,42,.9),rgba(2,6,23,.96))] p-4">
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-white/15 bg-black/30 text-center">
              <EmptyState icon={<MonitorIcon />} title="Read-only observation hazır" text="Computer Agent ekran görüntüsü aldığında UI elementleri, hedef ve doğrulama sonucu burada görünür." />
            </div>
          </div>
        </OSPanel>
        <OSPanel title="Next Action" eyebrow="SAFETY LOOP" icon={<ShieldCheck className="h-4 w-4" />}>
          <LoopBar items={['OBSERVE', 'UNDERSTAND', 'PLAN', 'ACTION', 'VERIFY']} active={0} />
          <div className="mt-4 space-y-2">
            <StatusPill label={safety?.computer?.mode ?? 'READ ONLY'} tone="success" />
            <StatusPill label={safety?.computer?.approvalRequired ? 'Approval required for control' : 'Approval state unknown'} tone="warning" />
            <ActionRow label="Control adapters" value={String(computerTools.length)} />
            <ActionRow label="Latest audit" value={latestComputerLog?.status ?? 'none'} />
            <ActionRow label="Runtime bound" value={safety?.computer?.runtimeBound ? 'yes' : 'no'} />
            <ActionRow label="Risk" value="No action pending" />
          </div>
          {safety?.computer?.phases && (
            <div className="mt-4 space-y-1">
              {safety.computer.phases.slice(0, 4).map((phase) => (
                <ActionRow key={phase.name} label={phase.name} value={phase.status} />
              ))}
            </div>
          )}
          <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100">
            <Square className="h-4 w-4" /> Stop Computer Agent
          </button>
        </OSPanel>
      </div>
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
    <ScreenFrame title="Browser / Research" icon={<Globe2 className="h-5 w-5" />} subtitle="AI research cockpit for sources, claims, conflicts and synthesis">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_24rem]">
        <OSPanel title="Research Session" eyebrow="BROWSER AGENT" icon={<Globe2 className="h-4 w-4" />}>
          <EmptyState icon={<SearchIcon />} title="Browser Agent hazır" text="Araştırma görevi başladığında aktif URL, tabs, extracted facts ve source board burada görünür." />
        </OSPanel>
        <OSPanel title="Source Board" eyebrow="VERIFICATION" icon={<Database className="h-4 w-4" />}>
          <div className="space-y-2">
            <ActionRow label="Browser-capable tools" value={String(browserTools.length)} />
            <ActionRow label="Research audit events" value={String(logs.filter((log) => browserTools.some((tool) => tool.id === log.toolId)).length)} />
            <ActionRow label="Browser mode" value={safety?.browser?.mode ?? 'READ_ONLY'} />
            <ActionRow label="Approval-gated actions" value={String(blockedCapabilities.length)} />
            <ActionRow label="Sources being evaluated" value="none active" />
            <ActionRow label="Final answer draft" value="not generated" />
          </div>
          {safety?.browser?.capabilities && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {safety.browser.capabilities.slice(0, 6).map((capability) => (
                <StatusPill key={capability.action} label={capability.action} value={capability.runtimeStatus} tone={capability.runtimeStatus === 'BLOCKED' ? 'danger' : capability.requiresApproval ? 'warning' : 'muted'} />
              ))}
            </div>
          )}
        </OSPanel>
      </div>
    </ScreenFrame>
  );
}

export function TasksScreen({ aiState = 'idle', messages = [], logs = [], assistant }: { aiState?: AiState; messages?: ChatMessage[]; logs?: ToolExecutionLog[]; assistant?: AssistantProfile }) {
  return (
    <ScreenFrame title="Tasks" icon={<Clock3 className="h-5 w-5" />} subtitle="Autonomous task timeline with checkpoints, tools, approvals and result status">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[24rem_1fr]">
        <OSPanel title="Task Status Model" eyebrow="QUEUE" icon={<CircleDot className="h-4 w-4" />}>
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
        <OSPanel title="Active Task Timeline" eyebrow="MISSION LOG" icon={<Route className="h-4 w-4" />}>
          <TaskTimeline aiState={aiState} hasObjective={messages.length > 1} logs={logs} />
        </OSPanel>
      </div>
    </ScreenFrame>
  );
}

export function MemoryBrainScreen({ memories }: { memories: MemoryItem[] }) {
  return (
    <ScreenFrame title="Memory" icon={<Brain className="h-5 w-5" />} subtitle="Semantic memory, preference memory and why-it-was-used context">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[20rem_1fr]">
        <OSPanel title="Memory Clusters" eyebrow="BRAIN" icon={<Network className="h-4 w-4" />}>
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
  const nodes = [
    { id: 'edith', label: 'E.D.I.T.H.', type: 'Project', x: 50, y: 46, size: 'xl', count: 1 },
    { id: 'memory', label: 'Memory', type: 'Memory', x: 28, y: 28, size: 'lg', count: memories.length },
    { id: 'agents', label: 'Agents', type: 'Agent', x: 70, y: 25, size: 'lg', count: 6 },
    { id: 'tools', label: 'Tools', type: 'Tool', x: 78, y: 55, size: 'md', count: tools.length },
    { id: 'tasks', label: 'Tasks', type: 'Task', x: 35, y: 62, size: 'md', count: logs.length },
    { id: 'browser', label: 'Browser', type: 'Website', x: 58, y: 72, size: 'sm', count: 0 },
    { id: 'model', label: 'Model Router', type: 'Model', x: 17, y: 52, size: 'sm', count: 1 },
    { id: 'security', label: 'Security', type: 'Concept', x: 52, y: 18, size: 'sm', count: 4 },
    { id: 'files', label: 'Files', type: 'File', x: 18, y: 77, size: 'sm', count: 0 },
  ];
  const edges = [
    ['edith', 'memory', 'uses'],
    ['edith', 'agents', 'orchestrates'],
    ['agents', 'tools', 'calls'],
    ['tasks', 'agents', 'assigned to'],
    ['tasks', 'memory', 'learns from'],
    ['tools', 'browser', 'opens'],
    ['security', 'tools', 'guards'],
    ['model', 'agents', 'routes'],
    ['files', 'memory', 'indexes'],
    ['edith', 'tasks', 'creates'],
  ];
  const [selectedId, setSelectedId] = React.useState('edith');
  const [filter, setFilter] = React.useState('All');
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  const nodeTypes = ['All', ...Array.from(new Set(nodes.map((node) => node.type)))];
  const visibleNodes = filter === 'All' ? nodes : nodes.filter((node) => node.type === filter || node.id === selectedId);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter(([from, to]) => visibleNodeIds.has(from) && visibleNodeIds.has(to));
  const typeClass: Record<string, string> = {
    Project: 'from-cyan-300 to-blue-500',
    Memory: 'from-fuchsia-300 to-violet-500',
    Agent: 'from-emerald-300 to-teal-500',
    Tool: 'from-amber-300 to-orange-500',
    Task: 'from-sky-300 to-cyan-500',
    Website: 'from-blue-300 to-indigo-500',
    Model: 'from-slate-100 to-slate-400',
    Concept: 'from-red-300 to-rose-500',
    File: 'from-lime-300 to-green-500',
  };
  const selectedRelations = edges.filter(([from, to]) => from === selected.id || to === selected.id);

  return (
    <ScreenFrame title="Knowledge Map" icon={<Network className="h-5 w-5" />} subtitle="Semantic map for memories, agents, tools, files and task relations">
      <div className="grid min-h-[calc(100vh-10rem)] grid-cols-1 gap-4 xl:grid-cols-[17rem_1fr_22rem]">
        <OSPanel title="Map Controls" eyebrow="FILTERS" icon={<SlidersHorizontal className="h-4 w-4" />}>
          <div className="space-y-3">
            <div className="rounded-lg border border-white/10 bg-slate-950/55 p-3">
              <div className="edith-eyebrow">Data Sources</div>
              <div className="mt-3 space-y-2">
                <ActionRow label="Memory records" value={String(memories.length)} />
                <ActionRow label="Tool registry" value={String(tools.length)} />
                <ActionRow label="Audit events" value={String(logs.length)} />
              </div>
            </div>
            <div>
              <div className="edith-eyebrow mb-2">Node Types</div>
              <div className="flex flex-wrap gap-2 xl:block xl:space-y-2">
                {nodeTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilter(type)}
                    className={`w-auto rounded-md border px-3 py-2 text-left text-xs transition xl:w-full ${
                      filter === type
                        ? 'border-[var(--assistant-primary)] bg-[var(--assistant-primary)]/15 text-slate-100 shadow-[0_0_18px_var(--assistant-glow)]'
                        : 'border-white/10 bg-white/[0.025] text-slate-400 hover:border-[var(--assistant-primary)]/35 hover:text-slate-200'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </OSPanel>

        <OSPanel title="Semantic Graph Canvas" eyebrow="KNOWLEDGE MAP" icon={<Network className="h-4 w-4" />}>
          <div className="relative min-h-[34rem] overflow-hidden rounded-lg border border-white/10 bg-[#030817]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,var(--assistant-glow),transparent_24rem),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.022)_1px,transparent_1px)] bg-[size:auto,36px_36px,36px_36px]" />
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="edith-graph-edge" x1="0%" x2="100%">
                  <stop offset="0%" stopColor="var(--assistant-primary)" stopOpacity="0.12" />
                  <stop offset="50%" stopColor="var(--assistant-accent)" stopOpacity="0.62" />
                  <stop offset="100%" stopColor="var(--assistant-primary)" stopOpacity="0.12" />
                </linearGradient>
              </defs>
              {visibleEdges.map(([from, to]) => {
                const a = nodes.find((node) => node.id === from)!;
                const b = nodes.find((node) => node.id === to)!;
                const active = selected.id === from || selected.id === to;
                return (
                  <line
                    key={`${from}-${to}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="url(#edith-graph-edge)"
                    strokeWidth={active ? 0.42 : 0.18}
                    strokeDasharray={active ? '0' : '1.4 1.8'}
                  />
                );
              })}
            </svg>

            {visibleNodes.map((node) => {
              const active = node.id === selected.id;
              const scale = node.size === 'xl' ? 'h-24 w-24' : node.size === 'lg' ? 'h-20 w-20' : node.size === 'md' ? 'h-16 w-16' : 'h-13 w-13';
              return (
                <button
                  key={node.id}
                  onClick={() => setSelectedId(node.id)}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border text-center transition duration-300 ${
                    active
                      ? 'border-white/45 bg-white/[0.09] shadow-[0_0_36px_var(--assistant-glow)]'
                      : 'border-white/15 bg-slate-950/70 hover:border-[var(--assistant-primary)]/45 hover:bg-white/[0.06]'
                  } ${scale}`}
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                >
                  <span className={`absolute inset-2 rounded-full bg-gradient-to-br ${typeClass[node.type]} opacity-20 blur-md`} />
                  <span className={`absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br ${typeClass[node.type]} ${node.size === 'xl' ? 'h-8 w-8' : 'h-5 w-5'} shadow-[0_0_20px_currentColor]`} />
                  <span className="absolute left-1/2 top-full mt-2 w-28 -translate-x-1/2 text-xs font-semibold text-slate-100">{node.label}</span>
                  <span className="absolute left-1/2 top-[calc(100%+1.55rem)] w-28 -translate-x-1/2 font-mono text-[10px] text-slate-500">{node.type} · {node.count}</span>
                </button>
              );
            })}

            <div className="absolute left-4 top-4 rounded-lg border border-white/10 bg-black/40 p-3 backdrop-blur-xl">
              <div className="edith-eyebrow">Active Layer</div>
              <div className="mt-2 text-sm font-semibold text-slate-100">{filter === 'All' ? 'All node types' : filter}</div>
            </div>

            <div className="absolute bottom-3 left-4 right-4 flex flex-wrap gap-2 rounded-lg border border-white/10 bg-black/45 p-2 backdrop-blur-xl">
              {['zoom shell', 'drag placeholder', 'expand selected', 'isolate view', 'timeline placeholder'].map((control) => (
                <StatusPill key={control} label={control} tone="muted" />
              ))}
            </div>
          </div>
        </OSPanel>

        <OSPanel title="Node Inspector" eyebrow={selected.type} icon={<Eye className="h-4 w-4" />}>
          <div className="space-y-4">
            <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
              <div className="text-lg font-semibold text-slate-100">{selected.label}</div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Seçili node E.D.I.T.H. knowledge layer içinde ilişkileriyle birlikte incelenir. Gerçek veri geldikçe bu panel kaynak, confidence ve son kullanım bilgisiyle dolar.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill label={selected.type} tone="info" />
                <StatusPill label="records" value={String(selected.count)} tone="muted" />
              </div>
            </div>
            <div>
              <div className="edith-eyebrow mb-2">Relations</div>
              <div className="space-y-2">
                {selectedRelations.map(([from, to, relation]) => {
                  const other = from === selected.id ? to : from;
                  const otherNode = nodes.find((node) => node.id === other);
                  return (
                    <button key={`${from}-${to}-${relation}`} onClick={() => setSelectedId(other)} className="w-full rounded-md border border-white/10 bg-slate-950/45 px-3 py-2 text-left hover:border-[var(--assistant-primary)]/35">
                      <div className="text-xs font-semibold text-slate-200">{relation}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{otherNode?.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </OSPanel>
      </div>
    </ScreenFrame>
  );
}

export function ToolsRegistryScreen({ tools, logs }: { tools: AutomationTool[]; logs: ToolExecutionLog[] }) {
  return (
    <ScreenFrame title="Tools / MCP Registry" icon={<Wrench className="h-5 w-5" />} subtitle="Tool risk, permissions, status, latency and execution history">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
      </div>
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
    <ScreenFrame title="Automations" icon={<Zap className="h-5 w-5" />} subtitle="Mission scheduling for recurring, event-based and trigger-driven work">
      <OSPanel title="Automation Types" eyebrow="TRIGGERS" icon={<Zap className="h-4 w-4" />}>
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

export function VoiceScreen() {
  const safety = useInteractionSafetySnapshot();
  return (
    <ScreenFrame title="Voice" icon={<Mic2 className="h-5 w-5" />} subtitle="Wake word, STT, intent, assistant response and TTS pipeline">
      <OSPanel title="Voice Pipeline" eyebrow="AUDIO LOOP" icon={<Mic2 className="h-4 w-4" />}>
        <LoopBar items={['Wake Word', 'Speech Recognition', 'Intent', 'Assistant', 'Model', 'Response', 'TTS']} active={0} />
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <ActionRow label="Voice mode" value={safety?.voice?.mode ?? 'DISABLED'} />
          <ActionRow label="Microphone" value="permission required" />
          <ActionRow label="Wake word" value={safety?.voice?.wakeWord ?? 'BLOCKED'} />
          <ActionRow label="STT" value={safety?.voice?.stt ?? 'browser only'} />
          <ActionRow label="TTS" value={safety?.voice?.tts ?? 'configuration dependent'} />
          <ActionRow label="Barge-in" value="not active" />
        </div>
      </OSPanel>
    </ScreenFrame>
  );
}

export function SecurityCenterScreen({ tools = [], integrations = [] }: { tools?: AutomationTool[]; integrations?: IntegrationConfig[] }) {
  const highRiskTools = tools.filter((tool) => tool.requiresConfirmation);
  const connectedIntegrations = integrations.filter((integration) => integration.status === 'connected' && integration.enabled);
  return (
    <ScreenFrame title="Security Center" icon={<LockKeyhole className="h-5 w-5" />} subtitle="Approvals, high-risk tools, sessions, locks and emergency control">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
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
      </div>
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
  ['Majors', 'Watch enabled', 'Paper trading allowed', 'Live locked'],
  ['Meme', 'Watch enabled', 'Decision disabled', 'Paper blocked, approval required'],
  ['Stablecoins', 'Watch only', 'Trading blocked', 'Live locked'],
] as const;

const SAFE_DECISIONS = [
  { symbol: 'BTC/USDT', decision: 'HOLD', provider: 'backend not connected', confidence: '-', riskResult: 'Pending', reason: 'No connected decision feed. Safe placeholder only.' },
  { symbol: 'DOGE/USDT', decision: 'SKIPPED', provider: 'backend not connected', confidence: '-', riskResult: 'Rejected', reason: 'WATCH_ONLY / DECISION_DISABLED' },
] as const;

const SAFE_OBSERVATIONS: MarketObservation[] = [
  { title: 'Market radar standing by', detail: 'Observer service is offline, so no live market observations are being displayed.', signal: 'PLACEHOLDER', source: 'safe-ui' },
  { title: 'Execution layer locked', detail: 'No order actions are exposed in this cockpit. Live trading remains disabled.', signal: 'SAFETY', source: 'safe-ui' },
  { title: 'Learning stream paused', detail: 'Start the crypto observer service to sync fresh notes into the Obsidian learning path.', signal: 'PENDING', source: 'safe-ui' },
];

const SAFE_LEARNING_NOTES: LearningNote[] = [
  { title: 'No live learning notes connected', detail: 'This is a placeholder until /api/learning-notes or /api/obsidian-status responds.' },
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

function money(value: unknown, fallback = 'not connected'): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`;
}

function pct(value: unknown, fallback = 'not connected'): string {
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
  const [actionError, setActionError] = React.useState<string | null>(null);
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
        ]);
        nextData = { permissions, symbols, categories, watchlist, risk, mode, overview, trades, decisions, markets, analysis, observations, learningNotes, obsidianStatus };
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
  const portfolio = overview.portfolio ?? {};
  const performance = overview.performance ?? {};
  const endpointConnected = Object.values(cryptoData).some(Boolean);
  const serviceOnline = Boolean(serviceStatus?.healthy);
  const runtime = serviceStatus?.runtime;
  const runtimeMeta = runtime as Record<string, any> | undefined;
  const observerState = observerStateFromRuntime(runtime, serviceOnline, observerAction, Boolean(actionError));
  const observerRunning = observerState === 'OBSERVING' || observerState === 'STARTING' || observerState === 'PAUSED';
  const ollamaOnline = Boolean(runtime?.ollamaAvailable);
  const obsidianReady = Boolean(runtime?.obsidianAvailable ?? cryptoData.obsidianStatus?.writable);
  const pauseResumeSupported = Boolean(runtimeMeta?.supportsPauseResume);
  const canStartObserver = serviceOnline && (observerState === 'STOPPED' || observerState === 'PAUSED') && !observerAction && ollamaOnline;
  const canStopObserver = serviceOnline && ['OBSERVING', 'STARTING', 'PAUSED'].includes(observerState) && !observerAction;
  const marketOnline = Boolean(runtime?.marketDataAvailable ?? cryptoData.markets?.online ?? cryptoData.markets?.available ?? cryptoData.overview?.marketDataOnline ?? false);
  const symbolsFromBackend = asArray(cryptoData.symbols?.symbols ?? cryptoData.watchlist?.symbols ?? cryptoData.permissions?.symbols);
  const symbolRows: CryptoSymbolPermission[] = symbolsFromBackend.length
    ? symbolsFromBackend.map((item) => ({
        symbol: String(item.symbol ?? item.pair ?? 'UNKNOWN'),
        category: String(item.category ?? 'Uncategorized'),
        watch: Boolean(item.watch ?? item.watchEnabled ?? item.watch_only ?? true),
        decision: Boolean(item.decision ?? item.decisionEnabled ?? item.aiDecision ?? false),
        paper: Boolean(serviceOnline && (item.paper ?? item.paperAllowed ?? item.paperTradingAllowed ?? false)),
        live: false,
        risk: cryptoRisk(item.risk ?? item.riskLevel),
        approvalRequired: Boolean(item.approvalRequired ?? item.requiresApproval),
      }))
    : SAFE_SYMBOL_PERMISSIONS;
  const decisions = asArray(cryptoData.decisions?.decisions ?? cryptoData.analysis?.decisions);
  const trades = asArray(cryptoData.trades?.trades ?? overview.trades);
  const openPositions = asArray(portfolio.positions);
  const risk = cryptoData.risk ?? {};
  const modeLabel = String(runtime?.mode ?? cryptoData.mode?.trading_mode ?? cryptoData.mode?.mode ?? overview.mode ?? 'observer_only').replaceAll('_', ' ').toUpperCase();
  const paperTradingEnabled = Boolean(runtime?.paperTradingEnabled);
  const observations = asArray(cryptoData.observations?.observations ?? cryptoData.analysis?.observations);
  const learningNotes = asArray(cryptoData.learningNotes?.notes ?? cryptoData.obsidianStatus?.notes ?? cryptoData.obsidianStatus?.recentNotes);
  const obsidianStatus = cryptoData.obsidianStatus ?? {};
  const serviceUrl = serviceStatus?.dashboardUrl ?? 'http://localhost:5000';
  const lastChecked = lastCheckedAt ? lastCheckedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'pending';
  const startupCommand = 'npm run crypto:observer';
  const watchedSymbols = Array.isArray(runtime?.watchedSymbols) ? runtime.watchedSymbols : symbolRows.filter((symbol) => symbol.watch).map((symbol) => symbol.symbol);
  const ignoredSymbols = symbolRows.filter((symbol) => !symbol.watch || symbol.approvalRequired).map((symbol) => symbol.symbol);
  const lastLearningNote = learningNotes[0]?.title ?? learningNotes[0]?.path ?? 'not connected';

  return (
    <div className="edith-workspace overflow-y-auto bg-[#05070b] p-4 custom-scrollbar">
      <div className="mx-auto max-w-[1540px] space-y-4">
        <section className="relative overflow-hidden rounded-lg border border-cyan-300/18 bg-[radial-gradient(circle_at_18%_0%,rgba(14,165,233,0.17),transparent_34%),linear-gradient(135deg,rgba(8,13,23,0.96),rgba(2,6,12,0.98))] p-4 shadow-[0_0_42px_rgba(14,165,233,0.12)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_24rem]">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusPill label="CRYPTO OBSERVER MODE" tone={serviceOnline ? 'success' : 'warning'} value={serviceOnline ? 'SERVICE READY' : 'OFFLINE'} />
                <StatusPill label={`OBSERVER ${observerState}`} tone={observerTone(observerState)} />
                <StatusPill label="LIVE TRADING LOCKED" tone="danger" />
                <StatusPill label="EXECUTION NO ACTION" tone="danger" />
                <StatusPill label={paperTradingEnabled ? 'PAPER BACKEND ENABLED' : 'PAPER DISABLED'} tone={paperTradingEnabled ? 'warning' : 'muted'} />
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="edith-eyebrow">E.D.I.T.H. / MARKET INTELLIGENCE</div>
                  <h1 className="mt-1 text-2xl font-semibold tracking-[0.16em] text-slate-100 sm:text-3xl">CRYPTO INTELLIGENCE COCKPIT</h1>
                  <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-400">
                    Read-only market awareness, permission visibility, risk veto state and learning sync. This screen never exposes secrets and never places orders.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadCryptoCockpit}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-300/15"
                >
                  <Activity className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh Cockpit
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CryptoMetric label="Mode" value={modeLabel} tone="cyan" />
              <CryptoMetric label="Service" value={serviceOnline ? 'ONLINE' : 'OFFLINE'} tone={serviceOnline ? 'green' : 'amber'} />
              <CryptoMetric label="Observer" value={observerState} tone={observerState === 'OBSERVING' ? 'green' : observerState === 'ERROR' ? 'amber' : 'slate'} />
              <CryptoMetric label="Ollama" value={ollamaOnline ? 'ONLINE' : 'OFFLINE'} tone={ollamaOnline ? 'green' : 'amber'} />
              <CryptoMetric label="Market Data" value={marketOnline ? 'AVAILABLE' : 'STANDBY'} tone={marketOnline ? 'green' : 'amber'} />
              <CryptoMetric label="Last Check" value={lastChecked} tone="slate" />
            </div>
          </div>
        </section>

        <CryptoPanel title="CRYPTO OBSERVER CONTROL" eyebrow="MISSION CONTROL / FRONTEND SAFE" icon={<RadioTower className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_auto]">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <ControlReadout label="Status" value={observerState} tone={observerTone(observerState)} pulse={observerState === 'OBSERVING' || observerState === 'STARTING' || observerState === 'STOPPING'} />
              <ControlReadout label="Mode" value="OBSERVER_ONLY" tone="info" />
              <ControlReadout label="Safety" value="ORDER EXECUTION BLOCKED" tone="danger" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={() => void runObserverAction('start')}
                disabled={!canStartObserver}
                title={!serviceOnline ? 'Crypto service is offline.' : !ollamaOnline ? 'Ollama is offline. AI market analysis cannot start.' : canStartObserver ? 'Start observer loop only; trading remains locked.' : 'Start is available only when observer is stopped or paused.'}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Play className={`h-3.5 w-3.5 ${observerAction === 'start' ? 'animate-pulse' : ''}`} />
                Start Market Observer
              </button>
              <button
                type="button"
                onClick={() => void runObserverAction('stop')}
                disabled={!canStopObserver}
                title={canStopObserver ? 'Stop observer loop; no destructive action.' : 'Stop is available only while observer is running, starting, or paused.'}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-300/30 bg-red-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-red-100 transition hover:bg-red-300/15 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Square className={`h-3.5 w-3.5 ${observerAction === 'stop' ? 'animate-pulse' : ''}`} />
                Stop Observer
              </button>
              <button
                type="button"
                disabled={!pauseResumeSupported || observerState !== 'OBSERVING'}
                title={pauseResumeSupported ? 'Pause observer loop.' : 'Pause endpoint is not exposed by the backend yet.'}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-amber-300/35 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Pause className="h-3.5 w-3.5" />
                Pause
              </button>
              <button
                type="button"
                disabled={!pauseResumeSupported || observerState !== 'PAUSED'}
                title={pauseResumeSupported ? 'Resume observer loop.' : 'Resume endpoint is not exposed by the backend yet.'}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Play className="h-3.5 w-3.5" />
                Resume
              </button>
              <button
                type="button"
                onClick={loadCryptoCockpit}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-300/15"
              >
                <Activity className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh Status
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
            <ActionRow label="Live trading" value="LOCKED" />
            <ActionRow label="Paper trading" value="DISABLED" />
            <ActionRow label="Order execution" value="BLOCKED" />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {!ollamaOnline && (
              <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs font-semibold text-amber-100">
                Ollama is offline. AI market analysis cannot start.
              </div>
            )}
            {!obsidianReady && (
              <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs font-semibold text-amber-100">
                Obsidian export is not configured.
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
                  <div className="text-lg font-semibold text-amber-100">Crypto Service Offline</div>
                  <p className="mt-1 max-w-3xl text-sm leading-relaxed text-amber-100/78">
                    Observer service is not running, so live market feeds and learning notes are paused. Start Market Observer keeps all trading execution locked.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <StatusPill label="Observer stopped" tone="muted" />
                    <StatusPill label="Live trading locked" tone="danger" />
                    <StatusPill label="Paper trading disabled" tone="muted" />
                    <StatusPill label="No decisions executed" tone="danger" />
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
                    <ActionRow label="Startup command" value={startupCommand} />
                    <ActionRow label="Fallback command" value="python crypto/run_agent.py" />
                    <ActionRow label="Expected service URL" value={serviceUrl} />
                    <ActionRow label="Last checked" value={lastChecked} />
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
                Retry
              </button>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_25rem]">
          <div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[24rem_1fr]">
              <CryptoPanel title="Market Radar" eyebrow={endpointConnected ? 'LIVE FEED' : 'SAFE PLACEHOLDER'} icon={<Radar className="h-4 w-4" />}>
                <div className="relative mx-auto aspect-square max-w-[19rem] rounded-full border border-cyan-300/20 bg-[radial-gradient(circle,rgba(14,165,233,0.16)_0%,rgba(14,165,233,0.04)_38%,rgba(15,23,42,0.08)_70%)]">
                  <div className="absolute inset-[13%] rounded-full border border-cyan-300/12" />
                  <div className="absolute inset-[27%] rounded-full border border-cyan-300/12" />
                  <div className="absolute inset-1/2 h-px w-[46%] origin-left bg-cyan-200/45" />
                  <div className="absolute left-1/2 top-1/2 h-[47%] w-px origin-top bg-cyan-200/12" />
                  <div className="absolute inset-0 animate-spin rounded-full [animation-duration:9s]">
                    <div className="absolute left-1/2 top-1/2 h-[45%] w-px origin-top bg-gradient-to-b from-cyan-200/70 to-transparent" />
                  </div>
                  {symbolRows.slice(0, 5).map((symbol, index) => (
                    <div
                      key={symbol.symbol}
                      className={`absolute h-2.5 w-2.5 rounded-full border ${symbol.live ? 'border-red-200 bg-red-300' : symbol.decision ? 'border-cyan-100 bg-cyan-300' : 'border-amber-100 bg-amber-300'} shadow-[0_0_16px_currentColor]`}
                      style={{
                        left: `${48 + Math.cos((index / 5) * Math.PI * 2) * (22 + index * 3)}%`,
                        top: `${47 + Math.sin((index / 5) * Math.PI * 2) * (22 + index * 2)}%`,
                      }}
                      aria-label={`${symbol.symbol} radar node`}
                    />
                  ))}
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="rounded-lg border border-cyan-300/25 bg-black/55 px-3 py-2 text-center backdrop-blur">
                      <div className="font-mono text-xs text-cyan-100">{observerRunning ? 'SCAN ACTIVE' : 'SCAN STOPPED'}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Observer only</div>
                    </div>
                  </div>
                </div>
              </CryptoPanel>

              <CryptoPanel title="Watchlist Matrix" eyebrow="SYMBOL CONTROL" icon={<Database className="h-4 w-4" />}>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {symbolRows.map((symbol) => (
                    <div key={symbol.symbol} className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-sm font-semibold text-slate-100">{symbol.symbol}</div>
                          <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Category: {symbol.category}</div>
                        </div>
                        <RiskBadge level={symbol.risk === 'Critical' ? 'CRITICAL' : symbol.risk === 'High' ? 'HIGH' : symbol.risk === 'Low' ? 'LOW' : 'MEDIUM'} label={`Risk ${symbol.risk}`} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <MiniFlag label="Watch" value={symbol.watch ? 'Enabled' : 'Disabled'} good={symbol.watch} />
                        <MiniFlag label="Decision" value={symbol.decision ? 'Allowed' : 'Blocked'} good={symbol.decision} />
                        <MiniFlag label="Paper" value={symbol.paper ? 'Backend enabled' : 'Disabled'} good={symbol.paper} />
                        <MiniFlag label="Live" value="Locked" good={false} />
                      </div>
                      {symbol.approvalRequired && <p className="mt-2 text-[11px] text-amber-200">High-risk symbol requires approval before any backend action.</p>}
                    </div>
                  ))}
                </div>
              </CryptoPanel>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <CryptoPanel title="Market Observations" eyebrow={observations.length ? 'BACKEND FEED' : 'PLACEHOLDER'} icon={<Eye className="h-4 w-4" />}>
                <div className="space-y-3">
                  {(observations.length ? observations : SAFE_OBSERVATIONS).slice(0, 5).map((observation: any, index: number) => (
                    <div key={`${observation.title ?? observation.symbol ?? 'observation'}-${index}`} className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-100">{observation.title ?? observation.symbol ?? 'Market observation'}</div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">{observation.detail ?? observation.summary ?? observation.reason ?? 'No detail reported.'}</p>
                        </div>
                        <StatusPill label={String(observation.signal ?? observation.type ?? 'INFO').toUpperCase()} tone={observations.length ? 'info' : 'muted'} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-slate-500">
                        <span>Source: {observation.source ?? 'not reported'}</span>
                        <span>Time: {displayTime(observation.timestamp ?? observation.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CryptoPanel>

              <CryptoPanel title="Decision Feed" eyebrow={decisions.length ? 'BACKEND FEED' : 'PLACEHOLDER'} icon={<Bot className="h-4 w-4" />}>
                <div className="space-y-3">
                {(decisions.length ? decisions : SAFE_DECISIONS).slice(0, 5).map((decision: any, index: number) => (
                  <div key={`${decision.symbol}-${index}`} className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-sm font-semibold text-slate-100">{decision.symbol ?? 'UNKNOWN'}</div>
                        <div className="mt-1 text-[11px] text-slate-500">Provider: {decision.provider ?? decision.modelProvider ?? 'not reported'}</div>
                      </div>
                      <StatusPill label={String(decision.decision ?? 'NO DATA').toUpperCase()} tone={String(decision.decision ?? '').toUpperCase() === 'BUY' || String(decision.decision ?? '').toUpperCase() === 'SELL' ? 'warning' : 'muted'} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <ActionRow label="Confidence" value={typeof decision.confidence === 'number' ? `${Math.round(decision.confidence * 100)}%` : String(decision.confidence ?? '-')} />
                      <ActionRow label="Risk result" value={String(decision.riskResult ?? decision.risk_result ?? 'not connected')} />
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Reason: {decision.reason ?? 'No clean setup reported.'}</p>
                  </div>
                ))}
                </div>
              </CryptoPanel>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <CryptoPanel title="Learning Notes / Obsidian Sync" eyebrow={cryptoData.obsidianStatus ? 'BACKEND STATUS' : 'PLACEHOLDER'} icon={<Brain className="h-4 w-4" />}>
                <div className="grid grid-cols-1 gap-2">
                  <ActionRow label="Vault path" value={String(obsidianStatus.vaultPath ?? 'D:\\EDİTH\\EDİTH')} />
                  <ActionRow label="Learning folder" value={String(obsidianStatus.folder ?? 'Trading/Crypto Market Learning')} />
                  <ActionRow label="Writable" value={obsidianReady ? 'yes' : 'no / not reported'} />
                  <ActionRow label="Sync status" value={String(obsidianStatus.status ?? (runtime?.obsidianAvailable ? 'ready' : 'paused / service offline'))} />
                  <ActionRow label="Last sync" value={displayTime(obsidianStatus.lastSync ?? obsidianStatus.updatedAt ?? runtime?.lastObservationAt)} />
                </div>
                <div className="mt-3 space-y-2">
                  {(learningNotes.length ? learningNotes : SAFE_LEARNING_NOTES).slice(0, 3).map((note: any, index: number) => (
                    <div key={`${note.title ?? 'note'}-${index}`} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="text-xs font-semibold text-slate-200">{note.title ?? 'Learning note'}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{note.detail ?? note.summary ?? note.path ?? 'No note detail connected.'}</div>
                    </div>
                  ))}
                </div>
              </CryptoPanel>

              <CryptoPanel title="Paper Portfolio" eyebrow={paperTradingEnabled ? 'BACKEND ENABLED' : 'DISABLED / NOT LIVE'} icon={<TrendingUp className="h-4 w-4" />}>
                <div className="grid grid-cols-1 gap-2">
                  <ActionRow label="Starting balance" value={money(portfolio.startingBalance ?? portfolio.starting_balance)} />
                  <ActionRow label="Current paper equity" value={money(portfolio.equity)} />
                  <ActionRow label="Open paper positions" value={String(openPositions.length)} />
                  <ActionRow label="Closed trades" value={String(trades.length)} />
                  <ActionRow label="PnL" value={pct(performance.total_return_pct ?? performance.pnlPct)} />
                  <ActionRow label="Trade journal" value={trades.length ? `${trades.length} entries` : 'not connected'} />
                </div>
                <p className="mt-3 rounded-md border border-cyan-400/20 bg-cyan-400/10 p-3 text-xs text-cyan-100/75">
                  Paper data is displayed only when reported by the backend. This UI does not represent live balances or execution authority.
                </p>
              </CryptoPanel>
            </div>
          </div>

          <aside className="space-y-4">
            <CryptoPanel title="Safety Lock Panel" eyebrow="ALWAYS ON" icon={<LockKeyhole className="h-4 w-4" />}>
              <div className="space-y-2">
                <SafetyLine label="Live trading disabled" />
                <SafetyLine label="Paper trading disabled" />
                <SafetyLine label="Buy/Sell execution blocked" />
                <SafetyLine label="Execution buttons unavailable" />
                <SafetyLine label="Binance API keys hidden" />
                <SafetyLine label="Withdrawals unsupported / blocked" />
                <SafetyLine label="High-risk symbols require approval" />
                <SafetyLine label="Not financial advice" />
                <ActionRow label="Mode" value="observer only" />
                <ActionRow label="Safety status" value={runtime?.safetyStatus?.status ?? 'LOCKED'} />
                <ActionRow label="Finance integrations" value={String(financeIntegrations.length)} />
                <ActionRow label="Audit events" value={String(financeLogs.length)} />
              </div>
            </CryptoPanel>

            <CryptoPanel title="Ollama Status" eyebrow="LOCAL AI DEPENDENCY" icon={<Cpu className="h-4 w-4" />}>
              <div className="space-y-2">
                <ActionRow label="Status" value={ollamaOnline ? 'Online' : 'Offline'} />
                <ActionRow label="Model" value={String(runtimeMeta?.currentModel ?? runtimeMeta?.model ?? cryptoData.mode?.model ?? 'not reported')} />
                <ActionRow label="Last checked" value={lastChecked} />
                <ActionRow label="Error code" value={String(runtimeMeta?.ollamaErrorCode ?? runtimeMeta?.errorCode ?? (ollamaOnline ? 'none' : 'not reported'))} />
              </div>
              {!ollamaOnline && (
                <p className="mt-3 rounded-md border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-100/80">
                  Ollama is offline. AI market analysis cannot start.
                </p>
              )}
            </CryptoPanel>

            <CryptoPanel title="Obsidian Status" eyebrow={obsidianReady ? 'WRITABLE' : 'CONFIGURATION REQUIRED'} icon={<Archive className="h-4 w-4" />}>
              <div className="space-y-2">
                <ActionRow label="Vault" value={String(obsidianStatus.vaultPath ?? 'D:\\EDİTH\\EDİTH')} />
                <ActionRow label="Folder" value={String(obsidianStatus.folder ?? 'Trading/Crypto Market Learning')} />
                <ActionRow label="Writable" value={obsidianReady ? 'yes' : 'no'} />
                <ActionRow label="Last export" value={displayTime(obsidianStatus.lastExport ?? obsidianStatus.lastSync ?? runtime?.lastObservationAt)} />
              </div>
              {!obsidianReady && (
                <p className="mt-3 rounded-md border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-100/80">
                  Obsidian export is not configured.
                </p>
              )}
            </CryptoPanel>

            <CryptoPanel title="Binance Connection" eyebrow={endpointConnected ? 'SERVICE DATA' : 'SAFE PLACEHOLDER'} icon={<Network className="h-4 w-4" />}>
              <div className="space-y-2">
                <ActionRow label="Public market data" value={marketOnline ? 'available' : observerRunning ? 'checking' : 'standby'} />
                <ActionRow label="Read-only account" value="not configured" />
                <ActionRow label="Trading permission" value="disabled / locked" />
                <ActionRow label="API key" value="never displayed" />
              </div>
              {!marketOnline && (
                <p className="mt-3 rounded-md border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-100/80">
                  Market data unavailable. Backend must report Binance health before this cockpit can show real feeds.
                </p>
              )}
            </CryptoPanel>

            <CryptoPanel title="Risk Engine" eyebrow="VETO LAYER" icon={<ShieldCheck className="h-4 w-4" />}>
              <div className="space-y-2">
                <ActionRow label="Max open positions" value={String(risk.maxOpenPositions ?? risk.max_open_positions ?? 'not connected')} />
                <ActionRow label="Max allocation" value={pct(risk.maxAllocationPct ?? risk.max_allocation_pct)} />
                <ActionRow label="Max position size" value={pct(risk.maxPositionSizePct ?? risk.max_position_size_pct)} />
                <ActionRow label="Stop-loss" value={pct(risk.stopLossPct ?? risk.stop_loss_pct)} />
                <ActionRow label="Take-profit" value={pct(risk.takeProfitPct ?? risk.take_profit_pct)} />
                <ActionRow label="Risk veto count" value={String(risk.vetoCount ?? risk.veto_count ?? 'not connected')} />
                <ActionRow label="Last rejection" value={String(risk.lastRejectionReason ?? risk.last_rejection_reason ?? 'none reported')} />
              </div>
            </CryptoPanel>

            <CryptoPanel title="Observer Progress" eyebrow="OBSERVER LIFECYCLE" icon={<RadioTower className="h-4 w-4" />}>
              <div className="space-y-2">
                {[
                  ['Status', observerState],
                  ['Current symbol', runtime?.currentSymbol ?? 'none'],
                  ['Last observation', displayTime(runtime?.lastObservationAt)],
                  ['Last learning note', lastLearningNote],
                  ['Watched symbols', watchedSymbols.join(', ') || 'none'],
                  ['Ignored symbols', ignoredSymbols.join(', ') || 'none'],
                  ['Execution', 'locked'],
                ].map(([label, value], index) => (
                  <div key={label} className="flex items-center gap-3 rounded-md border border-white/10 bg-slate-950/45 px-3 py-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${observerState === 'OBSERVING' && index < 2 ? 'animate-pulse bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.9)]' : value === 'locked' ? 'bg-red-300' : 'bg-slate-500'}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-200">{label}</div>
                      <div className="truncate text-[11px] uppercase tracking-wide text-slate-500">{value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CryptoPanel>

            <CryptoPanel title="Category Rules" eyebrow="PERMISSION CONFIG" icon={<ShieldAlert className="h-4 w-4" />}>
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
                  Coin permission config not connected. Safe defaults are shown.
                </p>
              )}
            </CryptoPanel>
          </aside>
        </div>
      </div>
    </div>
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
    <section className={`relative overflow-hidden rounded-lg border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.74),rgba(2,6,12,0.88))] shadow-[0_18px_55px_rgba(0,0,0,0.24)] backdrop-blur-xl ${className}`}>
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
    <ScreenFrame title="System Diagnostics" icon={<Activity className="h-5 w-5" />} subtitle="Desktop shell, providers, permissions, tools and safe local runtime state">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
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
      </div>
      <div className="mt-4">
        <OSPanel title="Capability Review" eyebrow="SAFE BOUNDARY" icon={<ShieldAlert className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
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
                  <ActionRow label="Permissions" value={capability.requiredPermissions.join(', ') || 'none'} />
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
  const modelOptions = settings ? modelsForProvider(settings.aiProvider, providerProfiles, availableModels, settings.selectedModel) : ['auto'];
  const canEdit = Boolean(settings && onUpdateSettings);
  const [providerApiKeys, setProviderApiKeys] = React.useState<Record<string, string>>({});
  const [providerKeyStatus, setProviderKeyStatus] = React.useState<Record<string, { tone: 'success' | 'warning' | 'danger'; text: string }>>({});
  const apiKeyProviders = providerProfiles.filter((profile) =>
    ['gemini', 'openai', 'anthropic', 'openrouter'].includes(profile.provider) ||
    profile.requiredEnv.some((envName) => envName.endsWith('_API_KEY'))
  );

  const handleProviderChange = (provider: AiProvider) => {
    if (!settings || !onUpdateSettings) return;
    const nextProfile = providerProfiles.find((profile) => profile.provider === provider);
    const nextModels = modelsForProvider(provider, providerProfiles, availableModels, settings.selectedModel);
    onUpdateSettings({
      aiProvider: provider,
      selectedModel: nextModels.includes(settings.selectedModel) ? settings.selectedModel : nextProfile?.defaultModel ?? 'auto',
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

    try {
      const response = await fetch('/api/providers/dev-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error ?? `API key kaydedilemedi: ${response.status}`);
      }
      setProviderApiKeys((prev) => ({ ...prev, [provider]: '' }));
      setProviderKeyStatus((prev) => ({
        ...prev,
        [provider]: {
          tone: 'success',
          text: `${payload.requiredEnv?.[0] ?? providerDisplayName(provider)} runtime oturumuna kaydedildi.`,
        },
      }));
      onTestConnection?.();
    } catch (error) {
      setProviderKeyStatus((prev) => ({
        ...prev,
        [provider]: {
          tone: 'danger',
          text: error instanceof Error ? error.message : 'API key kaydedilemedi.',
        },
      }));
    }
  };

  return (
    <ScreenFrame title="Settings" icon={<SlidersHorizontal className="h-5 w-5" />} subtitle="Grouped settings architecture for E.D.I.T.H.">
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <ActionRow label="Assistant" value={assistant?.name ?? settings?.assistantPersona ?? 'unknown'} />
        <ActionRow label="Memory namespace" value={assistant?.memoryNamespace ?? 'not configured'} />
        <ActionRow label="Provider" value={activeProvider?.displayName ?? settings?.aiProvider ?? 'unknown'} />
        <ActionRow label="Model" value={settings?.selectedModel === 'auto' ? 'AUTO' : settings?.selectedModel ?? 'auto'} />
        <ActionRow label="Configured integrations" value={String(integrations.length)} />
        <ActionRow label="Provider source" value={providerHealth?.source === 'backend' ? 'backend endpoint' : 'frontend placeholder'} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[22rem_1fr]">
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
                    {profile.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-wide text-slate-500" htmlFor="settings-model-selector">Model</label>
              <select
                id="settings-model-selector"
                value={settings?.selectedModel ?? 'auto'}
                disabled={!canEdit}
                onChange={(event) => onUpdateSettings?.({ selectedModel: event.target.value })}
                className="w-full rounded-lg border border-white/10 bg-slate-950/75 px-3 py-2 text-xs text-slate-100 outline-none focus:border-[var(--assistant-primary)]"
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model} className="bg-slate-950 text-slate-100">
                    {model === 'auto' ? 'AUTO' : model}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/8 p-3">
              <div className="flex flex-wrap gap-1.5">
                <StatusPill label="Assistant" value={assistant?.name ?? 'Persona'} tone="info" />
                <StatusPill label="Provider" value={activeProvider?.displayName ?? 'Unknown'} tone={providerTone(activeProvider?.status ?? 'unknown')} />
                <StatusPill label="Model" value={settings?.selectedModel === 'auto' ? 'AUTO ROUTED' : settings?.selectedModel ?? 'AUTO'} tone={settings?.selectedModel === 'auto' ? 'info' : 'muted'} />
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
    <aside className="hidden w-80 shrink-0 border-l border-white/10 bg-slate-950/55 p-3 backdrop-blur-2xl 2xl:block">
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

export function ScreenFrame({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="edith-workspace overflow-y-auto p-4 custom-scrollbar">
      <div className="mx-auto max-w-7xl">
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
