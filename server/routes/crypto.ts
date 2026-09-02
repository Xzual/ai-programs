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
        status: await cryptoService.startObserver("Manual observer start from EDITH Crypto view"),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/api/edith/crypto/stop", async (_req, res) => {
    try {
      res.json({
        success: true,
        status: await cryptoService.stopObserver("Manual observer stop from EDITH Crypto view"),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/api/edith/crypto/start-service", async (_req, res) => {
    try {
      res.json({
        success: true,
        status: await cryptoService.start("Manual service start from EDITH Crypto view"),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/api/edith/crypto/stop-service", (_req, res) => {
    try {
      res.json({
        success: true,
        status: cryptoService.stop("Manual service stop from EDITH Crypto view"),
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
