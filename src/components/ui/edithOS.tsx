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
import { AiState, AutomationTool, ChatMessage, IntegrationConfig, MemoryItem, ToolExecutionLog, UserSettings } from '../../types';

export interface AssistantTheme {
  primary: string;
  secondary: string;
  accent: string;
  background?: string;
  surface?: string;
  text?: string;
  name: string;
  id?: string;
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
  assistantName,
  onSpeak,
}: {
  key?: React.Key;
  message: ChatMessage;
  settings: UserSettings;
  assistantName: string;
  onSpeak?: (text: string) => void;
}) {
  const user = message.sender === 'user';
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
          <StatusPill label="Model" value={settings.selectedModel || 'AUTO'} tone="muted" />
          <StatusPill label="Provider" value={settings.aiProvider.toUpperCase()} tone="info" />
          <StatusPill label={message.error ? 'FAILED' : message.isStreaming ? 'STREAMING' : 'VERIFIED'} tone={message.error ? 'danger' : message.isStreaming ? 'warning' : 'success'} />
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
            <StatusPill label="READ ONLY" tone="success" />
            <StatusPill label="Approval required for control" tone="warning" />
            <ActionRow label="Control adapters" value={String(computerTools.length)} />
            <ActionRow label="Latest audit" value={latestComputerLog?.status ?? 'none'} />
            <ActionRow label="Risk" value="No action pending" />
          </div>
          <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100">
            <Square className="h-4 w-4" /> Stop Computer Agent
          </button>
        </OSPanel>
      </div>
    </ScreenFrame>
  );
}

export function BrowserResearchScreen({ tools = [], logs = [] }: { tools?: AutomationTool[]; logs?: ToolExecutionLog[] }) {
  const browserTools = tools.filter((tool) =>
    tool.category === 'browser' ||
    tool.category === 'web' ||
    tool.permissions.some((permission) => permission.includes('browser') || permission.includes('network'))
  );
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
            <ActionRow label="Sources being evaluated" value="none active" />
            <ActionRow label="Final answer draft" value="not generated" />
          </div>
        </OSPanel>
      </div>
    </ScreenFrame>
  );
}

export function TasksScreen({ aiState = 'idle', messages = [], logs = [] }: { aiState?: AiState; messages?: ChatMessage[]; logs?: ToolExecutionLog[] }) {
  return (
    <ScreenFrame title="Tasks" icon={<Clock3 className="h-5 w-5" />} subtitle="Autonomous task timeline with checkpoints, tools, approvals and result status">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[24rem_1fr]">
        <OSPanel title="Task Status Model" eyebrow="QUEUE" icon={<CircleDot className="h-4 w-4" />}>
          <div className="flex flex-wrap gap-2">
            {['QUEUED', 'PLANNING', 'RUNNING', 'WAITING_APPROVAL', 'BLOCKED', 'RECOVERING', 'COMPLETED', 'FAILED', 'CANCELLED'].map((state) => (
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
          {logs.slice(0, 6).map((log) => <ActionRow key={log.id} label={log.toolName} value={log.status} />)}
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
  return (
    <ScreenFrame title="Voice" icon={<Mic2 className="h-5 w-5" />} subtitle="Wake word, STT, intent, assistant response and TTS pipeline">
      <OSPanel title="Voice Pipeline" eyebrow="AUDIO LOOP" icon={<Mic2 className="h-4 w-4" />}>
        <LoopBar items={['Wake Word', 'Speech Recognition', 'Intent', 'Assistant', 'Model', 'Response', 'TTS']} active={0} />
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <ActionRow label="Microphone" value="permission required" />
          <ActionRow label="Wake word" value="placeholder" />
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

export function TradingScreen({ integrations = [], tools = [], logs = [] }: { integrations?: IntegrationConfig[]; tools?: AutomationTool[]; logs?: ToolExecutionLog[] }) {
  const financeTools = tools.filter((tool) => tool.category === 'finance');
  const financeIntegrations = integrations.filter((integration) => integration.id.includes('finance') || integration.id.includes('trading'));
  return (
    <ScreenFrame title="Finance / Trading" icon={<TrendingUp className="h-5 w-5" />} subtitle="Professional, cautious trading cockpit with separate AI decision and Risk Engine">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
        <OSPanel title="Market Decision" eyebrow="PAPER MODE" icon={<TrendingUp className="h-4 w-4" />}>
          <div className="mb-4 flex flex-wrap gap-2">
            <StatusPill label="PAPER MODE" tone="success" />
            <StatusPill label="LIVE MODE LOCKED" tone="danger" />
            <RiskBadge level="MEDIUM" label="UI RISK REVIEW" />
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <ActionRow label="Finance tools" value={String(financeTools.length)} />
            <ActionRow label="Finance integrations" value={String(financeIntegrations.length)} />
            <ActionRow label="Execution logs" value={String(logs.filter((log) => financeTools.some((tool) => tool.id === log.toolId)).length)} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {['BUY', 'SELL', 'HOLD', 'NO TRADE'].map((decision) => (
              <div key={decision} className={`rounded-lg border p-4 text-center font-mono text-sm font-semibold ${decision === 'NO TRADE' ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/[0.03] text-slate-300'}`}>{decision}</div>
            ))}
          </div>
        </OSPanel>
        <OSPanel title="Risk Engine" eyebrow="VETO LAYER" icon={<ShieldCheck className="h-4 w-4" />}>
          <ActionRow label="Mode" value="UI shell only" />
          <ActionRow label="Max loss" value="not connected" />
          <ActionRow label="Live approval" value="required" />
          <ActionRow label="Backend execution" value="not implemented here" />
        </OSPanel>
      </div>
    </ScreenFrame>
  );
}

export function FilesScreen() {
  return <ScreenFrame title="Files / Documents" icon={<Archive className="h-5 w-5" />} subtitle="File context, document references and generated artifacts"><EmptyState icon={<FileText className="h-4 w-4" />} title="Dosya oturumu bekleniyor" text="E.D.I.T.H. dosya araçları çalıştığında kaynaklar, çıktılar ve doküman referansları burada görünür." /></ScreenFrame>;
}

export function SystemHealthScreen({ ollamaConnected = false, settings, tools = [], logs = [] }: { ollamaConnected?: boolean; settings?: UserSettings; tools?: AutomationTool[]; logs?: ToolExecutionLog[] }) {
  const runningTools = tools.filter((tool) => tool.status === 'running').length;
  return <ScreenFrame title="System Health" icon={<Activity className="h-5 w-5" />} subtitle="Provider, tools, automation, network and local runtime state"><OSPanel title="Runtime Status" eyebrow="SYSTEM" icon={<Activity className="h-4 w-4" />}><HealthRows rows={[['Provider', ollamaConnected ? 'connected' : `${settings?.aiProvider ?? 'provider'} degraded`, ollamaConnected], ['Registered tools', String(tools.length), true], ['Running tools', String(runningTools), runningTools === 0], ['Audit events', String(logs.length), true], ['Computer Use', 'read only shell', true]]} /></OSPanel></ScreenFrame>;
}

export function SettingsArchitectureScreen({ settings, integrations = [] }: { settings?: UserSettings; integrations?: IntegrationConfig[] }) {
  return (
    <ScreenFrame title="Settings" icon={<SlidersHorizontal className="h-5 w-5" />} subtitle="Grouped settings architecture for E.D.I.T.H.">
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <ActionRow label="Assistant persona" value={settings?.assistantPersona ?? 'unknown'} />
        <ActionRow label="Provider" value={settings?.aiProvider ?? 'unknown'} />
        <ActionRow label="Configured integrations" value={String(integrations.length)} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {['General', 'Appearance', 'Assistants', 'Models', 'Providers', 'Voice', 'Memory', 'Agents', 'Tools', 'Computer Use', 'Browser', 'Automation', 'Security', 'Trading', 'Integrations', 'Notifications', 'System', 'Advanced'].map((group) => (
          <div key={group} className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-200">{group}</div>
        ))}
      </div>
    </ScreenFrame>
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
