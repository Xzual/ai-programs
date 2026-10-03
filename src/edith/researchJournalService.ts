import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ResearchRunV2 } from './contracts';
import { validateSandboxVaultRoot } from './obsidianProviderService';
import { redactSensitiveString } from './securityRedaction';

export const RESEARCH_JOURNAL_FOLDER = 'E.D.I.T.H/Research Journal';
export const RESEARCH_JOURNAL_MARKER = 'edith_owned: research_journal_v2_1';

export interface ResearchJournalWriteResult {
  status: 'written' | 'configuration_required' | 'blocked';
  relativePath?: string;
  redacted: boolean;
  reason?: string;
}

export interface ResearchJournalVaultProvider {
  readonly providerId: string;
  readonly sandboxed: boolean;
  read(relativePath: string): string | undefined;
  write(relativePath: string, content: string): void;
  exists(relativePath: string): boolean;
}

export type ResearchJournalVaultProviderResolver = () => ResearchJournalVaultProvider | undefined;

function safeSegment(value: string): string {
  return value.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'research';
}

function redactJournalText(value: string): { text: string; redacted: boolean } {
  const sensitive = redactSensitiveString(value)
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)(?:[^\s`"']+[\\/])+[^\s`"']*/g, '[REDACTED_LOCAL_PATH]');
  return { text: sensitive, redacted: sensitive !== value };
}

export class SandboxVaultProvider implements ResearchJournalVaultProvider {
  readonly providerId = 'sandbox-vault';
  readonly sandboxed = true;
  readonly root: string;

  constructor(root: string) {
    fs.mkdirSync(root, { recursive: true });
    this.root = validateSandboxVaultRoot(root);
  }

  read(relativePath: string): string | undefined {
    const target = this.resolve(relativePath);
    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  }

  exists(relativePath: string): boolean { return fs.existsSync(this.resolve(relativePath)); }

  write(relativePath: string, content: string): void {
    const target = this.resolve(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, target);
  }

  private resolve(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized.startsWith(`${RESEARCH_JOURNAL_FOLDER}/`)) throw new Error('Sandbox research journal writes are restricted to the E.D.I.T.H.-owned folder.');
    const target = path.resolve(this.root, normalized);
    const relative = path.relative(this.root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Sandbox research journal path escapes its root.');
    let parent = path.dirname(target);
    while (!fs.existsSync(parent) && parent !== this.root) parent = path.dirname(parent);
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('Sandbox research journal does not follow symbolic links.');
    return target;
  }
}

export class ResearchJournalService {
  constructor(private readonly provider?: ResearchJournalVaultProvider | ResearchJournalVaultProviderResolver) {}

  write(run: ResearchRunV2): ResearchJournalWriteResult {
    const provider = typeof this.provider === 'function' ? this.provider() : this.provider;
    if (!provider) return { status: 'configuration_required', redacted: false, reason: 'A journal vault provider is not configured.' };
    if (!provider.sandboxed && process.env.NODE_ENV !== 'production') {
      return { status: 'blocked', redacted: false, reason: 'Test and development journal writes require SandboxVaultProvider.' };
    }
    const baseName = `${safeSegment(run.runId)}-${safeSegment(redactSensitiveString(run.query)).slice(0, 48)}`;
    let relativePath = `${RESEARCH_JOURNAL_FOLDER}/${baseName}.md`;
    const existing = provider.read(relativePath);
    if (existing && !existing.includes(RESEARCH_JOURNAL_MARKER)) {
      relativePath = `${RESEARCH_JOURNAL_FOLDER}/${baseName}-edith.md`;
    }
    const rendered = this.render(run);
    provider.write(relativePath, rendered.text);
    return { status: 'written', relativePath, redacted: rendered.redacted };
  }

  private render(run: ResearchRunV2): { text: string; redacted: boolean } {
    const sourceById = new Map((run.sources ?? []).map((source) => [source.sourceId, source]));
    const raw = [
      '---',
      RESEARCH_JOURNAL_MARKER,
      `edith_run_id: ${run.runId}`,
      `edith_mode: ${run.mode ?? 'FAST'}`,
      `edith_status: ${run.status}`,
      `edith_updated_at: ${run.completedAt ?? run.startedAt ?? new Date().toISOString()}`,
      '---',
      '',
      `# ${run.query}`,
      '',
      '## Findings',
      ...(run.claims?.length
        ? run.claims.map((claim) => `- ${claim.statement} (${Math.round(claim.confidence * 100)}%; citations: ${claim.citationIds.join(', ') || 'none'})`)
        : ['- No verified claims were produced.']),
      '',
      '## Sources',
      ...(run.sources?.length
        ? run.sources.map((source) => `- [${source.title ?? source.publisher ?? source.sourceId}](${source.url}) — retrieved ${source.retrievedAt}${source.publishedAt ? `; published ${source.publishedAt}` : ''}`)
        : ['- No sources recorded.']),
      '',
      '## Provenance',
      run.provenance ? `- ${run.provenance.methodology} (${run.provenance.generatedBy})` : '- Not available.',
      `- Freshness: ${run.freshness?.status ?? 'unknown'}`,
      `- Confidence: ${run.confidence ?? 0}`,
      `- Uncertainty: ${run.uncertainty ?? 'None recorded.'}`,
      '',
      '## Prior Run Delta',
      run.priorRunDelta
        ? `- Compared with ${run.priorRunDelta.previousRunId}: ${run.priorRunDelta.summary}`
        : '- No prior run comparison.',
      '',
      '## Citation Map',
      ...(run.citations?.length
        ? run.citations.map((citation) => `- ${citation.citationId} -> ${sourceById.get(citation.sourceId)?.url ?? citation.sourceId}${citation.locator ? ` (${citation.locator})` : ''}`)
        : ['- No citations recorded.']),
      '',
    ].join('\n');
    return redactJournalText(raw);
  }
}
