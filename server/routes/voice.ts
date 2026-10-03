import { Router } from "express";
import { voiceSessionManager } from "../voice/voiceSessionManager";
import { appendSecurityAudit } from "../security/auditLog";
import { requireOwnerSession, requireProtectedMutation, requireSameOrigin } from "../security/ownerSession";
import { CRYPTO_VOICE_COMMAND_EXAMPLES, cryptoVoiceCommandService, safeCryptoVoiceError } from "../voice/cryptoVoiceCommands";

export function createVoiceRouter(): Router {
  const router = Router();

  router.get("/api/voice/live/status", (_req, res) => {
    res.json(voiceSessionManager.status());
  });

  router.get("/api/voice/crypto/commands", requireOwnerSession, requireSameOrigin, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, commands: CRYPTO_VOICE_COMMAND_EXAMPLES, realOrderVoiceApprovalAllowed: false });
  });

  router.post("/api/voice/crypto/command", ...requireProtectedMutation, async (req, res) => {
    const transcript = typeof req.body?.transcript === "string" ? req.body.transcript.trim() : "";
    if (!transcript || transcript.length > 500) {
      res.status(400).json({ success: false, errorCode: "invalid_voice_command", safeMessage: "Crypto voice command must be between 1 and 500 characters." });
      return;
    }
    try {
      const result = await cryptoVoiceCommandService.execute(transcript);
      appendSecurityAudit(req, {
        action: `voice.crypto.${result.intent || "unmatched"}`,
        authorization: "allowed", result: "success", riskLevel: result.intent === "create_proposal" || result.intent === "kill_switch_on" ? 4 : 2,
        message: result.matched ? `Voice crypto command handled as ${result.intent}.` : "Voice transcript did not match a crypto command.",
      });
      res.json({ success: true, ...result });
    } catch (error) {
      appendSecurityAudit(req, {
        action: "voice.crypto.failed", authorization: "allowed", result: "error", riskLevel: 3,
        message: "Voice crypto command failed safely.",
      });
      res.status(error instanceof Error && "status" in error ? Number((error as any).status) || 503 : 503).json({ success: false, errorCode: (error as any)?.code || "voice_crypto_failed", safeMessage: safeCryptoVoiceError(error) });
    }
  });

  return router;
}
