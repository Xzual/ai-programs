import { Router } from "express";
import type { Response } from "express";
import { cryptoService } from "../../src/edith/cryptoService";

export function createCryptoRouter(): Router {
  const router = Router();

  async function sendCryptoStatus(res: Response) {
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
  }

  async function startCryptoService(res: Response, reason: string) {
    try {
      res.json({
        success: true,
        status: await cryptoService.start(reason),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function startCryptoObserver(res: Response, reason: string) {
    try {
      res.json({
        success: true,
        status: await cryptoService.startObserver(reason),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function stopCryptoObserver(res: Response, reason: string) {
    try {
      res.json({
        success: true,
        status: await cryptoService.stopObserver(reason),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function stopCryptoService(res: Response, reason: string) {
    try {
      res.json({
        success: true,
        status: cryptoService.stop(reason),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  router.get("/api/edith/crypto/status", async (_req, res) => {
    await sendCryptoStatus(res);
  });

  router.get("/api/crypto/status", async (_req, res) => {
    await sendCryptoStatus(res);
  });

  router.get("/api/crypto/health", async (_req, res) => {
    await sendCryptoStatus(res);
  });

  router.post("/api/edith/crypto/start", async (_req, res) => {
    await startCryptoObserver(res, "Manual observer start from EDITH Crypto view");
  });

  router.post("/api/crypto/start-observer", async (_req, res) => {
    await startCryptoObserver(res, "Manual observer start from EDITH Crypto API");
  });

  router.post("/api/edith/crypto/stop", async (_req, res) => {
    await stopCryptoObserver(res, "Manual observer stop from EDITH Crypto view");
  });

  router.post("/api/crypto/stop-observer", async (_req, res) => {
    await stopCryptoObserver(res, "Manual observer stop from EDITH Crypto API");
  });

  router.post("/api/edith/crypto/start-service", async (_req, res) => {
    await startCryptoService(res, "Manual service start from EDITH Crypto view");
  });

  router.post("/api/crypto/start-service", async (_req, res) => {
    await startCryptoService(res, "Manual service start from EDITH Crypto API");
  });

  router.post("/api/edith/crypto/stop-service", (_req, res) => {
    stopCryptoService(res, "Manual service stop from EDITH Crypto view");
  });

  router.post("/api/crypto/stop-service", (_req, res) => {
    stopCryptoService(res, "Manual service stop from EDITH Crypto API");
  });

  return router;
}
