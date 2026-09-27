import React from 'react';
import {
  Activity,
  Bot,
  Brain,
  BriefcaseBusiness,
  ChevronDown,
  Cpu,
  Database,
  FolderCog,
  LockKeyhole,
  Mic2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  WalletCards,
} from 'lucide-react';
import type { ActiveTab } from '../layout/Sidebar';
import type { AiProvider, AssistantProfile, ProviderProfile, UserSettings } from '../../types';
import {
  modelDisabledReason,
  modelsForProvider,
  providerStatusLabel,
  selectValidModelForProvider,
} from '../../edith/providerService';
import {
  fetchSettingsRuntimeSnapshot,
  type SettingsRuntimeSnapshot,
  type SettingsSkillSnapshot,
  type SettingsSkillStatus,
} from '../../edith/settingsRuntimeService';

type SettingsSection = 'voice' | 'computer' | 'crypto' | 'workspace' | 'account' | 'privacy';

interface FocusedSettingsScreenProps {
  settings: UserSettings;
  assistant?: AssistantProfile;
  providerProfiles?: ProviderProfile[];
  availableModels?: string[];
  accountName?: string;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
  onNavigate?: (tab: ActiveTab) => void;
  onRefreshProviders?: () => void;
  isRefreshingProviders?: boolean;
}

const sections: Array<{ id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'voice', label: 'Voice', icon: Mic2 },
  { id: 'computer', label: 'Computer', icon: Cpu },
  { id: 'crypto', label: 'Crypto', icon: WalletCards },
  { id: 'workspace', label: 'Workspace', icon: FolderCog },
  { id: 'account', label: 'Account', icon: UserRound },
  { id: 'privacy', label: 'Privacy', icon: LockKeyhole },
];

const skillForSection: Partial<Record<SettingsSection, string>> = {
  voice: 'voice_room',
  computer: 'computer_use',
  crypto: 'crypto_demo_exchange',
  workspace: 'workspace_manager',
  account: 'supabase_registry',
};

const statusClasses: Record<SettingsSkillStatus | 'loading' | 'unknown', string> = {
  ready: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  degraded: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
  config_required: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
  offline: 'border-red-400/30 bg-red-400/10 text-red-200',
  broken: 'border-red-400/30 bg-red-400/10 text-red-200',
  disabled: 'border-slate-400/20 bg-slate-400/8 text-slate-300',
  planned: 'border-violet-300/25 bg-violet-300/10 text-violet-200',
  unavailable: 'border-slate-400/20 bg-slate-400/8 text-slate-300',
  loading: 'border-cyan-300/25 bg-cyan-300/8 text-cyan-200',
  unknown: 'border-slate-400/20 bg-slate-400/8 text-slate-300',
};

export function FocusedSettingsScreen({
  settings,
  assistant,
  providerProfiles = [],
  availableModels = [],
  accountName,
  onUpdateSettings,
  onNavigate,
  onRefreshProviders,
  isRefreshingProviders = false,
}: FocusedSettingsScreenProps) {
  const [activeSection, setActiveSection] = React.useState<SettingsSection>('voice');
  const [runtime, setRuntime] = React.useState<SettingsRuntimeSnapshot>({ skills: [] });
  const [loading, setLoading] = React.useState(true);

  const refreshRuntime = React.useCallback(async () => {
    setLoading(true);
    const next = await fetchSettingsRuntimeSnapshot();
    setRuntime(next);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    let mounted = true;
    setLoading(true);
    void fetchSettingsRuntimeSnapshot().then((next) => {
      if (!mounted) return;
      setRuntime(next);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  const selectedSkill = runtime.skills.find((skill) => skill.id === skillForSection[activeSection]);

  return (
    <section className="edith-responsive-pad min-h-full text-slate-100">
      <div className="edith-responsive-container-wide mx-auto space-y-4">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase text-cyan-300">
              <SlidersHorizontal className="h-3.5 w-3.5" /> E.D.I.T.H. control surface
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-white">Settings</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">Core controls stay compact. Runtime badges come from the live capability registry.</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshRuntime()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 self-start rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.06] disabled:opacity-50 lg:self-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh status
          </button>
        </header>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:block xl:space-y-1">
            {sections.map((section) => {
              const Icon = section.icon;
              const status = runtime.skills.find((skill) => skill.id === skillForSection[section.id]);
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={`flex min-w-0 items-center gap-2 rounded-md border px-3 py-2.5 text-left text-xs font-semibold transition xl:w-full ${active ? 'border-cyan-300/35 bg-cyan-300/10 text-cyan-100' : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.03] hover:text-slate-200'}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{section.label}</span>
                  {status && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.status === 'ready' ? 'bg-emerald-400' : status.status === 'offline' || status.status === 'broken' ? 'bg-red-400' : 'bg-amber-300'}`} aria-hidden="true" />}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 space-y-4">
            <RuntimeCard skill={selectedSkill} loading={loading} error={runtime.registryError} />
            <SectionContent
              section={activeSection}
              settings={settings}
              runtime={runtime}
              accountName={accountName}
              onUpdateSettings={onUpdateSettings}
              onNavigate={onNavigate}
            />
          </div>
        </div>

        <details className="group rounded-lg border border-white/10 bg-slate-950/45 open:border-cyan-300/20">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-200">
            <Settings2 className="h-4 w-4 text-cyan-300" />
            Advanced
            <span className="ml-auto text-[11px] font-normal text-slate-500">Persona, provider, model and developer routes</span>
            <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
          </summary>
          <AdvancedSettings
            settings={settings}
            assistant={assistant}
            providerProfiles={providerProfiles}
            availableModels={availableModels}
            onUpdateSettings={onUpdateSettings}
            onNavigate={onNavigate}
            onRefreshProviders={onRefreshProviders}
            isRefreshingProviders={isRefreshingProviders}
          />
        </details>
      </div>
    </section>
  );
}

function RuntimeCard({ skill, loading, error }: { skill?: SettingsSkillSnapshot; loading: boolean; error?: string }) {
  const status = loading ? 'loading' : skill?.status ?? 'unknown';
  const label = loading ? 'checking' : skill?.status.replaceAll('_', ' ') ?? 'unavailable';
  return (
    <div className="rounded-lg border border-white/10 bg-[var(--edith-panel)] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase text-slate-500">Capability registry</div>
          <h2 className="mt-1 text-base font-semibold text-white">{skill?.name ?? 'Runtime status'}</h2>
        </div>
        <span className={`rounded border px-2 py-1 font-mono text-[10px] font-semibold uppercase ${statusClasses[status]}`}>{label}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">{error ?? skill?.readiness.reason ?? (loading ? 'Reading current backend capability state.' : 'No registry status was returned for this capability.')}</p>
      {skill?.limitations?.length ? <p className="mt-2 text-xs text-slate-500">Limit: {skill.limitations[0]}</p> : null}
    </div>
  );
}

function SectionContent({
  section,
  settings,
  runtime,
  accountName,
  onUpdateSettings,
  onNavigate,
}: {
  section: SettingsSection;
  settings: UserSettings;
  runtime: SettingsRuntimeSnapshot;
  accountName?: string;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
  onNavigate?: (tab: ActiveTab) => void;
}) {
  if (section === 'voice') return (
    <SettingsPanel title="Voice behavior" icon={<Mic2 className="h-4 w-4" />}>
      <ToggleRow label="Automatic speech" description="Read assistant responses aloud when the active voice runtime supports it." checked={settings.autoSpeech} onChange={(checked) => onUpdateSettings({ autoSpeech: checked })} />
      <ToggleRow label="Hands-free mode" description="Keep voice interaction open between turns. Microphone permission remains explicit." checked={settings.voiceHandsFree} onChange={(checked) => onUpdateSettings({ voiceHandsFree: checked })} />
      <SelectRow label="Speech recognition" value={settings.sttEngine} onChange={(value) => onUpdateSettings({ sttEngine: value as UserSettings['sttEngine'] })} options={[['webspeech', 'Web Speech'], ['whisper', 'Whisper']]} />
      <SelectRow label="Speech output" value={settings.ttsEngine} onChange={(value) => onUpdateSettings({ ttsEngine: value as UserSettings['ttsEngine'] })} options={[['webspeech', 'Web Speech'], ['piper', 'Piper'], ['claude_voice', 'Claude Voice (requires backend config)']]} />
      <RouteButton label="Open Voice Room" onClick={() => onNavigate?.('voice')} />
    </SettingsPanel>
  );

  if (section === 'computer') return (
    <SettingsPanel title="Computer Use safety" icon={<ShieldCheck className="h-4 w-4" />}>
      <InfoGrid items={[
        ['Control mode', 'Owner-approved session'],
        ['Sensitive actions', 'Confirmation required'],
        ['Emergency stop', 'Always available'],
        ['Runtime truth', 'Capability registry'],
      ]} />
      <p className="text-xs leading-5 text-slate-500">This page does not unlock desktop control. Session approval and the kill switch remain in the Computer Use cockpit.</p>
      <RouteButton label="Open Computer Use" onClick={() => onNavigate?.('computer')} />
    </SettingsPanel>
  );

  if (section === 'crypto') return (
    <SettingsPanel title="Crypto demo safety" icon={<WalletCards className="h-4 w-4" />}>
      <InfoGrid items={[
        ['Mode', 'DEMO ONLY'],
        ['Real money', 'OFF'],
        ['Live execution', 'BLOCKED'],
        ['Market access', 'Public/read-only when available'],
      ]} />
      <p className="text-xs leading-5 text-slate-500">Connection and model readiness are reported by the backend registry. This settings surface never implies live trading.</p>
      <RouteButton label="Open Crypto Demo" onClick={() => onNavigate?.('crypto')} />
    </SettingsPanel>
  );

  if (section === 'workspace') {
    const workspace = runtime.workspace;
    return (
      <SettingsPanel title="Local workspace" icon={<BriefcaseBusiness className="h-4 w-4" />}>
        <InfoGrid items={[
          ['State', workspace?.state?.replaceAll('_', ' ') ?? 'unavailable'],
          ['Workspace', workspace?.workspaceRoot ?? 'Not configured'],
          ['Obsidian vault', workspace?.obsidianVaultPath ?? 'Not configured'],
          ['Access', workspace ? `${workspace.readable ? 'readable' : 'not readable'} / ${workspace.writable ? 'writable' : 'read-only'}` : 'unknown'],
          ['Portable mode', workspace ? workspace.portableMode ? 'enabled' : 'disabled' : 'unknown'],
          ['Last validated', workspace?.lastValidated ? new Date(workspace.lastValidated).toLocaleString() : 'not available'],
        ]} />
        <p className={`text-xs leading-5 ${runtime.workspaceError ? 'text-red-300' : 'text-slate-500'}`}>{runtime.workspaceError ?? workspace?.safeMessage ?? 'Workspace status endpoint did not return a configured workspace.'}</p>
        {workspace?.persistenceRestartRequired && <p className="text-xs text-amber-200">Persistence path changed. Restart is required before the new location is active.</p>}
        <RouteButton label="Open Files" onClick={() => onNavigate?.('files')} />
      </SettingsPanel>
    );
  }

  if (section === 'account') return (
    <SettingsPanel title="Account and registry" icon={<Database className="h-4 w-4" />}>
      <InfoGrid items={[
        ['Local profile', accountName ?? (settings.userName || 'Not identified')],
        ['Supabase registry', runtime.skills.find((skill) => skill.id === 'supabase_registry')?.status ?? 'unavailable'],
        ['Cloud auth', 'Not inferred'],
        ['Metadata sync', 'Local unless backend reports otherwise'],
      ]} />
      <p className="text-xs leading-5 text-slate-500">The registry is never shown as connected without backend confirmation. Environment variables or UI labels are not treated as proof of authentication.</p>
      <RouteButton label="Open Integrations" onClick={() => onNavigate?.('integrations')} />
    </SettingsPanel>
  );

  return (
    <SettingsPanel title="Privacy" icon={<LockKeyhole className="h-4 w-4" />}>
      <ToggleRow label="Memory" description="Allow E.D.I.T.H. to use the configured local memory system. Provider secrets are never displayed here." checked={settings.memoryEnabled} onChange={(checked) => onUpdateSettings({ memoryEnabled: checked })} />
      <InfoGrid items={[
        ['Provider', settings.aiProvider],
        ['Provider privacy', settings.aiProvider === 'ollama' || settings.aiProvider === 'local' ? 'local' : 'cloud or routed'],
        ['API keys', 'Backend environment only'],
        ['Settings storage', 'Non-secret preferences only'],
      ]} />
      <RouteButton label="Open Security Center" onClick={() => onNavigate?.('security')} />
    </SettingsPanel>
  );
}

function AdvancedSettings({
  settings,
  assistant,
  providerProfiles,
  availableModels,
  onUpdateSettings,
  onNavigate,
  onRefreshProviders,
  isRefreshingProviders,
}: Omit<FocusedSettingsScreenProps, 'accountName'>) {
  const models = modelsForProvider(settings.aiProvider, providerProfiles, availableModels);
  const selectedModel = selectValidModelForProvider(settings.aiProvider, providerProfiles, availableModels, settings.selectedModel);

  React.useEffect(() => {
    if (selectedModel !== settings.selectedModel) onUpdateSettings({ selectedModel });
  }, [onUpdateSettings, selectedModel, settings.selectedModel]);

  const changeProvider = (provider: AiProvider) => {
    onUpdateSettings({
      aiProvider: provider,
      selectedModel: selectValidModelForProvider(provider, providerProfiles, availableModels, settings.selectedModel),
    });
  };

  return (
    <div className="border-t border-white/10 p-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Control label="Assistant persona" hint="Independent from provider and model.">
          <select value={settings.assistantPersona} onChange={(event) => onUpdateSettings({ assistantPersona: event.target.value as UserSettings['assistantPersona'] })} className="w-full rounded-md border border-white/10 bg-slate-950/75 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-cyan-300/40">
            {['jarvis', 'friday', 'ultron', 'karen', 'alfred', 'homer'].map((persona) => <option key={persona} value={persona}>{persona.toUpperCase()}</option>)}
          </select>
        </Control>
        <Control label="Provider" hint={`Active persona remains ${assistant?.name ?? settings.assistantPersona.toUpperCase()}.`}>
          <select value={settings.aiProvider} onChange={(event) => changeProvider(event.target.value as AiProvider)} className="w-full rounded-md border border-white/10 bg-slate-950/75 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-cyan-300/40">
            {providerProfiles.map((profile) => <option key={profile.provider} value={profile.provider}>{profile.displayName} · {providerStatusLabel(profile.status)}</option>)}
          </select>
        </Control>
        <Control label="Model" hint="Unavailable models remain disabled.">
          <select value={selectedModel} onChange={(event) => onUpdateSettings({ selectedModel: event.target.value })} className="w-full rounded-md border border-white/10 bg-slate-950/75 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-cyan-300/40">
            {models.map((model) => {
              const reason = modelDisabledReason(settings.aiProvider, model, providerProfiles, availableModels);
              return <option key={model} value={model} disabled={Boolean(reason)}>{model === 'auto' ? 'AUTO' : model}{reason ? ` · ${reason}` : ''}</option>;
            })}
          </select>
        </Control>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <span className="mr-1 font-mono text-[10px] uppercase text-slate-500">Developer routes</span>
        {(['dashboard', 'chat', 'agents', 'tasks', 'browser', 'memory', 'knowledge', 'automations', 'tools', 'system'] as ActiveTab[]).map((tab) => (
          <button key={tab} type="button" onClick={() => onNavigate?.(tab)} className="rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] capitalize text-slate-400 transition hover:border-cyan-300/30 hover:text-cyan-100">{tab}</button>
        ))}
        {onRefreshProviders && <button type="button" onClick={onRefreshProviders} disabled={isRefreshingProviders} className="ml-auto inline-flex items-center gap-2 rounded border border-cyan-300/25 bg-cyan-300/[0.06] px-3 py-1.5 text-[11px] font-semibold text-cyan-100 disabled:opacity-50"><Activity className={`h-3.5 w-3.5 ${isRefreshingProviders ? 'animate-spin' : ''}`} />Refresh providers</button>}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">API keys are intentionally absent. Configure provider secrets in the backend environment; they are never saved to localStorage or echoed by this screen.</p>
    </div>
  );
}

function SettingsPanel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="space-y-4 rounded-lg border border-white/10 bg-[var(--edith-panel)] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-white"><span className="text-cyan-300">{icon}</span>{title}</div>{children}</div>;
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-center gap-4 rounded-md border border-white/10 bg-slate-950/40 p-3"><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-100">{label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-cyan-400" /></label>;
}

function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <label className="grid gap-2 text-xs text-slate-400 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] sm:items-center"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-white/10 bg-slate-950/75 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-cyan-300/40">{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return <div className="grid gap-2 sm:grid-cols-2">{items.map(([label, value]) => <div key={label} className="min-w-0 rounded-md border border-white/10 bg-slate-950/40 p-3"><div className="font-mono text-[9px] uppercase text-slate-500">{label}</div><div className="mt-1 break-words text-xs text-slate-200">{value}</div></div>)}</div>;
}

function RouteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/[0.06] px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-300/10"><Bot className="h-3.5 w-3.5" />{label}</button>;
}

function Control({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return <label className="space-y-2"><span className="flex items-center gap-2 text-xs font-semibold text-slate-200"><Brain className="h-3.5 w-3.5 text-cyan-300" />{label}</span>{children}<span className="block text-[11px] leading-4 text-slate-500">{hint}</span></label>;
}
