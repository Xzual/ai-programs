import type { ConfidenceCheck, EdithRiskLevel, PatternMemoryEntry, PresenceContext, SentimentContext } from './core';

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class SentimentContextService {
  analyzeText(text: string): SentimentContext {
    const lower = text.toLocaleLowerCase('tr-TR');
    const urgent = /\b(acil|hemen|çabuk|urgent|asap)\b/i.test(lower);
    const frustrated = /\b(bozuldu|hata|olmuyor|sinir|bıktım|problem)\b/i.test(lower);
    const positive = /\b(teşekkür|harika|güzel|süper|thanks)\b/i.test(lower);
    const tone: SentimentContext['tone'] = urgent
      ? 'urgent'
      : frustrated
      ? 'frustrated'
      : positive
      ? 'positive'
      : 'neutral';
    return {
      id: id('sentiment'),
      capturedAt: new Date().toISOString(),
      source: 'text',
      tone,
      responseStyle: urgent ? 'brief' : frustrated ? 'supportive' : 'standard',
      confidence: urgent || frustrated || positive ? 0.65 : 0.4,
      notes: ['Non-clinical communication-style estimate only.'],
    };
  }
}

export class PresenceContextService {
  snapshot(input: Partial<PresenceContext> = {}): PresenceContext {
    return {
      id: id('presence'),
      capturedAt: new Date().toISOString(),
      device: input.device ?? 'desktop',
      activeApplication: input.activeApplication,
      activeWindowTitle: input.activeWindowTitle,
      microphoneInUse: input.microphoneInUse,
      cameraInUse: input.cameraInUse,
      inferredState: input.inferredState ?? 'unknown',
      confidence: input.confidence ?? 0.35,
    };
  }
}

export class PatternMemoryService {
  observeCommand(command: string, existing: PatternMemoryEntry[] = []): PatternMemoryEntry {
    const normalized = command.trim().toLocaleLowerCase('tr-TR').slice(0, 80);
    const current = existing.find((entry) => entry.patternType === 'frequent_command' && entry.label === normalized);
    return {
      id: current?.id ?? id('pattern'),
      patternType: 'frequent_command',
      label: normalized,
      evidenceCount: (current?.evidenceCount ?? 0) + 1,
      lastObservedAt: new Date().toISOString(),
      confidence: Math.min(0.95, 0.25 + ((current?.evidenceCount ?? 0) + 1) * 0.1),
      metadata: { source: 'chat_command' },
    };
  }
}

export class ConfidenceService {
  check(input: { subject: string; confidence?: number; riskLevel?: EdithRiskLevel; rationale?: string }): ConfidenceCheck {
    const confidence = Math.max(0, Math.min(1, input.confidence ?? 0.5));
    const riskLevel = input.riskLevel ?? 1;
    return {
      id: id('confidence'),
      createdAt: new Date().toISOString(),
      subject: input.subject,
      confidence,
      riskLevel,
      requiresApproval: confidence < 0.65 || riskLevel >= 3,
      rationale: input.rationale ?? (confidence < 0.65 ? 'Confidence is below approval threshold.' : 'Confidence is sufficient for low-risk flow.'),
    };
  }
}

export const sentimentContextService = new SentimentContextService();
export const presenceContextService = new PresenceContextService();
export const patternMemoryService = new PatternMemoryService();
export const confidenceService = new ConfidenceService();
