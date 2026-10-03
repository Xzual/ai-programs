import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EDITH_CONTRACT_AMENDMENT,
  OBSIDIAN_PROVIDER_CONFIG_VERSION,
  TASK_CONTRACT_VERSION,
  parseObsidianProviderLocalConfigV1,
  parseObsidianProviderPublicStatusV1,
  parseTrustedNativeVaultSelectionV1,
  type ObsidianProviderLocalConfigV1,
  type ObsidianProviderPublicStatusV1,
  type TrustedNativeVaultSelectionV1,
} from './contracts';

export interface TrustedNativeVaultSelectionVerifier {
  verify(selection: TrustedNativeVaultSelectionV1): { trusted: boolean; reasonCode?: string };
}

export interface ObsidianProviderServiceOptions {
  appRoot?: string;
  configFile?: string;
  env?: NodeJS.ProcessEnv;
  verifier?: TrustedNativeVaultSelectionVerifier;
  now?: () => Date;
}

export interface KnowledgeVaultProvider {
  readonly providerId: 'user-vault' | 'sandbox-vault';
  readonly sandboxed: boolean;
  readonly executionAuthority: false;
  readonly root: string;
  read(relativePath: string): string | undefined;
  write(relativePath: string, content: string): void;
  exists(relativePath: string): boolean;
}

const denyVerifier: TrustedNativeVaultSelectionVerifier = {
  verify: () => ({ trusted: false, reasonCode: 'NATIVE_PICKER_ATTESTATION_REQUIRED' }),
};

function inside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function realPath(target: string): string {
  return fs.realpathSync.native ? fs.realpathSync.native(target) : fs.realpathSync(target);
}

function assertNoSymlinkChain(target: string): void {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const relative = path.relative(root, resolved);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('OBSIDIAN_PATH_LINK_ESCAPE');
  }
}

function assertDirectoryWithoutMutation(target: string): string {
  if (!path.isAbsolute(target) || target.includes('\0')) throw new Error('OBSIDIAN_PATH_ABSOLUTE_REQUIRED');
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error('OBSIDIAN_VAULT_UNAVAILABLE');
  assertNoSymlinkChain(target);
  return realPath(target);
}

function sensitiveRoots(appRoot: string): string[] {
  return [
    path.parse(appRoot).root,
    os.homedir(),
    os.tmpdir(),
    appRoot,
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env.ProgramData,
  ].filter((value): value is string => Boolean(value)).map((value) => path.resolve(value));
}

export function validateProductionVaultRoot(target: string, appRoot = process.cwd()): string {
  const resolved = assertDirectoryWithoutMutation(target);
  for (const sensitive of sensitiveRoots(appRoot)) {
    const comparable = fs.existsSync(sensitive) ? realPath(sensitive) : path.resolve(sensitive);
    if (resolved === comparable || sensitive === path.resolve(appRoot) && inside(comparable, resolved)) {
      throw new Error('OBSIDIAN_SENSITIVE_ROOT_REJECTED');
    }
    if ([process.env.SystemRoot, process.env.ProgramFiles, process.env.ProgramData].filter(Boolean).some((item) => path.resolve(String(item)) === sensitive)
      && inside(comparable, resolved)) throw new Error('OBSIDIAN_SENSITIVE_ROOT_REJECTED');
  }
  fs.accessSync(resolved, fs.constants.R_OK);
  return resolved;
}

export function validateSandboxVaultRoot(target: string, options: { appRoot?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const env = options.env ?? process.env;
  if (env.EDITH_TEST_MODE !== 'true' && env.NODE_ENV !== 'test') throw new Error('OBSIDIAN_SANDBOX_TEST_MODE_REQUIRED');
  const resolved = assertDirectoryWithoutMutation(target);
  const tempRoot = realPath(os.tmpdir());
  if (resolved === tempRoot || !inside(tempRoot, resolved)) throw new Error('OBSIDIAN_SANDBOX_TEMP_ROOT_REQUIRED');
  const appRoot = path.resolve(options.appRoot ?? process.cwd());
  if (inside(appRoot, resolved) || inside(resolved, appRoot) || resolved === realPath(os.homedir())) {
    throw new Error('OBSIDIAN_SANDBOX_PROJECT_OR_PROFILE_REJECTED');
  }
  return resolved;
}

function resolveContained(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) throw new Error('OBSIDIAN_RELATIVE_PATH_REQUIRED');
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.split('/').some((segment) => segment === '..')) throw new Error('OBSIDIAN_PATH_TRAVERSAL_REJECTED');
  const target = path.resolve(root, normalized);
  if (!inside(root, target)) throw new Error('OBSIDIAN_PATH_ESCAPE_REJECTED');
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('OBSIDIAN_PATH_LINK_ESCAPE');
    if (!inside(root, realPath(current))) throw new Error('OBSIDIAN_PATH_LINK_ESCAPE');
  }
  return target;
}

abstract class FilesystemKnowledgeVaultProvider implements KnowledgeVaultProvider {
  abstract readonly providerId: 'user-vault' | 'sandbox-vault';
  abstract readonly sandboxed: boolean;
  readonly executionAuthority = false as const;

  constructor(readonly root: string) {}

  read(relativePath: string): string | undefined {
    const target = resolveContained(this.root, relativePath);
    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  }

  exists(relativePath: string): boolean {
    return fs.existsSync(resolveContained(this.root, relativePath));
  }

  write(relativePath: string, content: string): void {
    const target = resolveContained(this.root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    resolveContained(this.root, relativePath);
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, target);
  }
}

export class UserVaultProvider extends FilesystemKnowledgeVaultProvider {
  readonly providerId = 'user-vault' as const;
  readonly sandboxed = false;

  constructor(root: string, options: { appRoot?: string; env?: NodeJS.ProcessEnv } = {}) {
    const env = options.env ?? process.env;
    if (env.EDITH_TEST_MODE === 'true' || env.NODE_ENV === 'test') throw new Error('OBSIDIAN_USER_PROVIDER_FORBIDDEN_IN_TEST');
    super(validateProductionVaultRoot(root, options.appRoot));
  }
}

export class SandboxVaultProvider extends FilesystemKnowledgeVaultProvider {
  readonly providerId = 'sandbox-vault' as const;
  readonly sandboxed = true;

  constructor(root: string, options: { appRoot?: string; env?: NodeJS.ProcessEnv } = {}) {
    super(validateSandboxVaultRoot(root, options));
  }
}

function atomicReplaceFile(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const nonce = `${process.pid}-${Date.now()}-${randomUUID()}`;
  const temp = `${target}.${nonce}.tmp`;
  const backup = `${target}.${nonce}.bak`;
  const existed = fs.existsSync(target);
  fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    if (existed) fs.renameSync(target, backup);
    fs.renameSync(temp, target);
    if (existed && fs.existsSync(backup)) fs.rmSync(backup);
  } catch (error) {
    if (fs.existsSync(temp)) fs.rmSync(temp);
    if (existed && fs.existsSync(backup) && !fs.existsSync(target)) fs.renameSync(backup, target);
    throw error;
  }
}

export class ObsidianProviderConfigService {
  readonly appRoot: string;
  readonly configFile: string;
  readonly testMode: boolean;

  private readonly env: NodeJS.ProcessEnv;
  private readonly verifier: TrustedNativeVaultSelectionVerifier;
  private readonly clock: () => Date;
  private config?: ObsidianProviderLocalConfigV1;
  private loadError?: string;

  constructor(options: ObsidianProviderServiceOptions = {}) {
    this.env = options.env ?? process.env;
    this.appRoot = path.resolve(options.appRoot ?? this.env.EDITH_OBSIDIAN_PROVIDER_APP_ROOT ?? process.cwd());
    this.configFile = path.resolve(options.configFile ?? path.join(this.appRoot, '.edith', 'obsidian-provider.json'));
    this.verifier = options.verifier ?? denyVerifier;
    this.clock = options.now ?? (() => new Date());
    this.testMode = this.env.EDITH_TEST_MODE === 'true' || this.env.NODE_ENV === 'test';
    if (!this.testMode) this.loadOnce();
  }

  status(): ObsidianProviderPublicStatusV1 {
    const checkedAt = this.clock().toISOString();
    if (this.testMode) {
      const configuredRoot = String(this.env.EDITH_TEST_OBSIDIAN_SANDBOX_ROOT ?? '').trim();
      if (!configuredRoot) return this.checked({ state: 'FIRST_RUN_REQUIRED', reasonCode: 'TEST_SANDBOX_REQUIRED', provider: 'none', configured: false, available: false, readable: false, writable: false, selectionAction: 'show_first_run', configRevision: 0, checkedAt });
      try {
        const root = validateSandboxVaultRoot(configuredRoot, { appRoot: this.appRoot, env: this.env });
        return this.checked({ state: 'READY', reasonCode: 'TEST_SANDBOX_READY', provider: 'sandbox_vault', configured: true, available: true, readable: canAccess(root, fs.constants.R_OK), writable: canAccess(root, fs.constants.W_OK), selectionAction: 'none', configRevision: 0, checkedAt });
      } catch {
        return this.checked({ state: 'DEGRADED', reasonCode: 'CONFIG_INVALID', provider: 'none', configured: false, available: false, readable: false, writable: false, selectionAction: 'none', configRevision: 0, checkedAt });
      }
    }
    if (this.loadError) return this.checked({ state: 'DEGRADED', reasonCode: 'CONFIG_INVALID', provider: 'none', configured: false, available: false, readable: false, writable: false, selectionAction: 'none', configRevision: 0, checkedAt });
    if (!this.config) return this.checked({ state: 'FIRST_RUN_REQUIRED', reasonCode: 'VAULT_SELECTION_REQUIRED', provider: 'none', configured: false, available: false, readable: false, writable: false, selectionAction: 'show_first_run', configRevision: 0, checkedAt });
    if (this.config.provider === 'revoked') return this.checked({ state: 'FIRST_RUN_REQUIRED', reasonCode: 'VAULT_SELECTION_REVOKED', provider: 'none', configured: false, available: false, readable: false, writable: false, selectionAction: 'show_first_run', configRevision: this.config.revision, checkedAt });
    try {
      const root = validateProductionVaultRoot(this.config.selectedPath!, this.appRoot);
      return this.checked({ state: 'READY', reasonCode: 'VAULT_READY', provider: 'user_vault', configured: true, available: true, readable: canAccess(root, fs.constants.R_OK), writable: canAccess(root, fs.constants.W_OK), selectionAction: 'none', configRevision: this.config.revision, checkedAt });
    } catch {
      return this.checked({ state: 'DEGRADED', reasonCode: 'VAULT_UNAVAILABLE', provider: 'user_vault', configured: true, available: false, readable: false, writable: false, selectionAction: 'none', configRevision: this.config.revision, checkedAt });
    }
  }

  activateTrustedSelection(input: unknown, verifier: TrustedNativeVaultSelectionVerifier = this.verifier): ObsidianProviderPublicStatusV1 {
    return this.applyTrustedSelection(input, verifier);
  }

  changeTrustedSelection(input: unknown, verifier: TrustedNativeVaultSelectionVerifier = this.verifier): ObsidianProviderPublicStatusV1 {
    if (this.config?.provider !== 'user_vault') throw new Error('OBSIDIAN_PROVIDER_CHANGE_REQUIRES_ACTIVE_VAULT');
    return this.applyTrustedSelection(input, verifier);
  }

  private applyTrustedSelection(input: unknown, verifier: TrustedNativeVaultSelectionVerifier): ObsidianProviderPublicStatusV1 {
    if (this.testMode) throw new Error('OBSIDIAN_USER_PROVIDER_FORBIDDEN_IN_TEST');
    const parsed = parseTrustedNativeVaultSelectionV1(input);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    if (Date.parse(parsed.value.expiresAt) <= this.clock().getTime()) throw new Error('OBSIDIAN_NATIVE_SELECTION_EXPIRED');
    if (Date.parse(parsed.value.selectedAt) > this.clock().getTime()) throw new Error('OBSIDIAN_NATIVE_SELECTION_INVALID');
    if (this.config?.provider === 'user_vault' && this.config.selectionId === parsed.value.selectionId) {
      throw new Error('OBSIDIAN_NATIVE_SELECTION_REPLAYED');
    }
    const trust = verifier.verify(parsed.value);
    if (!trust.trusted) throw new Error(trust.reasonCode ?? 'OBSIDIAN_NATIVE_SELECTION_UNTRUSTED');
    const selectedPath = validateProductionVaultRoot(parsed.value.selectedPath, this.appRoot);
    const timestamp = this.clock().toISOString();
    const config: ObsidianProviderLocalConfigV1 = {
      schemaVersion: OBSIDIAN_PROVIDER_CONFIG_VERSION,
      revision: (this.config?.revision ?? 0) + 1,
      provider: 'user_vault',
      selectedPath,
      deviceId: parsed.value.deviceId,
      selectionId: parsed.value.selectionId,
      approvedAt: timestamp,
      updatedAt: timestamp,
    };
    this.persist(config);
    return this.status();
  }

  revoke(): ObsidianProviderPublicStatusV1 {
    if (this.testMode) throw new Error('OBSIDIAN_TEST_SANDBOX_CANNOT_BE_REVOKED');
    const timestamp = this.clock().toISOString();
    this.persist({ schemaVersion: OBSIDIAN_PROVIDER_CONFIG_VERSION, revision: (this.config?.revision ?? 0) + 1, provider: 'revoked', revokedAt: timestamp, updatedAt: timestamp });
    return this.status();
  }

  provider(): KnowledgeVaultProvider | undefined {
    const status = this.status();
    if (status.state !== 'READY') return undefined;
    if (this.testMode) return new SandboxVaultProvider(String(this.env.EDITH_TEST_OBSIDIAN_SANDBOX_ROOT), { appRoot: this.appRoot, env: this.env });
    return new UserVaultProvider(this.config!.selectedPath!, { appRoot: this.appRoot, env: this.env });
  }

  activeVaultPath(): string | undefined {
    return this.provider()?.root;
  }

  localConfigFingerprint(): string | undefined {
    return this.config?.provider === 'user_vault' ? createHash('sha256').update(this.config.selectedPath!).digest('hex') : undefined;
  }

  private loadOnce(): void {
    if (!fs.existsSync(this.configFile)) return;
    try {
      const parsed = parseObsidianProviderLocalConfigV1(JSON.parse(fs.readFileSync(this.configFile, 'utf8')));
      if (parsed.success === false) throw new Error(parsed.errorCode);
      this.config = parsed.value;
    } catch {
      this.loadError = 'OBSIDIAN_PROVIDER_CONFIG_INVALID';
    }
  }

  private persist(config: ObsidianProviderLocalConfigV1): void {
    const parsed = parseObsidianProviderLocalConfigV1(config);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    atomicReplaceFile(this.configFile, `${JSON.stringify(parsed.value, null, 2)}\n`);
    this.config = parsed.value;
    this.loadError = undefined;
  }

  private checked(value: Omit<ObsidianProviderPublicStatusV1, 'contractVersion' | 'amendment' | 'executionAuthority' | 'knowledgeOnly' | 'promptPolicy'>): ObsidianProviderPublicStatusV1 {
    const candidate: ObsidianProviderPublicStatusV1 = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, executionAuthority: false, knowledgeOnly: true, promptPolicy: 'user_initiated_only', ...value };
    const parsed = parseObsidianProviderPublicStatusV1(candidate);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    return parsed.value;
  }
}

function canAccess(target: string, mode: number): boolean {
  try {
    fs.accessSync(target, mode);
    return true;
  } catch {
    return false;
  }
}

export const obsidianProviderConfigService = new ObsidianProviderConfigService();
