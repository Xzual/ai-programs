import { Router } from "express";
import { DEFAULT_LOCAL_PERMISSIONS, HIGH_RISK_PERMISSIONS, permissionService } from "../../src/edith/permissionService";
import { ownerActor, requireOwnerSession, requireProtectedMutation } from "../security/ownerSession";
import { appendSecurityAudit } from "../security/auditLog";
import { redactSensitiveText } from "../security/redaction";

function policyPayload() {
  const policy = permissionService.getPolicy();
  return {
    mode: policy.mode,
    policy,
    highRiskEnabled: permissionService.highRiskEnabled(),
    defaultLocalPermissions: DEFAULT_LOCAL_PERMISSIONS,
    highRiskPermissions: HIGH_RISK_PERMISSIONS,
    authorizedPermissions: permissionService.defaultAuthorizedPermissions(),
    activeGrants: permissionService.listGrants().length,
  };
}

export function createPermissionsRouter(): Router {
  const router = Router();

  router.get("/api/edith/permissions/policy", requireOwnerSession, (_req, res) => {
    res.json({
      success: true,
      policy: policyPayload(),
    });
  });

  router.patch("/api/edith/permissions/policy", ...requireProtectedMutation, (req, res) => {
    try {
      const actor = ownerActor(req);
      permissionService.updatePolicy({
        mode: req.body?.mode,
        updatedBy: actor,
      });
      appendSecurityAudit(req, {
        action: "permission.policy.update",
        actor,
        authorization: "allowed",
        result: "success",
        message: "Permission policy updated by authenticated owner.",
        riskLevel: 4,
      });
      res.json({
        success: true,
        policy: policyPayload(),
      });
    } catch (error) {
      res.status(400).json({ success: false, error: redactSensitiveText(error instanceof Error ? error.message : error) });
    }
  });

  router.get("/api/edith/permissions/grants", requireOwnerSession, (req, res) => {
    res.json({
      success: true,
      grants: permissionService.listGrants({
        includeExpired: req.query.includeExpired === "true",
        includeRevoked: req.query.includeRevoked === "true",
      }),
    });
  });

  router.post("/api/edith/permissions/grants", ...requireProtectedMutation, (req, res) => {
    try {
      const actor = ownerActor(req);
      const grant = permissionService.createGrant({
        actor,
        permissions: Array.isArray(req.body?.permissions) ? req.body.permissions.map(String) : [],
        toolIds: Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : undefined,
        reason: String(req.body?.reason ?? ""),
        grantedBy: actor,
        ttlMs: Number(req.body?.ttlMs ?? undefined),
      });
      appendSecurityAudit(req, {
        action: "permission.grant.create",
        actor,
        authorization: "allowed",
        result: "success",
        message: "Scoped permission grant created by authenticated owner.",
        riskLevel: 4,
      });
      res.json({ success: true, grant });
    } catch (error) {
      res.status(400).json({ success: false, error: redactSensitiveText(error instanceof Error ? error.message : error) });
    }
  });

  router.delete("/api/edith/permissions/grants/:id", ...requireProtectedMutation, (req, res) => {
    const actor = ownerActor(req);
    const grant = permissionService.revokeGrant(req.params.id, actor);
    if (grant) {
      appendSecurityAudit(req, {
        action: "permission.grant.revoke",
        actor,
        authorization: "allowed",
        result: "success",
        message: "Permission grant revoked by authenticated owner.",
        riskLevel: 4,
      });
    }
    res.status(grant ? 200 : 404).json({ success: Boolean(grant), grant });
  });

  return router;
}
