import fs from 'node:fs';
import path from 'node:path';
import { appendAuditEvent, createAuditEvent } from './audit';
import type { EdithRiskLevel, PresenceContext, SentimentContext } from './core';
import { KillSwitchActiveError, killSwitchService } from './killSwitch';
import { getEdithPersistenceStore } from './persistence';

export interface ProactiveSettings {
  enabled: boolean;
  intervalMinutes: number;
  categories: {
    calendar: boolean;
    mail: boolean;
    system: boolean;
    logs: boolean;
    iot: boolean;
  };
  delivery: {
    text: boolean;
    voice: boolean;
  };
}

export interface ProactiveSignal {
  id: string;
  createdAt: string;
  dismissedAt?: string;
  severity: 'critical' | 'info' | 'suggestion';
  category: keyof ProactiveSettings['categories'];
  title: string;
  message: string;
  requiresApproval: boolean;
  source: 'system' | 'presence' | 'sentiment' | 'connector';
  metadata?: Record<string, unknown>;
}

export interface ProactiveCheckInput {
  presence?: PresenceContext;
  sentiment?: SentimentContext;
}

const DEFAULT_SETTINGS: ProactiveSettings = {
  enabled: false,
  intervalMinutes: 10,
  categories: { calendar: false, mail: false, system: true, logs: true, iot: false },
  delivery: { text: true, voice: false },
};

export class ProactiveService {
  getSettings(): ProactiveSettings {
    const file = this.settingsFile();
    if (!fs.existsSync(file)) return DEFAULT_SETTINGS;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ProactiveSettings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        categories: { ...DEFAULT_SETTINGS.categories, ...parsed.categories },
        delivery: { ...DEFAULT_SETTINGS.delivery, ...parsed.delivery },
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  updateSettings(update: Partial<ProactiveSettings>): ProactiveSettings {
    const settings = {
      ...this.getSettings(),
      ...update,
      categories: { ...this.getSettings().categories, ...update.categories },
      delivery: { ...this.getSettings().delivery, ...update.delivery },
    };
    fs.mkdirSync(path.dirname(this.settingsFile()), { recursive: true });
    fs.writeFileSync(this.settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
    appendAuditEvent(createAuditEvent({
      actor: 'edith-proactive-service',
      action: 'proactive.settings_update',
      toolId: 'proactive_service',
      authorization: 'allowed',
      riskLevel: 1,
      result: 'success',
      message: 'Proactive settings updated.',
    }));
    return settings;
  }

  listSignals(options: { includeDismissed?: boolean } = {}): ProactiveSignal[] {
    const signals = this.readSignals();
    return options.includeDismissed ? signals : signals.filter((signal) => !signal.dismissedAt);
  }

  dismissSignal(signalId: string, actor = 'edith-api'): ProactiveSignal | undefined {
    const signals = this.readSignals();
    const index = signals.findIndex((signal) => signal.id === signalId);
    if (index < 0) return undefined;
    const dismissed = { ...signals[index], dismissedAt: new Date().toISOString() };
    signals[index] = dismissed;
    this.writeSignals(signals);
    this.audit('proactive.signal_dismiss', actor, 'success', 'allowed', 1, `Dismissed proactive signal ${signalId}.`);
    return dismissed;
  }

  checkOnce(input: ProactiveCheckInput = {}, actor = 'edith-proactive-service'): ProactiveSignal[] {
    const settings = this.getSettings();
    if (!settings.enabled) return [];

    try {
      killSwitchService.assertAllowed('proactive_tasks', actor);
    } catch (error) {
      if (error instanceof KillSwitchActiveError) {
        this.audit('proactive.check_blocked', actor, 'denied', 'denied', 4, error.message);
        return [];
      }
      throw error;
    }

    const generated: ProactiveSignal[] = [];
    if (settings.categories.system) {
      generated.push({
        id: this.id('signal'),
        createdAt: new Date().toISOString(),
        severity: 'info',
        category: 'system',
        title: 'Monitoring heartbeat',
        message: 'Proactive monitoring foundation is active. External calendar/mail/IoT connectors are not configured.',
        requiresApproval: false,
        source: 'system',
        metadata: { intervalMinutes: settings.intervalMinutes },
      });
    }

    if (settings.categories.logs && input.sentiment?.tone === 'urgent') {
      generated.push({
        id: this.id('signal'),
        createdAt: new Date().toISOString(),
        severity: 'critical',
        category: 'logs',
        title: 'Urgent user intent detected',
        message: 'Recent text context looks urgent. EDITH should keep responses brief and request confirmation before risky operations.',
        requiresApproval: true,
        source: 'sentiment',
        metadata: { sentimentId: input.sentiment.id, confidence: input.sentiment.confidence },
      });
    }

    if (settings.categories.system && input.presence?.inferredState === 'busy') {
      generated.push({
        id: this.id('signal'),
        createdAt: new Date().toISOString(),
        severity: 'suggestion',
        category: 'system',
        title: 'Busy presence mode',
        message: 'Presence context suggests the user is busy. EDITH should prefer text-only, low-interruption delivery.',
        requiresApproval: false,
        source: 'presence',
        metadata: { presenceId: input.presence.id, activeApplication: input.presence.activeApplication },
      });
    }

    if (settings.categories.iot) {
      generated.push({
        id: this.id('signal'),
        createdAt: new Date().toISOString(),
        severity: 'suggestion',
        category: 'iot',
        title: 'IoT feedback unavailable',
        message: 'IoT feedback is enabled in settings, but no real integration is configured. Actions stay permission-gated stubs.',
        requiresApproval: true,
        source: 'connector',
        metadata: { status: 'configuration_required' },
      });
    }

    this.appendSignals(generated);
    if (generated.length > 0) {
      this.audit('proactive.check', actor, 'success', 'allowed', 1, `Generated ${generated.length} proactive signal(s).`);
    }
    return generated;
  }

  private appendSignals(generated: ProactiveSignal[]): void {
    if (generated.length === 0) return;
    const signals = [...generated, ...this.readSignals()].slice(0, 200);
    this.writeSignals(signals);
  }

  private readSignals(): ProactiveSignal[] {
    const file = this.signalsFile();
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeSignals(signals: ProactiveSignal[]): void {
    fs.mkdirSync(path.dirname(this.signalsFile()), { recursive: true });
    fs.writeFileSync(this.signalsFile(), JSON.stringify(signals, null, 2), 'utf8');
  }

  private signalsFile(): string {
    return path.join(getEdithPersistenceStore().getPaths().dataDir, 'proactive-signals.json');
  }

  private id(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private audit(
    action: string,
    actor: string,
    result: 'success' | 'error' | 'denied',
    authorization: 'allowed' | 'denied',
    riskLevel: EdithRiskLevel,
    message: string
  ): void {
    appendAuditEvent(createAuditEvent({
      actor,
      action,
      toolId: 'proactive_service',
      authorization,
      riskLevel,
      result,
      message,
    }));
  }

  private settingsFile(): string {
    return path.join(getEdithPersistenceStore().getPaths().dataDir, 'proactive-settings.json');
  }
}

export const proactiveService = new ProactiveService();
