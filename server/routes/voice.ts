import { Router } from "express";
import { voiceSessionManager } from "../voice/voiceSessionManager";

export function createVoiceRouter(): Router {
  const router = Router();

  router.get("/api/voice/live/status", (_req, res) => {
    res.json(voiceSessionManager.status());
  });

  return router;
}
