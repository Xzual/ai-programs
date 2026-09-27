import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

export const WORKSPACE_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_LAYOUT_VERSION = 1 as const;

export type WorkspaceState = 'ready' | 'degraded' | 'configuration_required' | 'invalid';
export type WorkspaceManagedPathKey = 'chatHistoryPath' | 'logsPath' | 'dataPath' | 'backupPath' | 'exportsPath';
export type WorkspacePathKey = 'workspaceRoot' | 'obsidianVaultPath' | WorkspaceManagedPathKey;

export interface WorkspaceMigrationInfo {
  source: 'legacy_edith_data' | 'legacy_obsidian_settings' | 'environment';
  importedAt: string;
  movedFiles: false;
}

export interface WorkspaceConfig {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  workspaceId: string;
  userId?: string;
  deviceId: string;
  workspaceRoot: string;
  obsidianVaultPath: string;
  chatHistoryPath: string;
  logsPath: string;
  dataPath: string;
  backupPath: string;
  exportsPath: string;
  portableMode: boolean;
  createdAt: string;
  updatedAt: string;
  migration?: WorkspaceMigrationInfo;
}

export interface WorkspaceConfigInput {
  workspaceRoot: string;
  obsidianVaultPath?: string;
  chatHistoryPath?: string;
  logsPath?: string;
  dataPath?: string;
  backupPath?: string;
  exportsPath?: string;
  portableMode?: boolean;
  userId?: string;
  deviceId?: string;
}

export interface ResolvedWorkspacePaths {
  workspaceRoot: string;
  obsidianVaultPath: string;
  chatHistoryPath: string;
  logsPath: string;
  dataPath: string;
  backupPath: string;
  exportsPath: string;
}

export interface WorkspacePathStatus {
  configured: boolean;
  exists: boolean;
  directory: boolean;
  readable: boolean;
  writable: boolean;
  path: string;
}

export interface WorkspaceStatus {
  configured: boolean;
  state: WorkspaceState;
  safeMessage: string;
  workspaceRoot?: string;
  obsidianVaultPath?: string;
  readable: boolean;
  writable: boolean;
  lastValidated: string;
  configFile: string;
  config?: WorkspaceConfig;
  resolvedPaths?: ResolvedWorkspacePaths;
  paths: Partial<Record<WorkspacePathKey, WorkspacePathStatus>>;
  portableMode: boolean;
  persistenceRestartRequired: boolean;
  limitations: string[];
  lastError?: string;
}

export interface WorkspaceCloudMetadata {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  layoutVersion: typeof WORKSPACE_LAYOUT_VERSION;
  workspaceId: string;
  workspaceLabel: string;
  userId?: string;
  deviceId: string;
  portableMode: boolean;
  hasObsidianVault: boolean;
  localPath: string;
  vaultPath: string;
  syncMode: 'metadata_only';
  updatedAt: string;
}

export interface WorkspaceMetadataAdapter {
  readonly id: string;
  readonly mode: 'metadata_only';
  sync(metadata: WorkspaceCloudMetadata): Promise<{ ok: boolean; syncedAt?: string; error?: string }>;
}

export class ConfigurationRequiredWorkspaceMetadataAdapter implements WorkspaceMetadataAdapter {
  readonly id = 'supabase_workspace_metadata';
  readonly mode = 'metadata_only' as const;

  async sync(_metadata: WorkspaceCloudMetadata): Promise<{ ok: boolean; error: string }> {
    return { ok: false, error: 'Supabase workspace metadata adapter is configuration_required.' };
  }
}

export class LocalWorkspaceMetadataAdapter implements WorkspaceMetadataAdapter {
  readonly id = 'local_workspace_metadata';
  readonly mode = 'metadata_only' as const;

  constructor(private readonly metadataFile: string) {}

  async sync(metadata: WorkspaceCloudMetadata): Promise<{ ok: boolean; syncedAt?: string; error?: string }> {
    try {
      fs.mkdirSync(path.dirname(this.metadataFile), { recursive: true });
      const tempFile = `${this.metadataFile}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tempFile, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempFile, this.metadataFile);
      return { ok: true, syncedAt: now() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Local workspace metadata sync failed.' };
    }
  }
}

interface WorkspaceManagerOptions {
  appRoot?: string;
  configFile?: string;
  env?: NodeJS.ProcessEnv;
  autoMigrate?: boolean;
}

const MANAGED_DEFAULTS: Record<WorkspaceManagedPathKey, string> = {
  chatHistoryPath: 'Conversations',
  logsPath: 'Logs',
  dataPath: 'Data',
  backupPath: 'Backups',
  exportsPath: 'Exports',
};

const WORKSPACE_DIRECTORIES = ['Memory', 'Projects', 'Research', 'Tasks', 'Trading', 'Config'] as const;

function now(): string {
  return new Date().toISOString();
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function canAccess(target: string, mode: number): boolean {
  try {
    fs.accessSync(target, mode);
    return true;
  } catch {
    return false;
  }
}

function pathStatus(target: string): WorkspacePathStatus {
  const configured = Boolean(target);
  const exists = configured && fs.existsSync(target);
  let directory = false;
  if (exists) {
    try {
      directory = fs.statSync(target).isDirectory();
    } catch {
      directory = false;
    }
  }
  return {
    configured,
    exists,
    directory,
    readable: directory && canAccess(target, fs.constants.R_OK),
    writable: directory && canAccess(target, fs.constants.W_OK),
    path: target,
  };
}

export class WorkspaceManager {
  readonly appRoot: string;
  readonly configFile: string;

  private readonly env: NodeJS.ProcessEnv;
  private config?: WorkspaceConfig;
  private loadError?: string;
  private startupDataPath: string;
  private lastValidatedAt = now();

  constructor(options: WorkspaceManagerOptions = {}) {
    this.env = options.env ?? process.env;
    this.appRoot = path.resolve(options.appRoot ?? process.cwd());
    const configuredFile = options.configFile ?? this.env.EDITH_WORKSPACE_CONFIG_PATH;
    this.configFile = configuredFile
      ? path.resolve(this.appRoot, configuredFile)
      : path.join(this.appRoot, '.edith', 'workspace.json');
    this.load();
    if (!this.config && options.autoMigrate !== false) this.migrateLegacyConfiguration();
    this.startupDataPath = this.getResolvedPaths()?.dataPath ?? path.join(this.appRoot, '.edith');
  }

  getConfig(): WorkspaceConfig | undefined {
    return this.config ? { ...this.config, migration: this.config.migration ? { ...this.config.migration } : undefined } : undefined;
  }

  getResolvedPaths(config = this.config): ResolvedWorkspacePaths | undefined {
    if (!config) return undefined;
    const workspaceRoot = path.isAbsolute(config.workspaceRoot)
      ? path.normalize(config.workspaceRoot)
      : path.resolve(this.appRoot, config.workspaceRoot);
    const resolveChild = (value: string): string => {
      if (!value) return '';
      return path.isAbsolute(value) ? path.normalize(value) : path.resolve(workspaceRoot, value);
    };
    return {
      workspaceRoot,
      obsidianVaultPath: resolveChild(config.obsidianVaultPath),
      chatHistoryPath: resolveChild(config.chatHistoryPath),
      logsPath: resolveChild(config.logsPath),
      dataPath: resolveChild(config.dataPath),
      backupPath: resolveChild(config.backupPath),
      exportsPath: resolveChild(config.exportsPath),
    };
  }

  getPersistenceDataDir(): string {
    return this.getResolvedPaths()?.dataPath ?? path.join(this.appRoot, '.edith');
  }

  getCloudMetadata(): WorkspaceCloudMetadata | undefined {
    if (!this.config) return undefined;
    const resolved = this.getResolvedPaths(this.config)!;
    return {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      layoutVersion: WORKSPACE_LAYOUT_VERSION,
      workspaceId: this.config.workspaceId,
      workspaceLabel: path.basename(resolved.workspaceRoot) || 'E.D.I.T.H. Workspace',
      userId: this.config.userId,
      deviceId: this.config.deviceId,
      portableMode: this.config.portableMode,
      hasObsidianVault: Boolean(this.config.obsidianVaultPath),
      localPath: resolved.workspaceRoot,
      vaultPath: resolved.obsidianVaultPath,
      syncMode: 'metadata_only',
      updatedAt: this.config.updatedAt,
    };
  }

  async syncLocalMetadata(): Promise<{ ok: boolean; syncedAt?: string; error?: string }> {
    const metadata = this.getCloudMetadata();
    const resolved = this.getResolvedPaths();
    if (!metadata || !resolved) return { ok: false, error: 'Workspace configuration is required.' };
    const adapter = new LocalWorkspaceMetadataAdapter(path.join(resolved.workspaceRoot, 'Config', 'workspace-metadata.json'));
    return adapter.sync(metadata);
  }

  status(): WorkspaceStatus {
    this.lastValidatedAt = now();
    if (!this.config) {
      return {
        configured: false,
        state: this.loadError ? 'invalid' : 'configuration_required',
        safeMessage: this.loadError ?? 'Workspace configuration is required.',
        readable: false,
        writable: false,
        lastValidated: this.lastValidatedAt,
        configFile: this.configFile,
        paths: {},
        portableMode: false,
        persistenceRestartRequired: false,
        limitations: ['No workspace root is configured.'],
        lastError: this.loadError,
      };
    }

    const resolvedPaths = this.getResolvedPaths(this.config)!;
    const paths: Record<WorkspacePathKey, WorkspacePathStatus> = {
      workspaceRoot: pathStatus(resolvedPaths.workspaceRoot),
      obsidianVaultPath: pathStatus(resolvedPaths.obsidianVaultPath),
      chatHistoryPath: pathStatus(resolvedPaths.chatHistoryPath),
      logsPath: pathStatus(resolvedPaths.logsPath),
      dataPath: pathStatus(resolvedPaths.dataPath),
      backupPath: pathStatus(resolvedPaths.backupPath),
      exportsPath: pathStatus(resolvedPaths.exportsPath),
    };
    const managed = (Object.keys(MANAGED_DEFAULTS) as WorkspaceManagedPathKey[]).map((key) => paths[key]);
    const rootReady = paths.workspaceRoot.exists && paths.workspaceRoot.directory && paths.workspaceRoot.readable && paths.workspaceRoot.writable;
    const managedReady = managed.every((entry) => entry.exists && entry.directory && entry.readable && entry.writable);
    const vaultConfigured = Boolean(this.config.obsidianVaultPath);
    const vaultReady = vaultConfigured
      && paths.obsidianVaultPath.exists
      && paths.obsidianVaultPath.directory
      && paths.obsidianVaultPath.readable;
    const limitations: string[] = [];
    if (!rootReady) limitations.push('Workspace root is missing or inaccessible.');
    if (!managedReady) limitations.push('One or more managed workspace directories are missing or inaccessible.');
    if (!vaultConfigured) limitations.push('Obsidian vault is not configured.');
    else if (!vaultReady) limitations.push('Configured Obsidian vault is missing or unreadable.');
    const persistenceRestartRequired = path.resolve(this.startupDataPath) !== path.resolve(resolvedPaths.dataPath);
    if (persistenceRestartRequired) limitations.push('Persistence path changed; restart is required before the new data path becomes active.');
    const ready = rootReady && managedReady && vaultReady;
    const configurationRequired = !rootReady || !vaultReady;
    return {
      configured: true,
      state: ready ? 'ready' : configurationRequired ? 'configuration_required' : 'degraded',
      safeMessage: ready ? 'Workspace is ready.' : limitations[0],
      workspaceRoot: resolvedPaths.workspaceRoot,
      obsidianVaultPath: resolvedPaths.obsidianVaultPath,
      readable: rootReady && managed.every((entry) => entry.readable),
      writable: rootReady && managed.every((entry) => entry.writable),
      lastValidated: this.lastValidatedAt,
      configFile: this.configFile,
      config: this.getConfig(),
      resolvedPaths,
      paths,
      portableMode: this.config.portableMode,
      persistenceRestartRequired,
      limitations,
      lastError: this.loadError,
    };
  }

  validate(input: WorkspaceConfigInput, options: { allowMissingRoot?: boolean } = {}): WorkspaceStatus {
    const candidate = this.buildConfig(input, this.config);
    this.assertPathPolicy(candidate);
    const resolved = this.getResolvedPaths(candidate)!;
    if (!options.allowMissingRoot) this.assertDirectory(resolved.workspaceRoot, 'Workspace root');
    if (candidate.obsidianVaultPath) this.assertDirectory(resolved.obsidianVaultPath, 'Obsidian vault');
    const previous = this.config;
    const previousError = this.loadError;
    this.config = candidate;
    this.loadError = undefined;
    const result = this.status();
    this.config = previous;
    this.loadError = previousError;
    return result;
  }

  configure(input: WorkspaceConfigInput): WorkspaceConfig {
    const candidate = this.buildConfig(input, this.config);
    this.assertPathPolicy(candidate);
    const resolved = this.getResolvedPaths(candidate)!;
    this.assertDirectory(resolved.workspaceRoot, 'Workspace root');
    if (candidate.obsidianVaultPath) this.assertDirectory(resolved.obsidianVaultPath, 'Obsidian vault');
    this.ensureManagedDirectories(resolved);
    this.persist(candidate);
    return this.getConfig()!;
  }

  createWorkspace(input: WorkspaceConfigInput & { createLocalObsidianVault?: boolean }): WorkspaceConfig {
    const candidate = this.buildConfig({
      ...input,
      userId: input.userId ?? this.config?.userId,
      deviceId: input.deviceId ?? this.config?.deviceId,
    });
    this.assertPathPolicy(candidate);
    const resolved = this.getResolvedPaths(candidate)!;
    if (fs.existsSync(resolved.workspaceRoot) && !fs.statSync(resolved.workspaceRoot).isDirectory()) {
      throw new Error('Workspace root points to a file.');
    }
    fs.mkdirSync(resolved.workspaceRoot, { recursive: true });
    this.ensureManagedDirectories(resolved);
    for (const folder of WORKSPACE_DIRECTORIES) fs.mkdirSync(path.join(resolved.workspaceRoot, folder), { recursive: true });
    if (input.createLocalObsidianVault) {
      if (!candidate.obsidianVaultPath) {
        candidate.obsidianVaultPath = candidate.portableMode ? 'Obsidian' : path.join(resolved.workspaceRoot, 'Obsidian');
      }
      const vaultPath = this.getResolvedPaths(candidate)!.obsidianVaultPath;
      if (!isInside(resolved.workspaceRoot, vaultPath)) throw new Error('Local Obsidian vault must stay inside the workspace root.');
      fs.mkdirSync(path.join(vaultPath, '.obsidian'), { recursive: true });
    } else if (candidate.obsidianVaultPath) {
      this.assertDirectory(this.getResolvedPaths(candidate)!.obsidianVaultPath, 'Obsidian vault');
    }
    this.persist(candidate);
    return this.getConfig()!;
  }

  reload(): WorkspaceStatus {
    this.config = undefined;
    this.loadError = undefined;
    this.load();
    return this.status();
  }

  private load(): void {
    if (!fs.existsSync(this.configFile)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configFile, 'utf8')) as Partial<WorkspaceConfig>;
      this.config = this.parseStoredConfig(parsed);
      this.assertPathPolicy(this.config);
    } catch (error) {
      this.config = undefined;
      this.loadError = error instanceof Error ? error.message : 'Workspace configuration could not be read.';
    }
  }

  private migrateLegacyConfiguration(): void {
    const legacyDataDir = path.join(this.appRoot, '.edith');
    const legacyVaultFile = path.join(legacyDataDir, 'obsidian-settings.json');
    const savedVault = this.readLegacyVaultPath(legacyVaultFile);
    const environmentVault = stringValue(this.env.EDITH_OBSIDIAN_VAULT_PATH || this.env.OBSIDIAN_VAULT_PATH);
    const configuredRoot = stringValue(this.env.EDITH_WORKSPACE_ROOT);
    const hasLegacyData = fs.existsSync(legacyDataDir);
    if (!hasLegacyData && !savedVault && !environmentVault && !configuredRoot) return;

    const source: WorkspaceMigrationInfo['source'] = savedVault
      ? 'legacy_obsidian_settings'
      : environmentVault
        ? 'environment'
        : 'legacy_edith_data';
    const workspaceRoot = path.resolve(configuredRoot || this.appRoot);
    const migrated = this.buildConfig({
      workspaceRoot,
      obsidianVaultPath: savedVault || environmentVault,
      chatHistoryPath: path.join(workspaceRoot, MANAGED_DEFAULTS.chatHistoryPath),
      logsPath: path.join(workspaceRoot, MANAGED_DEFAULTS.logsPath),
      dataPath: hasLegacyData ? legacyDataDir : path.join(workspaceRoot, MANAGED_DEFAULTS.dataPath),
      backupPath: path.join(workspaceRoot, MANAGED_DEFAULTS.backupPath),
      exportsPath: path.join(workspaceRoot, MANAGED_DEFAULTS.exportsPath),
      portableMode: false,
    });
    migrated.migration = { source, importedAt: now(), movedFiles: false };
    this.persist(migrated);
  }

  private buildConfig(input: WorkspaceConfigInput, existing?: WorkspaceConfig): WorkspaceConfig {
    const portableMode = input.portableMode ?? existing?.portableMode ?? false;
    const rawRoot = stringValue(input.workspaceRoot || existing?.workspaceRoot);
    if (!rawRoot) throw new Error('Workspace root is required.');
    if (rawRoot.includes('\0')) throw new Error('Workspace root contains an invalid character.');
    if (portableMode && path.isAbsolute(rawRoot)) throw new Error('Portable workspace root must be relative to the application root.');
    const workspaceRoot = portableMode ? rawRoot : path.resolve(this.appRoot, rawRoot);
    const resolvedRoot = path.isAbsolute(workspaceRoot) ? workspaceRoot : path.resolve(this.appRoot, workspaceRoot);
    const rootChanged = Boolean(existing)
      && (workspaceRoot !== existing?.workspaceRoot || portableMode !== existing?.portableMode);
    const child = (key: WorkspaceManagedPathKey, value?: string): string => {
      const selected = stringValue(value ?? (rootChanged ? undefined : existing?.[key])) || MANAGED_DEFAULTS[key];
      if (selected.includes('\0')) throw new Error(`${key} contains an invalid character.`);
      if (portableMode) {
        if (path.isAbsolute(selected)) throw new Error(`${key} must be relative in portable mode.`);
        return selected;
      }
      return path.isAbsolute(selected) ? path.normalize(selected) : path.resolve(resolvedRoot, selected);
    };
    const selectedVault = stringValue(input.obsidianVaultPath ?? existing?.obsidianVaultPath);
    const obsidianVaultPath = selectedVault
      ? (portableMode && !path.isAbsolute(selectedVault) ? selectedVault : path.resolve(resolvedRoot, selectedVault))
      : '';
    const timestamp = now();
    return {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      workspaceId: existing?.workspaceId ?? randomUUID(),
      userId: stringValue(input.userId ?? existing?.userId ?? this.env.EDITH_USER_ID) || undefined,
      deviceId: stringValue(input.deviceId ?? existing?.deviceId) || `device-${os.hostname().toLocaleLowerCase('en-US').replace(/[^a-z0-9-]+/g, '-')}-${randomUUID().slice(0, 8)}`,
      workspaceRoot,
      obsidianVaultPath,
      chatHistoryPath: child('chatHistoryPath', input.chatHistoryPath),
      logsPath: child('logsPath', input.logsPath),
      dataPath: child('dataPath', input.dataPath),
      backupPath: child('backupPath', input.backupPath),
      exportsPath: child('exportsPath', input.exportsPath),
      portableMode,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      migration: existing?.migration,
    };
  }

  private parseStoredConfig(input: Partial<WorkspaceConfig>): WorkspaceConfig {
    if (input.schemaVersion !== WORKSPACE_SCHEMA_VERSION) throw new Error('Unsupported workspace configuration version.');
    const required = ['workspaceId', 'deviceId', 'workspaceRoot', 'chatHistoryPath', 'logsPath', 'dataPath', 'backupPath', 'exportsPath', 'createdAt', 'updatedAt'] as const;
    for (const key of required) {
      if (!stringValue(input[key])) throw new Error(`Workspace configuration is missing ${key}.`);
    }
    return {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      workspaceId: stringValue(input.workspaceId),
      userId: stringValue(input.userId) || undefined,
      deviceId: stringValue(input.deviceId),
      workspaceRoot: stringValue(input.workspaceRoot),
      obsidianVaultPath: stringValue(input.obsidianVaultPath),
      chatHistoryPath: stringValue(input.chatHistoryPath),
      logsPath: stringValue(input.logsPath),
      dataPath: stringValue(input.dataPath),
      backupPath: stringValue(input.backupPath),
      exportsPath: stringValue(input.exportsPath),
      portableMode: input.portableMode === true,
      createdAt: stringValue(input.createdAt),
      updatedAt: stringValue(input.updatedAt),
      migration: input.migration,
    };
  }

  private assertPathPolicy(config: WorkspaceConfig): void {
    const resolved = this.getResolvedPaths(config)!;
    for (const key of Object.keys(MANAGED_DEFAULTS) as WorkspaceManagedPathKey[]) {
      if (!isInside(resolved.workspaceRoot, resolved[key])) {
        throw new Error(`${key} must stay inside the workspace root.`);
      }
    }
    if (config.portableMode && path.isAbsolute(config.workspaceRoot)) {
      throw new Error('Portable workspace root must be relative.');
    }
  }

  private assertDirectory(target: string, label: string): void {
    if (!target || !fs.existsSync(target)) throw new Error(`${label} does not exist.`);
    if (!fs.statSync(target).isDirectory()) throw new Error(`${label} must be a directory.`);
    if (!canAccess(target, fs.constants.R_OK)) throw new Error(`${label} is not readable.`);
    if (!canAccess(target, fs.constants.W_OK)) throw new Error(`${label} is not writable.`);
    const probe = path.join(target, `.edith-write-probe-${process.pid}-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(probe, 'ok', { encoding: 'utf8', flag: 'wx' });
    } catch {
      throw new Error(`${label} is not writable.`);
    } finally {
      try {
        if (fs.existsSync(probe)) fs.rmSync(probe);
      } catch {
        // The probe is uniquely named and contains no user data; cleanup is best-effort.
      }
    }
  }

  private ensureManagedDirectories(resolved: ResolvedWorkspacePaths): void {
    for (const key of Object.keys(MANAGED_DEFAULTS) as WorkspaceManagedPathKey[]) {
      fs.mkdirSync(resolved[key], { recursive: true });
      this.assertDirectory(resolved[key], key);
    }
  }

  private persist(config: WorkspaceConfig): void {
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
    const serialized = `${JSON.stringify(config, null, 2)}\n`;
    const tempFile = `${this.configFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, serialized, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempFile, this.configFile);
    this.config = config;
    this.loadError = undefined;
  }

  private readLegacyVaultPath(filePath: string): string {
    if (!fs.existsSync(filePath)) return '';
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { vaultPath?: unknown };
      return stringValue(parsed.vaultPath);
    } catch {
      return '';
    }
  }
}

export const workspaceManager = new WorkspaceManager();
