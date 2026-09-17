import { Router } from "express";
import type { Response } from "express";
import { cryptoService } from "../../src/edith/cryptoService";

export function createCryptoRouter(): Router {
  const router = Router();
  const dashboardUrl = process.env.EDITH_CRYPTO_SERVICE_URL || process.env.EDITH_CRYPTO_DASHBOARD_URL || "http://localhost:5000";
  const safeReadOnlyDashboardPaths = [
    "/api/permissions",
    "/api/symbols",
    "/api/categories",
    "/api/watchlist",
    "/api/risk",
    "/api/mode",
    "/api/overview",
    "/api/trades",
    "/api/decisions",
    "/api/markets",
    "/api/analysis",
    "/api/observations",
    "/api/learning-notes",
    "/api/obsidian-status",
    "/api/crypto/portfolio",
    "/api/crypto/watchlist",
    "/api/crypto/news",
    "/api/crypto/trades",
    "/api/crypto/decisions",
    "/api/crypto/lessons",
    "/api/crypto/models",
    "/api/crypto/obsidian/status",
    "/api/crypto/demo-loop",
  ];

  async function fetchDashboard(path: string, init?: RequestInit, timeoutMs = 3500) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${dashboardUrl}${path}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

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

  async function proxyDashboardJson(res: Response, path: string, init?: RequestInit, timeoutMs?: number) {
    try {
      const response = await fetchDashboard(path, init, timeoutMs);
      const text = await response.text();
      res.status(response.status).type(response.headers.get("content-type") ?? "application/json").send(text);
    } catch (error) {
      res.status(503).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        serviceUrl: dashboardUrl,
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

  for (const path of safeReadOnlyDashboardPaths) {
    router.get(path, async (_req, res) => {
      await proxyDashboardJson(res, path);
    });
  }

  const safeDashboardPostPaths = [
    "/api/crypto/analyze",
    "/api/crypto/demo-trade",
    "/api/crypto/watchlist/update",
    "/api/crypto/model/select",
    "/api/crypto/demo-loop",
  ];

  for (const path of safeDashboardPostPaths) {
    router.post(path, async (req, res) => {
      await proxyDashboardJson(res, path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body ?? {}),
      }, path === "/api/crypto/analyze" ? 70000 : 10000);
    });
  }

  router.post("/api/edith/crypto/obsidian-export-test", async (_req, res) => {
    await proxyDashboardJson(res, "/api/obsidian-export-test", { method: "POST" });
  });

  router.post("/api/crypto/obsidian-export-test", async (_req, res) => {
    await proxyDashboardJson(res, "/api/obsidian-export-test", { method: "POST" });
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
