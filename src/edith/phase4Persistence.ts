import fs from 'node:fs';
import path from 'node:path';
import type { PlaybookDefinitionV2, PlaybookRunV2, ResearchRunV2 } from './contracts';
import { parsePlaybookDefinitionV2, parsePlaybookRunV2, parseResearchRunV2 } from './contracts';

export const PHASE4_STORE_VERSION = '2.1' as const;

interface Phase4StoreDocument {
  schemaVersion: typeof PHASE4_STORE_VERSION;
  researchRuns: ResearchRunV2[];
  playbookDefinitions: PlaybookDefinitionV2[];
  playbookRuns: PlaybookRunV2[];
  migratedAt?: string;
}

export interface Phase4Persistence {
  listResearchRuns(): ResearchRunV2[];
  getResearchRun(runId: string): ResearchRunV2 | undefined;
  saveResearchRun(run: ResearchRunV2): void;
  listPlaybookDefinitions(): PlaybookDefinitionV2[];
  getPlaybookDefinition(playbookId: string, version?: string): PlaybookDefinitionV2 | undefined;
  savePlaybookDefinition(definition: PlaybookDefinitionV2): void;
  listPlaybookRuns(): PlaybookRunV2[];
  getPlaybookRun(runId: string): PlaybookRunV2 | undefined;
  savePlaybookRun(run: PlaybookRunV2): void;
}

function emptyDocument(): Phase4StoreDocument {
  return { schemaVersion: PHASE4_STORE_VERSION, researchRuns: [], playbookDefinitions: [], playbookRuns: [] };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeDocument(value: unknown): Phase4StoreDocument {
  const raw = Array.isArray(value)
    ? { researchRuns: value }
    : value && typeof value === 'object'
      ? value as Record<string, unknown>
      : {};
  const researchRuns = (Array.isArray(raw.researchRuns) ? raw.researchRuns : [])
    .flatMap((run) => {
      const parsed = parseResearchRunV2(run);
      return parsed.success ? [parsed.value] : [];
    });
  const playbookDefinitions = (Array.isArray(raw.playbookDefinitions) ? raw.playbookDefinitions : [])
    .flatMap((definition) => {
      const parsed = parsePlaybookDefinitionV2(definition);
      return parsed.success ? [parsed.value] : [];
    });
  const byPlaybook = new Map(playbookDefinitions.map((definition) => [`${definition.playbookId}@${definition.version}`, definition]));
  const playbookRuns = (Array.isArray(raw.playbookRuns) ? raw.playbookRuns : [])
    .flatMap((run) => {
      const candidate = run as PlaybookRunV2;
      const definition = candidate?.playbook
        ? byPlaybook.get(`${candidate.playbook.playbookId}@${candidate.playbook.version}`)
        : undefined;
      const parsed = parsePlaybookRunV2(run, definition);
      return parsed.success ? [parsed.value] : [];
    });
  return {
    schemaVersion: PHASE4_STORE_VERSION,
    researchRuns,
    playbookDefinitions,
    playbookRuns,
    migratedAt: raw.schemaVersion === PHASE4_STORE_VERSION ? undefined : new Date().toISOString(),
  };
}

abstract class BasePhase4Persistence implements Phase4Persistence {
  protected abstract read(): Phase4StoreDocument;
  protected abstract write(document: Phase4StoreDocument): void;

  listResearchRuns(): ResearchRunV2[] { return clone(this.read().researchRuns); }
  getResearchRun(runId: string): ResearchRunV2 | undefined { return this.listResearchRuns().find((run) => run.runId === runId); }
  saveResearchRun(run: ResearchRunV2): void {
    const parsed = parseResearchRunV2(run);
    if (parsed.success === false) throw new Error(`${parsed.errorCode}: ${parsed.message}`);
    const document = this.read();
    document.researchRuns = [parsed.value, ...document.researchRuns.filter((item) => item.runId !== run.runId)];
    this.write(document);
  }

  listPlaybookDefinitions(): PlaybookDefinitionV2[] { return clone(this.read().playbookDefinitions); }
  getPlaybookDefinition(playbookId: string, version?: string): PlaybookDefinitionV2 | undefined {
    return this.listPlaybookDefinitions().find((definition) => definition.playbookId === playbookId && (!version || definition.version === version));
  }
  savePlaybookDefinition(definition: PlaybookDefinitionV2): void {
    const parsed = parsePlaybookDefinitionV2(definition);
    if (parsed.success === false) throw new Error(`${parsed.errorCode}: ${parsed.message}`);
    const document = this.read();
    document.playbookDefinitions = [
      parsed.value,
      ...document.playbookDefinitions.filter((item) => item.playbookId !== definition.playbookId || item.version !== definition.version),
    ];
    this.write(document);
  }

  listPlaybookRuns(): PlaybookRunV2[] { return clone(this.read().playbookRuns); }
  getPlaybookRun(runId: string): PlaybookRunV2 | undefined { return this.listPlaybookRuns().find((run) => run.runId === runId); }
  savePlaybookRun(run: PlaybookRunV2): void {
    const definition = this.getPlaybookDefinition(run.playbook.playbookId, run.playbook.version);
    const parsed = parsePlaybookRunV2(run, definition);
    if (parsed.success === false) throw new Error(`${parsed.errorCode}: ${parsed.message}`);
    const document = this.read();
    document.playbookRuns = [parsed.value, ...document.playbookRuns.filter((item) => item.runId !== run.runId)];
    this.write(document);
  }
}

export class MemoryPhase4Persistence extends BasePhase4Persistence {
  private document = emptyDocument();
  protected read(): Phase4StoreDocument { return clone(this.document); }
  protected write(document: Phase4StoreDocument): void { this.document = clone(document); }
}

export class JsonPhase4Persistence extends BasePhase4Persistence {
  readonly filePath: string;

  constructor(dataDir: string, fileName = 'phase4-research-playbooks.json') {
    super();
    this.filePath = path.resolve(dataDir, fileName);
  }

  initialize(): { migrated: boolean } {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.write(emptyDocument());
      return { migrated: false };
    }
    const before = this.readRaw();
    const migrated = !before || Array.isArray(before) || (before as Record<string, unknown>).schemaVersion !== PHASE4_STORE_VERSION;
    this.write(normalizeDocument(before));
    return { migrated };
  }

  protected read(): Phase4StoreDocument {
    if (!fs.existsSync(this.filePath)) this.initialize();
    return normalizeDocument(this.readRaw());
  }

  protected write(document: Phase4StoreDocument): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }

  private readRaw(): unknown {
    try { return JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } catch { return undefined; }
  }
}
