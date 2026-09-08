import { Router } from "express";
import { cryptoService } from "../../src/edith/cryptoService";
import { interactionSafetyService } from "../../src/edith/interactionSafetyService";
import { killSwitchService } from "../../src/edith/killSwitch";
import { obsidianVaultService } from "../../src/edith/obsidianVaultService";
import { permissionService } from "../../src/edith/permissionService";
import { providerRegistry } from "../providers/registry";

function providerMap(providers: Awaited<ReturnType<typeof providerRegistry.health>>) {
  return Object.fromEntries(providers.map((provider) => [provider.id, provider]));
}

function cryptoStatusLabel(status: Awaited<ReturnType<typeof cryptoService.status>>): "online" | "starting" | "offline" | "error" {
  if (status.healthy) return "online";
  if (status.managedProcessRunning) return "starting";
  if (status.error) return "offline";
  return "offline";
}

function cryptoHealthValue(status: Awaited<ReturnType<typeof cryptoService.status>>, key: string): unknown {
  return status.health && typeof status.health === "object"
    ? (status.health as Record<string, unknown>)[key]
    : undefined;
}

function cryptoRuntimeValue(status: Awaited<ReturnType<typeof cryptoService.status>>, key: string): unknown {
  const runtime = status.runtime ?? cryptoHealthValue(status, "runtime");
  return runtime && typeof runtime === "object"
    ? (runtime as Record<string, unknown>)[key]
    : undefined;
}

export function createStatusRouter(): Router {
  const router = Router();

  router.get("/api/status", async (_req, res) => {
    const timestamp = new Date().toISOString();
    const port = Number(process.env.PORT ?? 3000);
    const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";

    const [providersResult, cryptoResult] = await Promise.allSettled([
      providerRegistry.health({ ollamaUrl: ollamaHost, timeoutMs: 2500 }),
      cryptoService.status(),
    ]);

    const providers = providersResult.status === "fulfilled" ? providersResult.value : [];
    const providersById = providerMap(providers);
    const crypto = cryptoResult.status === "fulfilled" ? cryptoResult.value : undefined;
    const obsidian = obsidianVaultService.status();
    const killSwitch = killSwitchService.status();
    const safety = interactionSafetyService.snapshot();

    res.json({
      ok: true,
      data: {
        backend: {
          status: "online",
          port,
        },
        frontend: {
          status: process.env.NODE_ENV === "production" ? "static" : "vite_middleware",
        },
        providers: {
          status: providers.some((provider) => provider.available) ? "available" : "degraded",
          ollama: providersById.ollama,
          gemini: providersById.gemini,
          mock: providersById.mock,
        },
        ollama: {
          status: providersById.ollama?.status ?? "unknown",
          host: ollamaHost,
          models: providersById.ollama?.models ?? [],
        },
        crypto: {
          status: crypto ? cryptoStatusLabel(crypto) : "error",
          serviceUrl: crypto?.dashboardUrl ?? process.env.EDITH_CRYPTO_SERVICE_URL ?? process.env.EDITH_CRYPTO_DASHBOARD_URL ?? "http://localhost:5000",
          mode: "OBSERVER_ONLY",
          tradingEnabled: crypto ? Boolean(cryptoHealthValue(crypto, "tradingEnabled")) : false,
          paperTradingEnabled: crypto ? Boolean(cryptoHealthValue(crypto, "paperTradingEnabled")) : false,
          liveTradingEnabled: crypto ? Boolean(cryptoHealthValue(crypto, "liveTradingEnabled")) : false,
          observerRunning: crypto ? Boolean(cryptoHealthValue(crypto, "observerRunning") ?? cryptoRuntimeValue(crypto, "observerRunning")) : false,
          managedProcessRunning: Boolean(crypto?.managedProcessRunning),
          autostart: Boolean(crypto?.autoStartEnabled),
          error: crypto?.error,
        },
        obsidian: {
          status: obsidian.connectionStatus,
          vaultPath: obsidian.settings.vaultPath,
          vaultPathConfigured: obsidian.vaultPathConfigured,
          readable: obsidian.readable,
          writable: obsidian.writable,
          lastSyncAt: obsidian.lastSyncAt,
        },
        safety: {
          killSwitch: killSwitch.active ? "active" : "ready",
          highRiskActions: permissionService.highRiskEnabled() ? "allowed_by_policy" : "blocked",
          computer: safety.computer.runtimeBound ? safety.computer.mode : "read_only",
          browser: safety.browser.mode,
          interactionMode: safety.defaultRule,
        },
      },
      meta: {
        service: "edith-status",
        timestamp,
      },
    });
  });

  return router;
}
