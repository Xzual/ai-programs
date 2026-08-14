import React, { useEffect, useState } from 'react';
import { Activity, AlertOctagon, AlertTriangle, CheckCircle2, ClipboardList, KeyRound, LockKeyhole, Power, RefreshCw, ShieldAlert, Sparkles, Trash2, Wrench } from 'lucide-react';

interface RegistryTool {
  id: string;
  metadata: {
    name: string;
    description: string;
    category: string;
    requiredPermissions: string[];
    riskLevel: number;
    dependencies: string[];
  };
}

interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  toolId: string;
  timestamp: string;
  authorization: 'allowed' | 'denied';
  riskLevel: number;
  result: 'success' | 'error' | 'denied';
  message?: string;
}

interface EdithTask {
  id: string;
  title: string;
  objective: string;
  status: string;
  createdAt: string;
  riskLevel: number;
  toolsRequired: string[];
  recoveryEvents?: Array<{
    id: string;
    action: string;
    classification: string;
    createdAt: string;
    permissionRequest?: {
      actor: string;
      toolIds: string[];
      permissions: string[];
      highRiskToolIds: string[];
      rationale: string;
    };
  }>;
}

interface KillSwitchState {
  active: boolean;
  reason: string;
  activatedAt?: string;
  activatedBy?: string;
  deactivatedAt?: string;
  deactivatedBy?: string;
  disabledCapabilities: string[];
}

interface PermissionPolicy {
  highRiskEnabled: boolean;
  defaultLocalPermissions: string[];
  highRiskPermissions: string[];
  authorizedPermissions: string[];
  activeGrants: number;
}

interface PermissionGrant {
  id: string;
  actor: string;
  permissions: string[];
  toolIds?: string[];
  reason: string;
  grantedBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokedBy?: string;
}

interface PermissionRequestItem {
  id: string;
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  recoveryId: string;
  actor: string;
  toolIds: string[];
  permissions: string[];
  highRiskToolIds: string[];
  rationale: string;
  createdAt: string;
}

export const EdithOpsView: React.FC = () => {
  const [tools, setTools] = useState<RegistryTool[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [tasks, setTasks] = useState<EdithTask[]>([]);
  const [killSwitch, setKillSwitch] = useState<KillSwitchState | null>(null);
  const [permissionPolicy, setPermissionPolicy] = useState<PermissionPolicy | null>(null);
  const [permissionGrants, setPermissionGrants] = useState<PermissionGrant[]>([]);
  const [killReason, setKillReason] = useState('Manual emergency stop from EDITH Ops.');
  const [grantToolId, setGrantToolId] = useState('');
  const [grantReason, setGrantReason] = useState('Temporary high-risk permission from EDITH Ops.');
  const [grantTtlMinutes, setGrantTtlMinutes] = useState(15);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [grantBusy, setGrantBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [toolRes, auditRes, taskRes, killSwitchRes, permissionPolicyRes, permissionGrantsRes] = await Promise.all([
        fetch('/api/edith/tools'),
        fetch('/api/edith/audit?limit=50'),
        fetch('/api/edith/tasks'),
        fetch('/api/edith/kill-switch'),
        fetch('/api/edith/permissions/policy'),
        fetch('/api/edith/permissions/grants?includeExpired=true&includeRevoked=true'),
      ]);
      const toolData = await toolRes.json();
      const auditData = await auditRes.json();
      const taskData = await taskRes.json();
      const killSwitchData = await killSwitchRes.json();
      const permissionPolicyData = await permissionPolicyRes.json();
      const permissionGrantsData = await permissionGrantsRes.json();
      setTools(toolData.tools ?? []);
      setEvents(auditData.events ?? []);
      setTasks(taskData.tasks ?? []);
      setKillSwitch(killSwitchData.state ?? null);
      setPermissionPolicy(permissionPolicyData.policy ?? null);
      setPermissionGrants(permissionGrantsData.grants ?? []);
      if (!grantToolId && (toolData.tools ?? []).length > 0) {
        const firstHighRisk = (toolData.tools as RegistryTool[]).find((tool) => tool.metadata.riskLevel >= 3);
        if (firstHighRisk) setGrantToolId(firstHighRisk.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'EDITH Ops verileri alınamadı.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const highRiskTools = tools.filter((tool) => tool.metadata.riskLevel >= 3);
  const pausedTasks = tasks.filter((task) => task.status === 'PAUSED').length;
  const selectedGrantTool = highRiskTools.find((tool) => tool.id === grantToolId) ?? highRiskTools[0];
  const activeGrants = permissionGrants.filter((grant) => !grant.revokedAt && Date.parse(grant.expiresAt) > Date.now());
  const permissionRequests: PermissionRequestItem[] = tasks.flatMap((task) =>
    (task.recoveryEvents ?? []).flatMap((event) => {
      if (event.action !== 'WAIT_PERMISSION' || !event.permissionRequest) return [];
      return [{
        id: `${task.id}:${event.id}`,
        taskId: task.id,
        taskTitle: task.title,
        taskStatus: task.status,
        recoveryId: event.id,
        actor: event.permissionRequest.actor,
        toolIds: event.permissionRequest.toolIds,
        permissions: event.permissionRequest.permissions,
        highRiskToolIds: event.permissionRequest.highRiskToolIds,
        rationale: event.permissionRequest.rationale,
        createdAt: event.createdAt,
      }];
    })
  );

  const setKillSwitchActive = async (active: boolean) => {
    setSwitching(true);
    setError(null);
    try {
      const response = await fetch(`/api/edith/kill-switch/${active ? 'activate' : 'deactivate'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: active ? JSON.stringify({ reason: killReason }) : undefined,
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? 'Kill switch güncellenemedi.');
      }
      setKillSwitch(data.state);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Kill switch güncellenemedi.');
    } finally {
      setSwitching(false);
    }
  };

  const createPermissionGrant = async () => {
    if (!selectedGrantTool) return;
    setGrantBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/edith/permissions/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor: 'aura-dashboard',
          permissions: selectedGrantTool.metadata.requiredPermissions,
          toolIds: [selectedGrantTool.id],
          reason: grantReason,
          ttlMs: Math.max(1, grantTtlMinutes) * 60 * 1000,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? 'Permission grant oluşturulamadı.');
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Permission grant oluşturulamadı.');
    } finally {
      setGrantBusy(false);
    }
  };

  const createGrantFromRequest = async (request: PermissionRequestItem) => {
    setGrantBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/edith/permissions/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor: request.actor,
          permissions: request.permissions,
          toolIds: request.toolIds,
          reason: `Recovery permission request ${request.recoveryId} for task ${request.taskId}: ${request.rationale}`,
          ttlMs: Math.max(1, grantTtlMinutes) * 60 * 1000,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? 'Recovery permission grant oluşturulamadı.');
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Recovery permission grant oluşturulamadı.');
    } finally {
      setGrantBusy(false);
    }
  };

  const revokePermissionGrant = async (grantId: string) => {
    setGrantBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/edith/permissions/grants/${grantId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? 'Permission grant iptal edilemedi.');
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Permission grant iptal edilemedi.');
    } finally {
      setGrantBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-5 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-300" />
              EDITH Ops
            </h2>
            <p className="text-xs text-slate-500 mt-1">Görevler, registry, audit, kill switch ve risk durumu</p>
          </div>
          <button
            onClick={refresh}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 hover:border-cyan-500/40 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Metric title="Registry Tool" value={tools.length} icon={<Wrench className="w-4 h-4" />} />
          <Metric title="High Risk" value={highRiskTools.length} icon={<ShieldAlert className="w-4 h-4" />} />
          <Metric title="Task" value={tasks.length} icon={<ClipboardList className="w-4 h-4" />} />
          <Metric title="Audit Event" value={events.length} icon={<Activity className="w-4 h-4" />} />
        </div>

        {error && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-xs text-amber-100">
            {error}
          </div>
        )}

        <section className={`rounded-lg border p-4 ${killSwitch?.active ? 'border-red-500/35 bg-red-950/20' : 'border-emerald-500/25 bg-emerald-950/10'}`}>
          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${killSwitch?.active ? 'border-red-400/40 bg-red-500/10 text-red-200' : 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200'}`}>
                {killSwitch?.active ? <AlertOctagon className="w-5 h-5" /> : <LockKeyhole className="w-5 h-5" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className={`text-sm font-semibold ${killSwitch?.active ? 'text-red-100' : 'text-emerald-100'}`}>
                    Kill Switch {killSwitch?.active ? 'AKTİF' : 'Hazır'}
                  </h3>
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-mono ${killSwitch?.active ? 'text-red-200 border-red-400/30 bg-red-950/40' : 'text-emerald-200 border-emerald-400/30 bg-emerald-950/30'}`}>
                    {killSwitch?.active ? 'STOPPING ACTIONS' : 'ALLOWING ACTIONS'}
                  </span>
                </div>
                <p className={`mt-1 text-xs ${killSwitch?.active ? 'text-red-100/75' : 'text-emerald-100/70'}`}>
                  Aktif olduğunda yeni task creation ve tool execution backend tarafında durdurulur; audit ve mevcut task state korunur.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(killSwitch?.disabledCapabilities ?? ['task_creation', 'tool_execution', 'browser_control', 'computer_control', 'trading_execution', 'proactive_tasks']).map((capability) => (
                    <span key={capability} className="px-2 py-0.5 rounded bg-slate-950/50 border border-slate-800 text-[10px] text-slate-400 font-mono">
                      {capability}
                    </span>
                  ))}
                </div>
                {killSwitch?.active && (
                  <div className="mt-3 text-[11px] text-red-100/70 font-mono">
                    {killSwitch.reason || 'No reason'} · {killSwitch.activatedAt ? new Date(killSwitch.activatedAt).toLocaleString('tr-TR') : 'time unknown'}
                  </div>
                )}
              </div>
            </div>

            <div className="w-full xl:w-96 space-y-2">
              <textarea
                value={killReason}
                onChange={(event) => setKillReason(event.target.value)}
                disabled={killSwitch?.active || switching}
                rows={2}
                className="w-full rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-400/50 disabled:opacity-50"
                placeholder="Emergency stop sebebi..."
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setKillSwitchActive(true)}
                  disabled={Boolean(killSwitch?.active) || switching}
                  className="px-3 py-2 rounded-lg border border-red-500/35 bg-red-950/30 text-xs text-red-100 hover:bg-red-900/35 disabled:opacity-45 disabled:hover:bg-red-950/30 flex items-center justify-center gap-2"
                >
                  <Power className="w-4 h-4" />
                  Durdur
                </button>
                <button
                  onClick={() => setKillSwitchActive(false)}
                  disabled={!killSwitch?.active || switching}
                  className="px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 text-xs text-emerald-100 hover:bg-emerald-900/25 disabled:opacity-45 disabled:hover:bg-emerald-950/20 flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Devam Et
                </button>
              </div>
              <div className="text-[10px] text-slate-600 font-mono flex items-center justify-between">
                <span>paused tasks: {pausedTasks}</span>
                <span>{switching ? 'updating...' : 'backend enforced'}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-red-500/20 bg-red-950/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-red-100">High-risk kontrol</h3>
              <p className="text-xs text-red-200/75 mt-1">
                Full computer control, Open Interpreter ve browser-use adapterları registry'de mevcut. Server
                `EDITH_ENABLE_HIGH_RISK_TOOLS=true` ile başlatılmadıkça yürütme kapısı izin vermez.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-4">
          {permissionRequests.length > 0 && (
            <div className="mb-4 rounded-lg border border-orange-400/25 bg-orange-950/20 p-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-orange-200" />
                <h4 className="text-xs font-semibold text-orange-100">Recovery Permission Requests</h4>
                <span className="px-2 py-0.5 rounded border border-orange-400/30 bg-orange-950/35 text-[10px] text-orange-200 font-mono">
                  {permissionRequests.length} pending
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2">
                {permissionRequests.slice(0, 4).map((request) => (
                  <div key={request.id} className="rounded-lg border border-slate-800 bg-slate-950/55 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-slate-100 font-medium truncate">{request.taskTitle}</div>
                        <div className="mt-1 text-[10px] text-slate-500 font-mono">
                          {request.actor} · {request.taskStatus} · {new Date(request.createdAt).toLocaleTimeString('tr-TR')}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded border border-red-500/30 bg-red-950/30 text-[10px] text-red-200 font-mono">
                        WAIT_PERMISSION
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {request.permissions.map((permission) => (
                        <span key={permission} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-amber-200 font-mono">
                          {permission}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500 line-clamp-2">{request.rationale}</p>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="text-[10px] text-slate-600 font-mono truncate">
                        {request.toolIds.join(', ') || 'all tools'}
                      </div>
                      <button
                        onClick={() => createGrantFromRequest(request)}
                        disabled={grantBusy || request.permissions.length === 0}
                        className="px-2 py-1 rounded-md border border-orange-400/30 bg-orange-950/30 text-[10px] text-orange-100 hover:bg-orange-900/30 disabled:opacity-40 flex items-center gap-1"
                      >
                        <KeyRound className="w-3 h-3" />
                        grant
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col xl:flex-row gap-4 justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-300" />
                <h3 className="text-sm font-semibold text-amber-100">Permission Review</h3>
                <span className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-950/30 text-[10px] text-amber-200 font-mono">
                  {activeGrants.length} active grant
                </span>
              </div>
              <p className="text-xs text-amber-100/70 mt-1">
                High-risk araçlar için actor/tool scope'lu ve süreli backend grant oluşturur. Grant süresi bitince veya revoke edilince izin otomatik düşer.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(permissionPolicy?.authorizedPermissions ?? []).map((permission) => (
                  <span key={permission} className="px-2 py-0.5 rounded bg-slate-950/50 border border-slate-800 text-[10px] text-slate-400 font-mono">
                    {permission}
                  </span>
                ))}
              </div>
            </div>

            <div className="w-full xl:w-[34rem] grid grid-cols-1 md:grid-cols-[1fr_6rem] gap-2">
              <select
                value={selectedGrantTool?.id ?? grantToolId}
                onChange={(event) => setGrantToolId(event.target.value)}
                disabled={grantBusy || highRiskTools.length === 0}
                className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-400/50"
              >
                {highRiskTools.map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.metadata.name} · R{tool.metadata.riskLevel}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={60}
                value={grantTtlMinutes}
                onChange={(event) => setGrantTtlMinutes(Number(event.target.value))}
                disabled={grantBusy}
                className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-400/50"
              />
              <textarea
                value={grantReason}
                onChange={(event) => setGrantReason(event.target.value)}
                disabled={grantBusy}
                rows={2}
                className="md:col-span-2 rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-400/50"
                placeholder="Grant sebebi..."
              />
              <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] text-slate-500 font-mono">
                  {selectedGrantTool ? selectedGrantTool.metadata.requiredPermissions.join(', ') : 'no high-risk tool'}
                </div>
                <button
                  onClick={createPermissionGrant}
                  disabled={!selectedGrantTool || grantBusy}
                  className="px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-950/25 text-xs text-amber-100 hover:bg-amber-900/25 disabled:opacity-45 flex items-center gap-2"
                >
                  <KeyRound className="w-4 h-4" />
                  Grant Oluştur
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-2">
            {permissionGrants.slice(0, 6).map((grant) => {
              const active = !grant.revokedAt && Date.parse(grant.expiresAt) > Date.now();
              return (
                <div key={grant.id} className="rounded-lg border border-slate-800 bg-slate-900/55 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-100 font-mono truncate">{grant.toolIds?.join(', ') || 'all tools'}</div>
                      <div className="mt-1 text-[10px] text-slate-500 font-mono">{grant.actor} · {grant.permissions.join(', ')}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-mono ${active ? 'text-emerald-300 border-emerald-500/30 bg-emerald-950/30' : 'text-slate-400 border-slate-700 bg-slate-950/50'}`}>
                      {active ? 'ACTIVE' : grant.revokedAt ? 'REVOKED' : 'EXPIRED'}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 line-clamp-2">{grant.reason}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-[10px] text-slate-600 font-mono">
                      until {new Date(grant.expiresAt).toLocaleTimeString('tr-TR')}
                    </div>
                    <button
                      onClick={() => revokePermissionGrant(grant.id)}
                      disabled={!active || grantBusy}
                      className="px-2 py-1 rounded-md border border-slate-700 text-[10px] text-slate-300 hover:border-red-400/40 hover:text-red-200 disabled:opacity-40 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      revoke
                    </button>
                  </div>
                </div>
              );
            })}
            {permissionGrants.length === 0 && <Empty text="Henüz permission grant yok." />}
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Panel title="Registry">
            <div className="space-y-2">
              {tools.map((tool) => (
                <div key={tool.id} className="p-3 rounded-lg border border-slate-800 bg-slate-900/60">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-100">{tool.metadata.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{tool.id}</div>
                    </div>
                    <RiskBadge level={tool.metadata.riskLevel} />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{tool.metadata.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tool.metadata.requiredPermissions.map((permission) => (
                      <span key={permission} className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-400 font-mono">
                        {permission}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Audit">
            <div className="space-y-2">
              {events.length === 0 && <Empty text="Henüz audit kaydı yok." />}
              {events.map((event) => (
                <div key={event.id} className="p-3 rounded-lg border border-slate-800 bg-slate-900/60">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-200 font-mono truncate">{event.toolId}</div>
                      <div className="text-[10px] text-slate-500">{new Date(event.timestamp).toLocaleString('tr-TR')}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] border ${event.result === 'success' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-950/30' : 'text-amber-300 border-amber-500/30 bg-amber-950/30'}`}>
                      {event.result}
                    </span>
                  </div>
                  {event.message && <p className="mt-2 text-[11px] text-slate-500 line-clamp-2">{event.message}</p>}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <Panel title="Tasks">
          <div className="space-y-2">
            {tasks.length === 0 && <Empty text="Henüz kalıcı görev yok." />}
            {tasks.map((task) => (
              <div key={task.id} className="p-3 rounded-lg border border-slate-800 bg-slate-900/60 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-100 font-medium">{task.title}</div>
                  <p className="text-xs text-slate-400 mt-1">{task.objective}</p>
                  <div className="text-[10px] text-slate-600 mt-2 font-mono">{task.id}</div>
                </div>
                <span className="px-2 py-1 rounded border border-cyan-500/30 bg-cyan-950/20 text-cyan-200 text-[10px] font-mono">
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
};

function Metric({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between text-slate-400">
        <span className="text-xs">{title}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-950/60">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-cyan-300" />
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      </div>
      <div className="p-4 max-h-[520px] overflow-y-auto custom-scrollbar">{children}</div>
    </section>
  );
}

function RiskBadge({ level }: { level: number }) {
  const cls = level >= 4 ? 'text-red-300 border-red-500/30 bg-red-950/30' : level >= 3 ? 'text-amber-300 border-amber-500/30 bg-amber-950/30' : 'text-emerald-300 border-emerald-500/30 bg-emerald-950/30';
  return <span className={`px-2 py-0.5 rounded border text-[10px] font-mono ${cls}`}>R{level}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="p-4 rounded-lg border border-dashed border-slate-800 text-xs text-slate-500">{text}</div>;
}
