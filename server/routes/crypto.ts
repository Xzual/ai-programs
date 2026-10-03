import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { cryptoService } from "../../src/edith/cryptoService";
import { binanceSpotService, BinanceSpotError } from "../crypto/binanceSpotService";
import { appendSecurityAudit } from "../security/auditLog";
import { requireOwnerSession, requireProtectedMutation, requireSameOrigin } from "../security/ownerSession";

const resourceId = /^[a-zA-Z0-9_-]{1,160}$/;
const operationIdentity = /^[A-Za-z0-9_-]{8,128}$/;
const errorCodes = new Set([
  "duplicate_request", "operation_in_progress", "stale_market_data", "market_unavailable",
  "insufficient_balance", "position_not_found", "risk_rejected", "invalid_decision_output",
  "jev_unavailable", "jev_timeout", "trade_execution_failed", "portfolio_locked",
  "reset_not_allowed", "invalid_request", "operation_not_found", "trade_not_found",
  "decision_not_found", "session_not_found", "not_found", "idempotency_conflict", "operation_expired",
  "resource_missing", "runtime_missing", "dependency_missing", "service_unavailable",
]);

function canonicalError(body: Record<string, any>) {
  const object = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
  return body.ok === false && object(body.data) && object(body.meta) && object(body.error) &&
    typeof body.meta.requestId === "string" && typeof body.meta.timestamp === "string" &&
    errorCodes.has(body.errorCode) && body.error.code === body.errorCode &&
    typeof body.error.message === "string" && body.error.message.length > 0 && body.safeMessage === body.error.message;
}

function sendSafeError(res: Response, status: number, code: string, clientRequestId?: string, requestId = randomUUID()) {
  const message = clientRequestId
    ? "İşlem sonucu doğrulanamadı. Aynı istek kimliğiyle durumunu kontrol edin."
    : "Crypto isteği tamamlanamadı. Durumu kontrol edin.";
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Request-Id", requestId);
  res.status(status).json({
    ok: false, success: false, error: { code, message }, errorCode: code, safeMessage: message,
    ...(clientRequestId ? { clientRequestId } : {}),
    meta: { requestId, timestamp: new Date().toISOString() },
    ...(clientRequestId ? { recovery: { required: true, clientRequestId, path: `/api/crypto/operations/${clientRequestId}` } } : {}),
  });
}

function sendBinanceError(req: Request, res: Response, error: unknown, action: string) {
  const known = error instanceof BinanceSpotError;
  const code = known ? error.code : "binance_request_failed";
  appendSecurityAudit(req, {
    action, authorization: "allowed", result: "error", riskLevel: 4,
    message: `Binance Spot request failed: ${code}`,
  });
  res.setHeader("Cache-Control", "no-store");
  res.status(known ? error.status : 503).json({
    ok: false, success: false, errorCode: code,
    safeMessage: known ? error.message : "Binance Spot request could not be verified.",
  });
}

const secretField = /^(?:api[_-]?key|jev[_-]?api[_-]?key|authorization|cookie|set-cookie|secret|token)$/i;

function redactBackendSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBackendSecrets);
  if (typeof value === "string") {
    const jevKey = process.env.JEV_API_KEY?.trim();
    return jevKey && value.includes(jevKey) ? "[REDACTED]" : value;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !secretField.test(key))
    .map(([key, nested]) => [key, redactBackendSecrets(nested)]));
}

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
    "/api/decisions",
    "/api/markets",
    "/api/analysis",
    "/api/observations",
    "/api/learning-notes",
    "/api/obsidian-status",
    "/api/crypto/portfolio",
    "/api/crypto/market",
    "/api/crypto/symbols",
    "/api/crypto/positions",
    "/api/crypto/trades",
    "/api/crypto/session",
    "/api/crypto/sessions",
    "/api/crypto/decisions",
    "/api/crypto/decisions/latest",
    "/api/crypto/decision/latest",
    "/api/crypto/jev/status",
    "/api/crypto/jev/loop",
    "/api/crypto/demo-loop",
  ];

  async function fetchDashboard(path: string, init?: RequestInit, timeoutMs = 3500) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init?.headers);
      if (init?.method && !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())) {
        for (const [name, value] of Object.entries(cryptoService.internalRequestHeaders())) headers.set(name, value);
      }
      const response = await fetch(`${dashboardUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
        redirect: "error",
      });
      // The deadline includes the entire body, including a stalled stream after headers.
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_RESPONSE");
      return { status: response.status, ok: response.ok, body: body as Record<string, any> };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function sendCryptoStatus(res: Response) {
    try {
      res.json({
        success: true,
        status: redactBackendSecrets(await cryptoService.status()),
      });
    } catch {
      sendSafeError(res, 503, "crypto_response_unconfirmed");
    }
  }

  async function startCryptoService(res: Response, reason: string) {
    try {
      const status = await cryptoService.start(reason);
      if (!status.healthy) {
        const code = status.errorCode && errorCodes.has(status.errorCode)
          ? status.errorCode
          : "service_unavailable";
        sendSafeError(res, 503, code);
        return;
      }
      res.json({ success: true, status: redactBackendSecrets(status) });
    } catch {
      sendSafeError(res, 503, "crypto_response_unconfirmed");
    }
  }

  async function startCryptoObserver(res: Response, reason: string) {
    try {
      res.json({
        success: true,
        status: redactBackendSecrets(await cryptoService.startObserver(reason)),
      });
    } catch {
      sendSafeError(res, 503, "crypto_response_unconfirmed");
    }
  }

  async function stopCryptoObserver(res: Response, reason: string) {
    try {
      res.json({
        success: true,
        status: redactBackendSecrets(await cryptoService.stopObserver(reason)),
      });
    } catch {
      sendSafeError(res, 503, "crypto_response_unconfirmed");
    }
  }

  function stopCryptoService(res: Response, reason: string) {
    try {
      res.json({
        success: true,
        status: redactBackendSecrets(cryptoService.stop(reason)),
      });
    } catch {
      sendSafeError(res, 503, "crypto_response_unconfirmed");
    }
  }

  async function proxyDashboardJson(res: Response, path: string, init?: RequestInit, timeoutMs?: number, clientRequestId?: string) {
    const requestId = randomUUID();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Request-Id", requestId);
    try {
      const response = await fetchDashboard(path, init, timeoutMs);
      if (!response.ok || response.body.ok === false || response.body.success === false ||
          (response.body.error != null && response.body.ok !== true && response.body.success !== true)) {
        if (canonicalError(response.body)) {
          res.status(response.status).json(redactBackendSecrets(response.body));
          return;
        }
        const rawCode = response.body.errorCode ?? response.body.error?.code ?? response.body.error;
        const normalizedCode = typeof rawCode === "string" ? rawCode.toLowerCase() : "";
        const code = errorCodes.has(normalizedCode) ? normalizedCode : "crypto_response_unconfirmed";
        sendSafeError(res, response.ok ? 502 : response.status, code, clientRequestId, requestId);
        return;
      }
      res.status(response.status).json(redactBackendSecrets(response.body));
    } catch {
      sendSafeError(res, 503, "crypto_response_unconfirmed", clientRequestId, requestId);
    }
  }

  router.get("/api/edith/crypto/status", async (_req, res) => {
    await sendCryptoStatus(res);
  });

  router.get("/api/crypto/status", async (_req, res) => {
    await proxyDashboardJson(res, "/api/crypto/status");
  });

  router.get("/api/crypto/health", async (_req, res) => {
    await sendCryptoStatus(res);
  });

  for (const path of safeReadOnlyDashboardPaths) {
    router.get(path, async (req, res) => {
      const query = new URL(req.originalUrl, "http://localhost").search;
      await proxyDashboardJson(res, `${path}${query}`, undefined, path === "/api/crypto/market" ? 15000 : 5000);
    });
  }

  for (const collection of ["trades", "decisions", "operations"]) {
    router.get(`/api/crypto/${collection}/:id`, async (req, res) => {
      const id = req.params.id;
      if (!(collection === "operations" ? operationIdentity : resourceId).test(id)) {
        sendSafeError(res, 400, "invalid_request");
        return;
      }
      const query = new URL(req.originalUrl, "http://localhost").search;
      await proxyDashboardJson(res, `/api/crypto/${collection}/${encodeURIComponent(id)}${query}`, undefined, 5000, collection === "operations" ? id : undefined);
    });
  }

  const idempotentPaths = new Set([
    "/api/crypto/decision/run", "/api/crypto/demo/buy", "/api/crypto/demo/sell",
    "/api/crypto/demo/hold", "/api/crypto/demo/reset",
  ]);
  const safeDashboardPostPaths = [
    "/api/crypto/decision/run",
    "/api/crypto/demo/buy",
    "/api/crypto/demo/sell",
    "/api/crypto/demo/hold",
    "/api/crypto/demo/reset",
    "/api/crypto/jev/loop/start",
    "/api/crypto/jev/loop/stop",
    "/api/crypto/demo-loop",
  ];

  for (const path of safeDashboardPostPaths) {
    router.post(path, ...requireProtectedMutation, async (req, res) => {
      const primaryId = req.body?.clientRequestId;
      const aliasId = req.body?.idempotencyKey;
      const clientRequestId = primaryId !== undefined ? primaryId : aliasId;
      if (idempotentPaths.has(path) && (typeof clientRequestId !== "string" || !operationIdentity.test(clientRequestId) ||
          (primaryId !== undefined && aliasId !== undefined && primaryId !== aliasId))) {
        sendSafeError(res, 400, "invalid_request");
        return;
      }
      await proxyDashboardJson(res, path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body ?? {}),
      }, path === "/api/crypto/decision/run" ? 15000 : 10000, idempotentPaths.has(path) ? clientRequestId : undefined);
    });
  }

  router.post("/api/edith/crypto/obsidian-export-test", ...requireProtectedMutation, async (_req, res) => {
    await proxyDashboardJson(res, "/api/obsidian-export-test", { method: "POST" });
  });

  router.post("/api/crypto/obsidian-export-test", ...requireProtectedMutation, async (_req, res) => {
    await proxyDashboardJson(res, "/api/obsidian-export-test", { method: "POST" });
  });

  router.post("/api/edith/crypto/start", ...requireProtectedMutation, async (_req, res) => {
    await startCryptoObserver(res, "Manual observer start from EDITH Crypto view");
  });

  router.post("/api/crypto/start-observer", ...requireProtectedMutation, async (_req, res) => {
    await startCryptoObserver(res, "Manual observer start from EDITH Crypto API");
  });

  router.post("/api/edith/crypto/stop", ...requireProtectedMutation, async (_req, res) => {
    await stopCryptoObserver(res, "Manual observer stop from EDITH Crypto view");
  });

  router.post("/api/crypto/stop-observer", ...requireProtectedMutation, async (_req, res) => {
    await stopCryptoObserver(res, "Manual observer stop from EDITH Crypto API");
  });

  router.post("/api/edith/crypto/start-service", ...requireProtectedMutation, async (_req, res) => {
    await startCryptoService(res, "Manual service start from EDITH Crypto view");
  });

  router.post("/api/crypto/start-service", ...requireProtectedMutation, async (_req, res) => {
    await startCryptoService(res, "Manual service start from EDITH Crypto API");
  });

  router.post("/api/edith/crypto/stop-service", ...requireProtectedMutation, (_req, res) => {
    stopCryptoService(res, "Manual service stop from EDITH Crypto view");
  });

  router.post("/api/crypto/stop-service", ...requireProtectedMutation, (_req, res) => {
    stopCryptoService(res, "Manual service stop from EDITH Crypto API");
  });

  router.get("/api/crypto/binance/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, status: binanceSpotService.status() });
  });

  router.get("/api/crypto/binance/markets", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, markets: await binanceSpotService.markets() });
    } catch (error) { sendBinanceError(req, res, error, "crypto.binance.markets"); }
  });

  router.get("/api/crypto/binance/account", requireOwnerSession, requireSameOrigin, async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, account: await binanceSpotService.account() });
    } catch (error) { sendBinanceError(req, res, error, "crypto.binance.account"); }
  });

  router.get("/api/crypto/binance/proposals/latest", requireOwnerSession, requireSameOrigin, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, proposal: binanceSpotService.latestProposal() ?? null });
  });

  router.post("/api/crypto/binance/proposals", ...requireProtectedMutation, async (req, res) => {
    try {
      const proposal = await binanceSpotService.createProposal(req.body ?? {});
      appendSecurityAudit(req, {
        action: "crypto.binance.proposal_created", authorization: "allowed", result: "success", riskLevel: 4,
        message: `Spot LIMIT proposal created for ${proposal.symbol}; no order submitted.`,
      });
      res.status(201).json({ ok: true, proposal });
    } catch (error) { sendBinanceError(req, res, error, "crypto.binance.proposal_create"); }
  });

  router.post("/api/crypto/binance/proposals/:id/approve", ...requireProtectedMutation, async (req, res) => {
    try {
      const proposal = await binanceSpotService.approve(req.params.id, String(req.body?.approvalPhrase || ""));
      appendSecurityAudit(req, {
        action: "crypto.binance.order_approved", authorization: "allowed",
        result: proposal.state === "UNKNOWN" ? "error" : "success", riskLevel: 4,
        message: `Owner-approved Spot LIMIT result for ${proposal.symbol}: ${proposal.state}.`,
      });
      res.status(proposal.state === "UNKNOWN" ? 202 : 200).json({ ok: true, proposal });
    } catch (error) { sendBinanceError(req, res, error, "crypto.binance.order_approve"); }
  });

  router.post("/api/crypto/binance/proposals/:id/reject", ...requireProtectedMutation, (req, res) => {
    try {
      const proposal = binanceSpotService.reject(req.params.id);
      appendSecurityAudit(req, {
        action: "crypto.binance.order_rejected", authorization: "allowed", result: "success", riskLevel: 4,
        message: `Spot LIMIT proposal rejected for ${proposal.symbol}.`,
      });
      res.json({ ok: true, proposal });
    } catch (error) { sendBinanceError(req, res, error, "crypto.binance.order_reject"); }
  });

  router.post("/api/crypto/binance/kill-switch", ...requireProtectedMutation, (req, res) => {
    try {
      if (typeof req.body?.active !== "boolean") throw new BinanceSpotError("invalid_request", "Kill switch active must be a boolean.");
      const status = binanceSpotService.setKillSwitch(req.body.active);
      appendSecurityAudit(req, {
        action: "crypto.binance.kill_switch", authorization: "allowed", result: "success", riskLevel: 4,
        message: `Binance Spot kill switch ${status.killSwitch ? "activated" : "deactivated"}.`,
      });
      res.json({ ok: true, status });
    } catch (error) { sendBinanceError(req, res, error, "crypto.binance.kill_switch"); }
  });

  return router;
}
