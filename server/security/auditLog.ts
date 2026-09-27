import type { Request } from "express";
import { appendAuditEvent, createAuditEvent } from "../../src/edith/audit";
import type { EdithRiskLevel } from "../../src/edith/core";
import { redactSensitiveText } from "./redaction";

interface SecurityAuditInput {
  action: string;
  actor?: string;
  authorization: "allowed" | "denied";
  result: "success" | "error" | "denied";
  message: string;
  riskLevel?: EdithRiskLevel;
  toolId?: string;
}

/** Persist only minimal request metadata; never request bodies, headers, cookies, or query strings. */
export function appendSecurityAudit(req: Request, input: SecurityAuditInput): void {
  try {
    appendAuditEvent(createAuditEvent({
      actor: redactSensitiveText(input.actor ?? "unauthenticated", 80),
      action: redactSensitiveText(input.action, 120),
      toolId: redactSensitiveText(input.toolId ?? "backend_security", 120),
      target: redactSensitiveText(`${req.method} ${req.path}`, 200),
      authorization: input.authorization,
      riskLevel: input.riskLevel ?? 4,
      result: input.result,
      message: redactSensitiveText(input.message, 300),
    }));
  } catch {
    // Authorization remains fail-closed if audit persistence is unavailable.
  }
}

