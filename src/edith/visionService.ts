import os from 'node:os';
import type { StructuredObservation, StructuredObservationSource } from './core';
import { appendAuditEvent, createAuditEvent } from './audit';
import { localToolProbeService } from './localToolProbes';

export interface CreateObservationInput {
  source?: StructuredObservationSource;
  question?: string;
  text?: string;
  application?: string;
  windowTitle?: string;
  monitorIndex?: number;
  previousObservationId?: string;
  currentObservationId?: string;
}

function observationId(): string {
  return `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class VisionObservationService {
  createObservation(input: CreateObservationInput = {}): StructuredObservation {
    const source = input.source ?? 'screen';
    const hasVisualRuntime = false;
    const probes = new Map(localToolProbeService.list().map((probe) => [probe.id, probe]));
    const summary = hasVisualRuntime
      ? 'Screen observation completed.'
      : 'Read-only vision foundation is available, but no local screenshot/OCR adapter is configured.';

    const observation: StructuredObservation = {
      id: observationId(),
      source,
      capturedAt: new Date().toISOString(),
      summary,
      text: input.text,
      application: input.application,
      windowTitle: input.windowTitle,
      monitorIndex: input.monitorIndex,
      confidence: hasVisualRuntime ? 0.8 : 0.25,
      readOnly: true,
      artifacts: [],
      metadata: {
        question: input.question,
        platform: os.platform(),
        adapters: {
          screenshot: 'CONFIGURATION_REQUIRED',
          ocr: probes.get('tesseract')?.status === 'detected' ? 'DETECTED_NOT_BOUND' : 'CONFIGURATION_REQUIRED',
          windowDetection: 'CONFIGURATION_REQUIRED',
          pdfUnderstanding: 'CONFIGURATION_REQUIRED',
          browserPageUnderstanding: 'AVAILABLE_THROUGH_BROWSER_WORKFLOW',
        },
        localProbes: {
          tesseract: probes.get('tesseract'),
          playwright: probes.get('playwright'),
        },
        previousObservationId: input.previousObservationId,
        currentObservationId: input.currentObservationId,
      },
    };

    appendAuditEvent(createAuditEvent({
      actor: 'edith-vision-service',
      action: 'vision.observe',
      toolId: 'vision_observe',
      authorization: 'allowed',
      riskLevel: 0,
      result: 'success',
      message: `${source} observation created in read-only mode.`,
    }));

    return observation;
  }

  compare(previous: StructuredObservation, current: StructuredObservation): StructuredObservation {
    const changedFields = ['summary', 'text', 'application', 'windowTitle']
      .filter((key) => previous[key as keyof StructuredObservation] !== current[key as keyof StructuredObservation]);

    const observation: StructuredObservation = {
      id: observationId(),
      source: 'screenshot_diff',
      capturedAt: new Date().toISOString(),
      summary: changedFields.length
        ? `Detected changes in: ${changedFields.join(', ')}.`
        : 'No structured changes detected between observations.',
      confidence: Math.min(previous.confidence, current.confidence),
      readOnly: true,
      artifacts: [],
      metadata: {
        previousObservationId: previous.id,
        currentObservationId: current.id,
        changedFields,
      },
    };

    appendAuditEvent(createAuditEvent({
      actor: 'edith-vision-service',
      action: 'vision.compare',
      toolId: 'vision_observe',
      authorization: 'allowed',
      riskLevel: 0,
      result: 'success',
      message: `Read-only observation comparison created with ${changedFields.length} changed field(s).`,
    }));

    return observation;
  }
}

export const visionObservationService = new VisionObservationService();
