import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { appendSecurityAudit } from "./auditLog";

const SESSION_COOKIE = "edith_owner_session";
const CSRF_HEADER = "x-edith-csrf-token";
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map<string, StoredOwnerSession>();

interface StoredOwnerSession {
  sessionHash: string;
  actor: "owner";
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

export interface OwnerSessionContext {
  actor: "owner";
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

function ttlMs(): number {
  const configured = Number(process.env.EDITH_OWNER_SESSION_TTL_MS ?? DEFAULT_TTL_MS);
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 60_000), 24 * 60 * 60 * 1000) : DEFAULT_TTL_MS;
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieValue(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function requestOrigin(req: Request): string | undefined {
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : undefined;
}

function trustedOrigin(req: Request): boolean {
  const supplied = req.get("origin");
  const expected = requestOrigin(req);
  if (!supplied || !expected) return false;
  try {
    return new URL(supplied).origin.toLowerCase() === new URL(expected).origin.toLowerCase();
  } catch {
    return false;
  }
}

function readSession(req: Request): StoredOwnerSession | undefined {
  const raw = cookieValue(req);
  if (!raw) return undefined;
  const stored = sessions.get(hash(raw));
  if (!stored) return undefined;
  if (stored.expiresAt <= Date.now()) {
    sessions.delete(stored.sessionHash);
    return undefined;
  }
  return stored;
}

function reject(req: Request, res: Response, status: number, errorCode: string, safeMessage: string): void {
  appendSecurityAudit(req, {
    action: `security.${errorCode}`,
    authorization: "denied",
    result: "denied",
    message: safeMessage,
  });
  res.status(status).json({ success: false, errorCode, safeMessage });
}

function bearerToken(req: Request): string | undefined {
  const value = req.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim();
}

function setSessionCookie(req: Request, res: Response, sessionId: string, expiresAt: number): void {
  const secure = req.secure || process.env.EDITH_SECURE_COOKIES === "true";
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    expires: new Date(expiresAt),
  });
}

function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.secure || process.env.EDITH_SECURE_COOKIES === "true",
    path: "/",
  });
}

export function getOwnerSession(req: Request): OwnerSessionContext | undefined {
  const session = readSession(req);
  if (!session) return undefined;
  return {
    actor: session.actor,
    csrfToken: session.csrfToken,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
}

export function ownerActor(req: Request): "owner" {
  return getOwnerSession(req)?.actor ?? "owner";
}

export const requireOwnerSession: RequestHandler = (req, res, next) => {
  if (!readSession(req)) {
    reject(req, res, 401, "owner_session_required", "A valid owner session is required.");
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  next();
};

export const requireSameOrigin: RequestHandler = (req, res, next) => {
  if (!trustedOrigin(req)) {
    reject(req, res, 403, "same_origin_required", "A trusted same-origin request is required.");
    return;
  }
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    reject(req, res, 403, "cross_origin_request_denied", "Cross-origin requests are not allowed.");
    return;
  }
  next();
};

export const requireCsrf: RequestHandler = (req, res, next) => {
  const session = readSession(req);
  const supplied = req.get(CSRF_HEADER);
  if (!session || !supplied || !safeEqual(supplied, session.csrfToken)) {
    reject(req, res, 403, "csrf_token_invalid", "A valid CSRF token is required.");
    return;
  }
  next();
};

export const requireProtectedMutation: RequestHandler[] = [requireOwnerSession, requireSameOrigin, requireCsrf];

export function createOwnerSessionRouter(): Router {
  const router = Router();

  router.post("/api/security/session", requireSameOrigin, (req, res) => {
    const configured = process.env.EDITH_OWNER_TOKEN;
    const supplied = bearerToken(req);
    if (!configured) {
      reject(req, res, 503, "owner_authentication_not_configured", "Owner authentication is not configured.");
      return;
    }
    if (!supplied || !safeEqual(configured, supplied)) {
      reject(req, res, 401, "owner_authentication_failed", "Owner authentication failed.");
      return;
    }

    // Rotate every successful login so old browser sessions cannot be replayed.
    sessions.clear();
    const sessionId = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const stored: StoredOwnerSession = {
      sessionHash: hash(sessionId),
      actor: "owner",
      csrfToken: crypto.randomBytes(32).toString("base64url"),
      createdAt: now,
      expiresAt: now + ttlMs(),
    };
    sessions.set(stored.sessionHash, stored);
    setSessionCookie(req, res, sessionId, stored.expiresAt);
    appendSecurityAudit(req, {
      action: "security.owner_session_created",
      actor: stored.actor,
      authorization: "allowed",
      result: "success",
      message: "Owner session created.",
      riskLevel: 3,
    });
    res.status(201).json({
      success: true,
      session: {
        actor: stored.actor,
        csrfToken: stored.csrfToken,
        createdAt: new Date(stored.createdAt).toISOString(),
        expiresAt: new Date(stored.expiresAt).toISOString(),
      },
    });
  });

  router.get("/api/security/session", requireOwnerSession, (req, res) => {
    const session = getOwnerSession(req)!;
    res.json({
      success: true,
      session: {
        actor: session.actor,
        csrfToken: session.csrfToken,
        createdAt: new Date(session.createdAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
      },
    });
  });

  router.delete("/api/security/session", ...requireProtectedMutation, (req, res) => {
    const raw = cookieValue(req);
    if (raw) sessions.delete(hash(raw));
    clearSessionCookie(req, res);
    res.json({ success: true });
  });

  return router;
}

