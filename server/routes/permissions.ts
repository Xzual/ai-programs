import { Router } from "express";
import { DEFAULT_LOCAL_PERMISSIONS, HIGH_RISK_PERMISSIONS, permissionService } from "../../src/edith/permissionService";

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

  router.get("/api/edith/permissions/policy", (_req, res) => {
    res.json({
      success: true,
      policy: policyPayload(),
    });
  });

  router.patch("/api/edith/permissions/policy", (req, res) => {
    try {
      permissionService.updatePolicy({
        mode: req.body?.mode,
        updatedBy: "edith-dashboard",
      });
      res.json({
        success: true,
        policy: policyPayload(),
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/api/edith/permissions/grants", (req, res) => {
    res.json({
      success: true,
      grants: permissionService.listGrants({
        includeExpired: req.query.includeExpired === "true",
        includeRevoked: req.query.includeRevoked === "true",
      }),
    });
  });

  router.post("/api/edith/permissions/grants", (req, res) => {
    try {
      const grant = permissionService.createGrant({
        actor: typeof req.body?.actor === "string" ? req.body.actor : undefined,
        permissions: Array.isArray(req.body?.permissions) ? req.body.permissions.map(String) : [],
        toolIds: Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : undefined,
        reason: String(req.body?.reason ?? ""),
        grantedBy: "edith-dashboard",
        ttlMs: Number(req.body?.ttlMs ?? undefined),
      });
      res.json({ success: true, grant });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete("/api/edith/permissions/grants/:id", (req, res) => {
    const grant = permissionService.revokeGrant(req.params.id, "edith-dashboard");
    res.status(grant ? 200 : 404).json({ success: Boolean(grant), grant });
  });

  return router;
}
