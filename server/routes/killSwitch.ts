import { Router } from "express";
import { killSwitchService } from "../../src/edith/killSwitch";

export function createKillSwitchRouter(): Router {
  const router = Router();

  router.get("/api/edith/kill-switch", (_req, res) => {
    res.json({
      success: true,
      state: killSwitchService.status(),
    });
  });

  router.post("/api/edith/kill-switch/activate", (req, res) => {
    const reason = String(req.body?.reason ?? "").trim();
    res.json({
      success: true,
      state: killSwitchService.activate(reason || "Manual emergency stop from EDITH API.", "edith-dashboard"),
    });
  });

  router.post("/api/edith/kill-switch/deactivate", (_req, res) => {
    res.json({
      success: true,
      state: killSwitchService.deactivate("edith-dashboard"),
    });
  });

  return router;
}
