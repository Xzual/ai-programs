import { Router, type Request } from "express";
import { killSwitchService } from "../../src/edith/killSwitch";
import { ownerActor, requireOwnerSession, requireProtectedMutation } from "../security/ownerSession";
import { appendSecurityAudit } from "../security/auditLog";

const OWNER_DEACTIVATION_CONFIRMATION = "DISABLE_KILL_SWITCH";

function loopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function isValidKillSwitchDeactivationConfirmation(value: unknown): boolean {
  return value === OWNER_DEACTIVATION_CONFIRMATION;
}

export function createKillSwitchRouter(): Router {
  const router = Router();

  router.get("/api/edith/kill-switch", requireOwnerSession, (_req, res) => {
    res.json({
      success: true,
      state: killSwitchService.status(),
    });
  });

  router.post("/api/edith/kill-switch/activate", ...requireProtectedMutation, (req, res) => {
    const reason = String(req.body?.reason ?? "").trim();
    const actor = ownerActor(req);
    const state = killSwitchService.activate(reason || "Manual emergency stop from EDITH API.", actor);
    appendSecurityAudit(req, {
      action: "kill_switch.activate",
      actor,
      authorization: "allowed",
      result: "success",
      message: "Kill switch activated by authenticated owner.",
      riskLevel: 5,
    });
    res.json({
      success: true,
      state,
    });
  });

  router.post("/api/edith/kill-switch/deactivate", ...requireProtectedMutation, (req, res) => {
    const actor = ownerActor(req);
    if (!loopbackRequest(req)) {
      appendSecurityAudit(req, {
        action: "kill_switch.deactivate",
        actor,
        authorization: "denied",
        result: "denied",
        message: "Non-loopback kill switch deactivation rejected.",
        riskLevel: 5,
      });
      return res.status(403).json({
        success: false,
        errorCode: "local_request_required",
        safeMessage: "Kill switch can be deactivated only from the local machine.",
      });
    }
    if (!isValidKillSwitchDeactivationConfirmation(req.body?.confirmation)) {
      appendSecurityAudit(req, {
        action: "kill_switch.deactivate",
        actor,
        authorization: "denied",
        result: "denied",
        message: "Kill switch deactivation lacked explicit owner confirmation.",
        riskLevel: 5,
      });
      return res.status(409).json({
        success: false,
        errorCode: "owner_confirmation_required",
        safeMessage: "Explicit owner confirmation is required to deactivate the kill switch.",
      });
    }
    const state = killSwitchService.deactivate(actor);
    appendSecurityAudit(req, {
      action: "kill_switch.deactivate",
      actor,
      authorization: "allowed",
      result: "success",
      message: "Kill switch deactivated by authenticated local owner.",
      riskLevel: 5,
    });
    res.json({
      success: true,
      state,
    });
  });

  return router;
}
