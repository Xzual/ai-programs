import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Boxes,
  Braces,
  Camera,
  CheckCircle2,
  Download,
  FileClock,
  Gauge,
  GitBranch,
  Layers3,
  Play,
  RotateCcw,
  Ruler,
  Send,
  TriangleAlert,
  Wrench,
} from 'lucide-react';

type EngineStatus = 'CONFIGURATION_REQUIRED' | 'AVAILABLE' | 'UNAVAILABLE';

interface Design3dComponent {
  id: string;
  name: string;
  type: 'part' | 'assembly' | 'constraint' | 'material' | 'simulation' | 'export';
  material?: string;
  dimensionsMm: { x: number; y: number; z: number };
  transform: { x: number; y: number; z: number; rx: number; ry: number; rz: number };
  status: 'planned' | 'generated' | 'validated' | 'blocked';
}

interface Design3dProject {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  activeEngine: string;
  components: Design3dComponent[];
  parameters: Record<string, number | string | boolean>;
  history: string[];
  exportFormats: string[];
  engineStatus: Record<string, EngineStatus>;
}

interface EngineReportItem {
  status: EngineStatus;
  role: string;
  notes: string;
}

interface ArchitectureTechnology {
  id: string;
  name: string;
  role: string;
  bindingStatus: EngineStatus;
  activationRequirement: string;
  reference: string;
}

interface LocalToolProbe {
  id: string;
  label: string;
  status: 'detected' | 'missing' | 'configuration_required';
  executablePath?: string;
  requiredFor: string[];
  startsProcess: false;
  notes: string;
}

interface ArchitectureReport {
  generatedAt: string;
  principle: string;
  localProbes: LocalToolProbe[];
  selectedTechnologies: ArchitectureTechnology[];
  safetyBoundaries: string[];
  nextIntegrationSteps: string[];
}

const DEFAULT_PROMPT = 'JARVIS, bana paslanmaz çelik bir çatal tasarla.';

export const Studio3DView: React.FC = () => {
  const [projects, setProjects] = useState<Design3dProject[]>([]);
  const [engineReport, setEngineReport] = useState<Record<string, EngineReportItem>>({});
  const [architectureReport, setArchitectureReport] = useState<ArchitectureReport | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [selectedComponentId, setSelectedComponentId] = useState<string>('');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? projects[0],
    [projects, selectedId]
  );
  const selectedComponent = selectedProject?.components.find((component) => component.id === selectedComponentId) ??
    selectedProject?.components[0];

  const refresh = async () => {
    setError(null);
    try {
      const response = await fetch('/api/edith/design3d/projects');
      const data = await response.json();
      setProjects(data.projects ?? []);
      setEngineReport(data.engineReport ?? {});
      setArchitectureReport(data.architectureReport ?? null);
      if (!selectedId && data.projects?.[0]) setSelectedId(data.projects[0].id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '3D Studio verileri alınamadı.');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const createProject = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/edith/design3d/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error ?? '3D proje oluşturulamadı.');
      setProjects((prev) => [data.project, ...prev.filter((project) => project.id !== data.project.id)]);
      setEngineReport(data.engineReport ?? {});
      setArchitectureReport(data.architectureReport ?? null);
      setSelectedId(data.project.id);
      setSelectedComponentId(data.project.components[0]?.id ?? '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '3D proje oluşturulamadı.');
    } finally {
      setBusy(false);
    }
  };

  const snapshot = async () => {
    if (!selectedProject) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/edith/design3d/projects/${selectedProject.id}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Manual 3D Studio snapshot.' }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error ?? 'Snapshot alınamadı.');
      setProjects((prev) => prev.map((project) => project.id === data.project.id ? data.project : project));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Snapshot alınamadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 min-w-0 bg-slate-950 text-slate-100 overflow-hidden">
      <div className="h-full grid grid-cols-1 xl:grid-cols-[18rem_1fr_22rem]">
        <aside className="border-r border-slate-800 bg-slate-950/80 min-h-0 overflow-y-auto custom-scrollbar">
          <PanelHeader icon={<Layers3 className="w-4 h-4" />} title="3D Projects" />
          <div className="p-3 space-y-2">
            {projects.length === 0 && (
              <div className="border border-dashed border-slate-800 p-3 text-xs text-slate-500">
                Henüz 3D proje yok. Komut panelinden yeni tasarım başlatın.
              </div>
            )}
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  setSelectedId(project.id);
                  setSelectedComponentId(project.components[0]?.id ?? '');
                }}
                className={`w-full text-left border p-3 transition-colors ${
                  selectedProject?.id === project.id
                    ? 'border-[var(--edith-primary)] bg-[var(--edith-primary)]/10'
                    : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-100 truncate">{project.name}</span>
                  <span className="text-[10px] font-mono text-[var(--edith-accent)]">V{project.version}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">{project.prompt}</p>
              </button>
            ))}
          </div>

          <PanelHeader icon={<Boxes className="w-4 h-4" />} title="Component Tree" />
          <div className="p-3 space-y-1.5">
            {(selectedProject?.components ?? []).map((component) => (
              <button
                key={component.id}
                onClick={() => setSelectedComponentId(component.id)}
                className={`w-full flex items-center gap-2 border px-2.5 py-2 text-left text-xs ${
                  selectedComponent?.id === component.id
                    ? 'border-[var(--edith-primary)] bg-[var(--edith-primary)]/10 text-slate-100'
                    : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Box className="w-3.5 h-3.5 text-[var(--edith-primary)]" />
                <span className="truncate">{component.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-hidden flex flex-col">
          <div className="h-12 border-b border-slate-800 bg-slate-950/70 px-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4 text-[var(--edith-primary)]" />
              <span className="text-sm font-semibold">{selectedProject?.name ?? 'AI Controlled 3D Studio'}</span>
            </div>
            <div className="flex items-center gap-2">
              <ToolbarButton icon={<RotateCcw className="w-4 h-4" />} label="Undo foundation" />
              <ToolbarButton icon={<Camera className="w-4 h-4" />} label="Render preview" />
              <ToolbarButton icon={<Download className="w-4 h-4" />} label="Export" />
              <button
                onClick={snapshot}
                disabled={!selectedProject || busy}
                className="h-8 px-3 border border-slate-800 bg-slate-900 hover:border-[var(--edith-primary)] text-xs text-slate-200 disabled:opacity-40"
              >
                Snapshot
              </button>
            </div>
          </div>

          <section className="relative flex-1 min-h-[360px] overflow-hidden bg-[linear-gradient(180deg,#020617,#08111f_52%,#020617)]">
            <div className="absolute inset-0 opacity-60 bg-[linear-gradient(rgba(56,189,248,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.08)_1px,transparent_1px)] bg-[size:38px_38px]" />
            <div className="absolute inset-0 flex items-center justify-center perspective-[900px]">
              <div className="relative w-[min(72vw,680px)] aspect-[16/10] rotate-x-[58deg] rotate-z-[-32deg]">
                {(selectedProject?.components ?? []).map((component, index) => (
                  <div
                    key={component.id}
                    className={`absolute border shadow-2xl transition-all ${
                      selectedComponent?.id === component.id
                        ? 'border-[var(--edith-accent)] bg-[var(--edith-primary)]/28'
                        : 'border-[var(--edith-primary)]/35 bg-[var(--edith-primary)]/12'
                    }`}
                    style={{
                      left: `${12 + (index % 3) * 25}%`,
                      top: `${18 + Math.floor(index / 3) * 23}%`,
                      width: `${Math.max(11, Math.min(28, component.dimensionsMm.x / 28))}%`,
                      height: `${Math.max(8, Math.min(24, component.dimensionsMm.z / 24))}%`,
                      boxShadow: '0 0 30px color-mix(in srgb, var(--edith-primary) 18%, transparent)',
                    }}
                  >
                    <span className="absolute -top-5 left-0 text-[10px] font-mono text-slate-300 whitespace-nowrap">
                      {component.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute left-4 bottom-4 border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-400 font-mono">
              viewport: conceptual assembly preview · real CAD kernel unbound
            </div>
          </section>

          <section className="border-t border-slate-800 bg-slate-950/90 p-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-mono text-slate-500 mb-1">AI COMMAND PANEL</label>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={2}
                  className="w-full resize-none border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[var(--edith-primary)]"
                />
              </div>
              <button
                onClick={createProject}
                disabled={busy || !prompt.trim()}
                className="h-[3.75rem] px-4 bg-[var(--edith-primary)] text-slate-950 font-semibold text-xs disabled:opacity-40 flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Planla
              </button>
            </div>
            {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
          </section>
        </main>

        <aside className="border-l border-slate-800 bg-slate-950/80 min-h-0 overflow-y-auto custom-scrollbar">
          <PanelHeader icon={<Ruler className="w-4 h-4" />} title="Properties" />
          <div className="p-3 space-y-3">
            {selectedComponent ? (
              <>
                <InfoRow label="Name" value={selectedComponent.name} />
                <InfoRow label="Type" value={selectedComponent.type} />
                <InfoRow label="Material" value={selectedComponent.material ?? 'unset'} />
                <InfoRow label="Status" value={selectedComponent.status} />
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="X" value={`${selectedComponent.dimensionsMm.x} mm`} />
                  <Metric label="Y" value={`${selectedComponent.dimensionsMm.y} mm`} />
                  <Metric label="Z" value={`${selectedComponent.dimensionsMm.z} mm`} />
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">Component seçilmedi.</p>
            )}
          </div>

          <PanelHeader icon={<Braces className="w-4 h-4" />} title="Parameters" />
          <div className="p-3 space-y-2">
            {Object.entries(selectedProject?.parameters ?? {}).map(([parameterKey, value]) => (
              <InfoRow key={parameterKey} label={parameterKey} value={String(value)} />
            ))}
          </div>

          <PanelHeader icon={<Gauge className="w-4 h-4" />} title="Simulation & Engines" />
          <div className="p-3 space-y-2">
            {(Object.entries(engineReport) as Array<[string, EngineReportItem]>).map(([engine, report]) => (
              <div key={engine} className="border border-slate-800 bg-slate-900/50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">{engine}</span>
                  <StatusBadge status={report.status} />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{report.role}</p>
              </div>
            ))}
          </div>

          <PanelHeader icon={<Wrench className="w-4 h-4" />} title="Architecture" />
          <div className="p-3 space-y-2">
            {architectureReport && (
              <>
                <p className="text-[11px] text-slate-500">{architectureReport.principle}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {architectureReport.localProbes.slice(0, 6).map((probe) => (
                    <div key={probe.id} className="border border-slate-800 bg-slate-950/45 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-slate-300 truncate">{probe.label}</span>
                        <ProbeBadge status={probe.status} />
                      </div>
                    </div>
                  ))}
                </div>
                {architectureReport.selectedTechnologies.map((technology) => (
                  <div key={technology.id} className="border border-slate-800 bg-slate-900/45 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-200 truncate">{technology.name}</span>
                      <StatusBadge status={technology.bindingStatus} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{technology.role}</p>
                  </div>
                ))}
              </>
            )}
          </div>

          <PanelHeader icon={<Download className="w-4 h-4" />} title="Export" />
          <div className="p-3 flex flex-wrap gap-1.5">
            {(selectedProject?.exportFormats ?? ['STEP', 'STL', 'OBJ', 'GLB']).map((format) => (
              <button
                key={format}
                className="px-2 py-1 border border-slate-800 bg-slate-900 text-[10px] font-mono text-slate-300 hover:border-[var(--edith-primary)]"
                title="Runtime export adapter required"
              >
                {format}
              </button>
            ))}
          </div>

          <PanelHeader icon={<FileClock className="w-4 h-4" />} title="History" />
          <div className="p-3 space-y-2">
            {(selectedProject?.history ?? []).slice().reverse().map((item, index) => (
              <div key={`${item}-${index}`} className="flex gap-2 text-[11px] text-slate-500">
                <GitBranch className="w-3 h-3 text-[var(--edith-primary)] shrink-0 mt-0.5" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
};

function PanelHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="h-10 border-y border-slate-800 bg-slate-900/60 px-3 flex items-center gap-2 text-xs font-semibold text-slate-200">
      <span className="text-[var(--edith-primary)]">{icon}</span>
      {title}
    </div>
  );
}

function ToolbarButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      className="h-8 w-8 border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-100 hover:border-[var(--edith-primary)] flex items-center justify-center"
      title={label}
    >
      {icon}
    </button>
  );
}

function InfoRow({ label, value }: { key?: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-slate-800 bg-slate-900/45 px-2 py-1.5">
      <span className="text-[10px] font-mono text-slate-500">{label}</span>
      <span className="text-[11px] text-slate-200 truncate">{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-800 bg-slate-900/45 p-2">
      <div className="text-[10px] text-slate-500 font-mono">{label}</div>
      <div className="text-xs text-slate-100 mt-1">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: EngineStatus }) {
  if (status === 'AVAILABLE') {
    return <span className="px-1.5 py-0.5 border border-emerald-500/30 bg-emerald-950/30 text-[9px] text-emerald-300 font-mono flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />OK</span>;
  }
  if (status === 'UNAVAILABLE') {
    return <span className="px-1.5 py-0.5 border border-red-500/30 bg-red-950/30 text-[9px] text-red-300 font-mono flex items-center gap-1"><TriangleAlert className="w-3 h-3" />OFF</span>;
  }
  return <span className="px-1.5 py-0.5 border border-amber-500/30 bg-amber-950/30 text-[9px] text-amber-300 font-mono flex items-center gap-1"><Wrench className="w-3 h-3" />SETUP</span>;
}

function ProbeBadge({ status }: { status: LocalToolProbe['status'] }) {
  const label = status === 'detected' ? 'FOUND' : status === 'missing' ? 'MISS' : 'SETUP';
  const cls = status === 'detected'
    ? 'border-emerald-500/30 bg-emerald-950/25 text-emerald-300'
    : status === 'missing'
    ? 'border-red-500/30 bg-red-950/25 text-red-300'
    : 'border-amber-500/30 bg-amber-950/25 text-amber-300';
  return <span className={`px-1.5 py-0.5 border text-[9px] font-mono ${cls}`}>{label}</span>;
}
