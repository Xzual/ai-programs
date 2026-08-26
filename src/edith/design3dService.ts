import fs from 'node:fs';
import path from 'node:path';
import { appendAuditEvent, createAuditEvent } from './audit';
import { localToolProbeService, type LocalToolProbe } from './localToolProbes';
import { getEdithPersistenceStore } from './persistence';

export type Design3dEngineStatus = 'CONFIGURATION_REQUIRED' | 'AVAILABLE' | 'UNAVAILABLE';

export interface Design3dComponent {
  id: string;
  name: string;
  type: 'part' | 'assembly' | 'constraint' | 'material' | 'simulation' | 'export';
  parentId?: string;
  material?: string;
  dimensionsMm: {
    x: number;
    y: number;
    z: number;
  };
  transform: {
    x: number;
    y: number;
    z: number;
    rx: number;
    ry: number;
    rz: number;
  };
  status: 'planned' | 'generated' | 'validated' | 'blocked';
}

export interface Design3dProject {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  activeEngine: 'cadquery' | 'freecad' | 'blender' | 'simulation' | 'unbound';
  components: Design3dComponent[];
  parameters: Record<string, number | string | boolean>;
  history: string[];
  exportFormats: string[];
  engineStatus: Record<string, Design3dEngineStatus>;
}

export interface CreateDesign3dProjectInput {
  name?: string;
  prompt: string;
}

export interface Design3dArchitectureReport {
  generatedAt: string;
  principle: string;
  localProbes: LocalToolProbe[];
  selectedTechnologies: Array<{
    id: 'blender' | 'freecad' | 'cadquery' | 'playwright' | 'simulation';
    name: string;
    role: string;
    bindingStatus: Design3dEngineStatus;
    activationRequirement: string;
    reference: string;
  }>;
  safetyBoundaries: string[];
  nextIntegrationSteps: string[];
}

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeName(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 80) || 'EDITH 3D Project';
}

function inferComponents(prompt: string): Design3dComponent[] {
  const lower = prompt.toLocaleLowerCase('tr-TR');
  if (lower.includes('araba') || lower.includes('araç') || /\b(vehicle|car)\b/i.test(lower)) {
    return [
      component('chassis', 'Chassis', 'assembly', [2200, 950, 220], 'aluminum'),
      component('body', 'Body Shell', 'part', [2300, 1050, 680], 'carbon fiber'),
      component('wheel-fl', 'Front Left Wheel', 'part', [420, 120, 420], 'rubber'),
      component('wheel-fr', 'Front Right Wheel', 'part', [420, 120, 420], 'rubber'),
      component('battery', 'Battery Pack', 'part', [760, 420, 120], 'lithium pack'),
      component('suspension', 'Suspension Assembly', 'assembly', [900, 420, 280], 'steel'),
    ];
  }
  if (lower.includes('çatal') || /\bfork\b/i.test(lower)) {
    return [
      component('handle', 'Handle', 'part', [140, 18, 8], 'stainless steel'),
      component('neck', 'Neck', 'part', [32, 14, 6], 'stainless steel'),
      component('tines', 'Tines', 'assembly', [58, 28, 4], 'stainless steel'),
    ];
  }
  if (lower.includes('robot') || lower.includes('kol') || /\barm\b/i.test(lower)) {
    return [
      component('base', 'Base Joint', 'assembly', [180, 180, 90], 'aluminum'),
      component('upper-arm', 'Upper Arm', 'part', [420, 80, 80], 'aluminum'),
      component('forearm', 'Forearm', 'part', [360, 70, 70], 'aluminum'),
      component('gripper', 'Gripper', 'assembly', [140, 120, 90], 'steel'),
    ];
  }
  return [
    component('concept-body', 'Concept Body', 'part', [120, 80, 60], 'PLA'),
    component('reference-frame', 'Reference Frame', 'assembly', [140, 100, 80], 'virtual'),
  ];
}

function component(
  idSuffix: string,
  name: string,
  type: Design3dComponent['type'],
  dimensions: [number, number, number],
  material: string
): Design3dComponent {
  return {
    id: `component-${idSuffix}`,
    name,
    type,
    material,
    dimensionsMm: { x: dimensions[0], y: dimensions[1], z: dimensions[2] },
    transform: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
    status: 'planned',
  };
}

export class Design3dService {
  listProjects(): Design3dProject[] {
    return this.readProjects().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  getProject(projectId: string): Design3dProject | undefined {
    return this.listProjects().find((project) => project.id === projectId);
  }

  createProject(input: CreateDesign3dProjectInput): Design3dProject {
    const now = new Date().toISOString();
    const project: Design3dProject = {
      id: id('design3d'),
      name: safeName(input.name || input.prompt.split(/\s+/).slice(0, 6).join(' ')),
      prompt: input.prompt.trim(),
      createdAt: now,
      updatedAt: now,
      version: 1,
      activeEngine: 'unbound',
      components: inferComponents(input.prompt),
      parameters: {
        unit: 'mm',
        parametric: true,
        manufacturingIntent: 'prototype',
      },
      history: [
        `Project created from prompt at ${now}.`,
        'Engine adapters are registered as foundation only; no CAD geometry was generated.',
      ],
      exportFormats: ['STEP', 'STL', 'OBJ', 'GLB', '3MF', 'DXF'],
      engineStatus: {
        blender: 'CONFIGURATION_REQUIRED',
        freecad: 'CONFIGURATION_REQUIRED',
        cadquery: 'CONFIGURATION_REQUIRED',
        fea: 'CONFIGURATION_REQUIRED',
        cfd: 'CONFIGURATION_REQUIRED',
      },
    };
    this.writeProjects([project, ...this.listProjects()]);
    this.audit('design3d.project_create', project.id, `3D project created: ${project.name}`);
    return project;
  }

  snapshot(projectId: string, reason: string): Design3dProject | undefined {
    const project = this.getProject(projectId);
    if (!project) return undefined;
    const updated: Design3dProject = {
      ...project,
      version: project.version + 1,
      updatedAt: new Date().toISOString(),
      history: [...project.history, `Snapshot V${project.version + 1}: ${reason}`],
    };
    this.writeProjects(this.listProjects().map((candidate) => candidate.id === projectId ? updated : candidate));
    this.audit('design3d.snapshot', projectId, reason);
    return updated;
  }

  engineReport(): Record<string, { status: Design3dEngineStatus; role: string; notes: string }> {
    const probes = new Map(localToolProbeService.list().map((probe) => [probe.id, probe]));
    return {
      blender: {
        status: 'CONFIGURATION_REQUIRED',
        role: 'Rendering, animation, organic modeling, visualization',
        notes: probes.get('blender')?.status === 'detected'
          ? 'Blender executable was detected, but EDITH adapter binding is still required.'
          : 'Use Blender Python/background mode after local executable binding.',
      },
      freecad: {
        status: 'CONFIGURATION_REQUIRED',
        role: 'Precise parametric CAD and technical drawings',
        notes: probes.get('freecad')?.status === 'detected'
          ? 'FreeCAD executable was detected, but EDITH scripting adapter binding is still required.'
          : 'Use FreeCAD Python scripting after local installation detection.',
      },
      cadquery: {
        status: 'CONFIGURATION_REQUIRED',
        role: 'Code-driven parametric CAD on OpenCascade/OCP',
        notes: probes.get('cadquery')?.status === 'detected'
          ? 'CadQuery environment hint was detected, but geometry generation remains disabled until adapter verification.'
          : 'Use CadQuery after Python package/environment binding.',
      },
      simulation: {
        status: 'CONFIGURATION_REQUIRED',
        role: 'Physics, FEA/FEM, CFD, robotics, manufacturing validation',
        notes: 'No simulation result should be treated as real-world proof.',
      },
    };
  }

  architectureReport(): Design3dArchitectureReport {
    const localProbes = localToolProbeService.list();
    return {
      generatedAt: new Date().toISOString(),
      principle: 'EDITH 3D Studio is a safe orchestration and planning layer until local CAD, render, and simulation engines are explicitly installed and bound.',
      localProbes,
      selectedTechnologies: [
        {
          id: 'blender',
          name: 'Blender Python / background mode',
          role: 'Rendering, animation, scene assembly, visual preview, mesh-oriented modeling',
          bindingStatus: 'CONFIGURATION_REQUIRED',
          activationRequirement: 'Detect a local Blender executable, configure a sandboxed Python script runner, then verify artifact output paths.',
          reference: 'https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html',
        },
        {
          id: 'freecad',
          name: 'FreeCAD Python scripting',
          role: 'Parametric mechanical CAD, constraints, drawings, STEP/STL export pipeline',
          bindingStatus: 'CONFIGURATION_REQUIRED',
          activationRequirement: 'Detect FreeCAD Python runtime and run read-only version probes before enabling model generation.',
          reference: 'https://wiki.freecad.org/FreeCAD_Scripting_Basics',
        },
        {
          id: 'cadquery',
          name: 'CadQuery / OpenCascade',
          role: 'Code-driven parametric CAD for reproducible parts and assemblies',
          bindingStatus: 'CONFIGURATION_REQUIRED',
          activationRequirement: 'Bind a Python environment with CadQuery/OCP and add deterministic geometry export verification.',
          reference: 'https://cadquery.readthedocs.io/en/latest/intro.html',
        },
        {
          id: 'playwright',
          name: 'Playwright',
          role: 'Browser automation for docs, vendor portals, downloadable references, and web-hosted viewers',
          bindingStatus: 'CONFIGURATION_REQUIRED',
          activationRequirement: 'Keep browser workflows permission-gated; validate dry-run schemas before live navigation.',
          reference: 'https://playwright.dev/',
        },
        {
          id: 'simulation',
          name: 'External FEA/CFD/robotics solvers',
          role: 'Simulation orchestration only; no solver result is claimed until a real engine is configured and verified',
          bindingStatus: 'CONFIGURATION_REQUIRED',
          activationRequirement: 'Register each solver separately with executable detection, input validation, runtime limits, and result provenance.',
          reference: 'local configuration required',
        },
      ],
      safetyBoundaries: [
        'No CAD geometry, render, FEA, CFD, robotics, manufacturing, or purchasing action is reported as successful unless an actual adapter returns verified artifacts.',
        'Export buttons and tool registry entries are planning surfaces while engine status is CONFIGURATION_REQUIRED.',
        'Browser, file, desktop, and system actions remain behind EDITH permission service, audit log, verifier, and kill switch.',
      ],
      nextIntegrationSteps: [
        'Add read-only executable probes for Blender, FreeCAD, and Python CAD environments.',
        'Create per-engine adapters that produce signed artifact metadata before UI marks components generated.',
        'Add domain verifiers for STEP/STL/GLB/PDF outputs and simulation result provenance.',
      ],
    };
  }

  private file(): string {
    return path.join(getEdithPersistenceStore().getPaths().dataDir, 'design3d-projects.json');
  }

  private readProjects(): Design3dProject[] {
    const file = this.file();
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeProjects(projects: Design3dProject[]): void {
    const file = this.file();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(projects, null, 2), 'utf8');
  }

  private audit(action: string, target: string, message: string): void {
    appendAuditEvent(createAuditEvent({
      actor: 'edith-design3d-service',
      action,
      toolId: 'design3d_service',
      target,
      authorization: 'allowed',
      riskLevel: 1,
      result: 'success',
      message,
    }));
  }
}

export const design3dService = new Design3dService();
