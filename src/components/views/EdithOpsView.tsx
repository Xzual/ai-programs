import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ClipboardList, RefreshCw, ShieldAlert, Wrench } from 'lucide-react';

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
}

export const EdithOpsView: React.FC = () => {
  const [tools, setTools] = useState<RegistryTool[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [tasks, setTasks] = useState<EdithTask[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [toolRes, auditRes, taskRes] = await Promise.all([
        fetch('/api/edith/tools'),
        fetch('/api/edith/audit?limit=50'),
        fetch('/api/edith/tasks'),
      ]);
      const toolData = await toolRes.json();
      const auditData = await auditRes.json();
      const taskData = await taskRes.json();
      setTools(toolData.tools ?? []);
      setEvents(auditData.events ?? []);
      setTasks(taskData.tasks ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const highRiskTools = tools.filter((tool) => tool.metadata.riskLevel >= 3);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-5 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-300" />
              EDITH Ops
            </h2>
            <p className="text-xs text-slate-500 mt-1">Görevler, registry, audit ve risk durumu</p>
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
