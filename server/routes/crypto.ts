import { Router } from "express";
import { cryptoService } from "../../src/edith/cryptoService";

export function createCryptoRouter(): Router {
  const router = Router();

  router.get("/api/edith/crypto/status", async (_req, res) => {
    try {
      res.json({
        success: true,
        status: await cryptoService.status(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/api/edith/crypto/start", async (_req, res) => {
    try {
      res.json({
        success: true,
        status: await cryptoService.start("Manual start from EDITH Crypto view"),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/api/edith/crypto/stop", (_req, res) => {
    try {
      res.json({
        success: true,
        status: cryptoService.stop("Manual stop from EDITH Crypto view"),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
