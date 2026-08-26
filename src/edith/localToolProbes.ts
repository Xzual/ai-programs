import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type LocalToolProbeStatus = 'detected' | 'missing' | 'configuration_required';

export interface LocalToolProbe {
  id: 'blender' | 'freecad' | 'cadquery' | 'tesseract' | 'openfoam' | 'playwright' | 'ollama';
  label: string;
  status: LocalToolProbeStatus;
  detectionMethod: 'path_lookup' | 'node_dependency' | 'env_hint' | 'service_url_only';
  executablePath?: string;
  packageName?: string;
  requiredFor: string[];
  safeToProbe: boolean;
  startsProcess: false;
  notes: string;
}

const WINDOWS_KNOWN_PATHS: Record<string, string[]> = {
  blender: [
    'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe',
  ],
  freecad: [
    'C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCAD.exe',
    'C:\\Program Files\\FreeCAD 0.21\\bin\\FreeCAD.exe',
  ],
  tesseract: [
    'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
  ],
  ollama: [
    'C:\\Users\\arday\\AppData\\Local\\Programs\\Ollama\\ollama.exe',
    'C:\\Program Files\\Ollama\\ollama.exe',
  ],
};

function pathCandidates(command: string): string[] {
  const pathExt = os.platform() === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return pathDirs.flatMap((dir) => pathExt.map((ext) => path.join(dir, os.platform() === 'win32' ? `${command}${ext}` : command)));
}

function findExecutable(command: string, knownPaths: string[] = []): string | undefined {
  return [...knownPaths, ...pathCandidates(command)].find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function nodeDependencyDetected(packageName: string): boolean {
  try {
    require.resolve(packageName, { paths: [process.cwd()] });
    return true;
  } catch {
    return false;
  }
}

export class LocalToolProbeService {
  list(): LocalToolProbe[] {
    const blenderPath = findExecutable('blender', WINDOWS_KNOWN_PATHS.blender);
    const freecadPath = findExecutable('FreeCAD', WINDOWS_KNOWN_PATHS.freecad) ?? findExecutable('freecad');
    const tesseractPath = findExecutable('tesseract', WINDOWS_KNOWN_PATHS.tesseract);
    const ollamaPath = findExecutable('ollama', WINDOWS_KNOWN_PATHS.ollama);
    const openfoamPath = findExecutable('foamVersion') ?? findExecutable('openfoam');
    const cadqueryEnv = process.env.CADQUERY_PYTHON || process.env.EDITH_CADQUERY_PYTHON;
    const playwrightDetected = nodeDependencyDetected('playwright');

    return [
      {
        id: 'blender',
        label: 'Blender',
        status: blenderPath ? 'detected' : 'configuration_required',
        detectionMethod: 'path_lookup',
        executablePath: blenderPath,
        requiredFor: ['rendering', 'animation', 'mesh preview'],
        safeToProbe: true,
        startsProcess: false,
        notes: blenderPath ? 'Executable found. Adapter still needs explicit EDITH binding before use.' : 'Executable was not found in PATH or common install paths.',
      },
      {
        id: 'freecad',
        label: 'FreeCAD',
        status: freecadPath ? 'detected' : 'configuration_required',
        detectionMethod: 'path_lookup',
        executablePath: freecadPath,
        requiredFor: ['parametric CAD', 'technical drawings', 'STEP export'],
        safeToProbe: true,
        startsProcess: false,
        notes: freecadPath ? 'Executable found. Python scripting adapter still needs explicit binding.' : 'FreeCAD executable was not found.',
      },
      {
        id: 'cadquery',
        label: 'CadQuery',
        status: cadqueryEnv ? 'detected' : 'configuration_required',
        detectionMethod: 'env_hint',
        executablePath: cadqueryEnv,
        packageName: 'cadquery',
        requiredFor: ['code-driven parametric CAD', 'OpenCascade geometry'],
        safeToProbe: true,
        startsProcess: false,
        notes: cadqueryEnv ? 'CadQuery environment hint is configured.' : 'Set CADQUERY_PYTHON or EDITH_CADQUERY_PYTHON after installing CadQuery.',
      },
      {
        id: 'tesseract',
        label: 'Tesseract OCR',
        status: tesseractPath ? 'detected' : 'configuration_required',
        detectionMethod: 'path_lookup',
        executablePath: tesseractPath,
        requiredFor: ['OCR', 'screen text extraction', 'PDF image text extraction'],
        safeToProbe: true,
        startsProcess: false,
        notes: tesseractPath ? 'Executable found. OCR adapter still needs binding and privacy review.' : 'Tesseract executable was not found.',
      },
      {
        id: 'openfoam',
        label: 'OpenFOAM',
        status: openfoamPath ? 'detected' : 'configuration_required',
        detectionMethod: 'path_lookup',
        executablePath: openfoamPath,
        requiredFor: ['CFD simulation'],
        safeToProbe: true,
        startsProcess: false,
        notes: openfoamPath ? 'Executable hint found. Solver execution remains disabled until configured.' : 'No OpenFOAM executable hint was found.',
      },
      {
        id: 'playwright',
        label: 'Playwright',
        status: playwrightDetected ? 'detected' : 'configuration_required',
        detectionMethod: 'node_dependency',
        packageName: 'playwright',
        requiredFor: ['browser workflow automation', 'PDF/download workflows'],
        safeToProbe: true,
        startsProcess: false,
        notes: playwrightDetected ? 'Node dependency is installed. Live browser actions still require permission.' : 'Playwright dependency is not resolvable from the workspace.',
      },
      {
        id: 'ollama',
        label: 'Ollama',
        status: ollamaPath ? 'detected' : 'missing',
        detectionMethod: 'service_url_only',
        executablePath: ollamaPath,
        requiredFor: ['local model runtime'],
        safeToProbe: true,
        startsProcess: false,
        notes: 'This probe only checks executable hints. EDITH must not start the Ollama server.',
      },
    ];
  }

  get(id: LocalToolProbe['id']): LocalToolProbe | undefined {
    return this.list().find((probe) => probe.id === id);
  }
}

export const localToolProbeService = new LocalToolProbeService();
