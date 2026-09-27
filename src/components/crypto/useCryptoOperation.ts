import React from 'react';
import { api, CryptoApiError, cryptoData, record, UUID, type Json } from './cryptoApi';

export type CryptoAction = 'buy' | 'sell' | 'hold' | 'reset' | 'decision';
export type PendingOperation = { clientRequestId: string; action: CryptoAction; createdAt: string; body?: Json };
export const PENDING_OPERATION_KEY = 'edith.crypto.pendingOperation.v1';
const actions: CryptoAction[] = ['buy', 'sell', 'hold', 'reset', 'decision'];

function requestBody(action: CryptoAction, body: Json): Json {
  const fields: Record<CryptoAction, string[]> = {
    buy: ['symbol', 'quoteAmount', 'source'], sell: ['symbol', 'positionPercent', 'source'],
    hold: ['symbol', 'source'], reset: ['confirmation'], decision: ['symbol'],
  };
  const selected: Json = {};
  for (const key of fields[action]) {
    const value = body[key];
    if (key === 'source') {
      if (value !== undefined && value !== 'manual') throw new Error('INVALID_SOURCE');
      selected.source = 'manual';
    } else if (key === 'quoteAmount' || key === 'positionPercent') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('INVALID_AMOUNT');
      selected[key] = value;
    } else {
      if (typeof value !== 'string' || !value || value.length > 128) throw new Error('INVALID_FIELD');
      selected[key] = value;
    }
  }
  return selected;
}

function errorResult(result: Json) {
  return result.ok === false && record(result.error) &&
    typeof result.error.code === 'string' && result.error.code.length > 0 &&
    typeof result.error.message === 'string' && result.error.message.length > 0;
}

function vetoResult(result: Json) {
  return result.ok === true && result.status === 'rejected' && record(result.execution) &&
    result.execution.blocked === true && result.execution.executed === false &&
    record(result.decision) && result.decision.valid === true;
}

function matchesResult(result: Json, operation: PendingOperation, found?: Json) {
  if (result.clientRequestId != null && result.clientRequestId !== operation.clientRequestId) return false;
  return result.clientRequestId === operation.clientRequestId || result.meta?.requestId === operation.clientRequestId ||
    ['operationId', 'tradeId', 'decisionId'].some((key) =>
      typeof result[key] === 'string' && result[key].length > 0 && result[key] === found?.[key]);
}

function restore() {
  try {
    const saved = sessionStorage.getItem(PENDING_OPERATION_KEY);
    if (!saved) return { pending: null, storageError: null };
    const pending = JSON.parse(saved);
    if (!record(pending) || !UUID.test(pending.clientRequestId) || !actions.includes(pending.action) || typeof pending.createdAt !== 'string') throw new Error();
    // Older saved requests still support lookup, but cannot be reconstructed for resubmission.
    const body = pending.body === undefined ? undefined : record(pending.body) ? requestBody(pending.action, pending.body) : null;
    if (body === null) throw new Error();
    return { pending: { ...pending, body } as PendingOperation, storageError: null };
  } catch {
    return { pending: null, storageError: 'Bekleyen işlem kaydı okunamadı. İşlem güvenliği için kontroller kilitli.' };
  }
}

export function useCryptoOperation(onResolved: (result: Json) => void) {
  const [initial] = React.useState(restore);
  const [pending, setPending] = React.useState<PendingOperation | null>(initial.pending);
  const [storageError, setStorageError] = React.useState<string | null>(initial.storageError);
  const [checking, setChecking] = React.useState(false);
  const [posting, setPosting] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Json | null>(null);
  const pendingRef = React.useRef(pending);
  const checkingRef = React.useRef(false);
  const postingRef = React.useRef<string | null>(null);
  const notFoundRef = React.useRef(false);
  const mounted = React.useRef(true);
  const onResolvedRef = React.useRef(onResolved);
  onResolvedRef.current = onResolved;

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const finish = React.useCallback((operation: PendingOperation, status: string, result: Json) => {
    if (!mounted.current || pendingRef.current?.clientRequestId !== operation.clientRequestId) return;
    // Clearing storage is part of resolution: a reload must never silently lose an uncertain write.
    try { sessionStorage.removeItem(PENDING_OPERATION_KEY); } catch {
      setStorageError('İşlem doğrulandı ancak bekleyen kayıt güncellenemedi. Tekrar kontrol edin.');
      return;
    }
    const resolved = { ...result, clientRequestId: operation.clientRequestId, operationStatus: status, action: operation.action };
    pendingRef.current = null;
    if (postingRef.current === operation.clientRequestId) postingRef.current = null;
    notFoundRef.current = false;
    setPending(null);
    setPosting(false);
    setNotFound(false);
    setStorageError(null);
    setOutcome(resolved);
    onResolvedRef.current(resolved);
  }, []);

  const recheck = React.useCallback(async () => {
    const operation = pendingRef.current;
    if (!operation || checkingRef.current) return;
    checkingRef.current = true;
    notFoundRef.current = false;
    setNotFound(false);
    setChecking(true);
    try {
      const found = await api(`/api/crypto/operations/${encodeURIComponent(operation.clientRequestId)}`);
      if (found.ok !== true || found.clientRequestId !== operation.clientRequestId) return;
      if (!['completed', 'rejected', 'failed'].includes(found.status)) return;
      if (!record(found.result)) return;
      const result = cryptoData(found.result);
      if (!matchesResult(result, operation, found)) return;
      if (result.status != null && result.status !== found.status) return;
      if (found.status === 'completed' && (result.ok !== true || result.realOrderSent === true || result.status === 'pending')) return;
      if (found.status !== 'completed' && !errorResult(result) && !(found.status === 'rejected' && vetoResult(result))) return;
      finish(operation, found.status, {
        ...result,
        operationId: result.operationId ?? found.operationId,
        tradeId: result.tradeId ?? found.tradeId,
        decisionId: result.decisionId ?? found.decisionId,
      });
    } catch (error) {
      if (mounted.current && pendingRef.current?.clientRequestId === operation.clientRequestId &&
          error instanceof CryptoApiError && error.status === 404 &&
          (error.body.errorCode ?? error.body.error?.code) === 'operation_not_found' &&
          (error.body.clientRequestId == null || error.body.clientRequestId === operation.clientRequestId)) {
        notFoundRef.current = true;
        setNotFound(true);
      }
      // A missing record, transport error or timeout is not proof that the write failed.
    } finally {
      checkingRef.current = false;
      if (mounted.current) setChecking(false);
    }
  }, [finish]);

  React.useEffect(() => {
    if (!pending) return;
    void recheck();
    const timer = window.setInterval(() => void recheck(), 5000);
    return () => window.clearInterval(timer);
  }, [pending, recheck]);

  const send = async (operation: PendingOperation) => {
    if (!operation.body || postingRef.current) return;
    postingRef.current = operation.clientRequestId;
    notFoundRef.current = false;
    setPosting(true);
    setNotFound(false);
    try {
      const { action } = operation;
      const path = action === 'decision' ? '/api/crypto/decision/run' : `/api/crypto/demo/${action}`;
      const result = await api(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...operation.body, clientRequestId: operation.clientRequestId }),
      });
      if (result.ok === true && matchesResult(result, operation) &&
          typeof result.operationId === 'string' && result.operationId && result.realOrderSent !== true) {
        if (vetoResult(result)) finish(operation, 'rejected', result);
        else if (result.status === undefined || result.status === 'completed') finish(operation, 'completed', result);
      }
    } catch (error) {
      // Only a definitive, correlated input rejection can finish without an operation record.
      if (error instanceof CryptoApiError && error.status === 400 && errorResult(error.body) &&
          error.body.error.code === 'invalid_request' && (error.body.errorCode == null || error.body.errorCode === 'invalid_request') &&
          error.body.meta?.requestId === operation.clientRequestId && matchesResult(error.body, operation)) {
        finish(operation, 'rejected', error.body);
      }
    } finally {
      if (postingRef.current === operation.clientRequestId) {
        postingRef.current = null;
        if (mounted.current) setPosting(false);
      }
      if (mounted.current && pendingRef.current?.clientRequestId === operation.clientRequestId) void recheck();
    }
  };

  const submit = async (action: CryptoAction, body: Json) => {
    if (pendingRef.current || postingRef.current || storageError) return;
    let operation: PendingOperation;
    try {
      operation = { clientRequestId: crypto.randomUUID(), action, createdAt: new Date().toISOString(), body: requestBody(action, body) };
      sessionStorage.setItem(PENDING_OPERATION_KEY, JSON.stringify(operation));
    } catch {
      setStorageError('İşlem bilgisi saklanamadı. İstek gönderilmedi; girişleri ve oturum depolamasını kontrol edin.');
      return;
    }
    pendingRef.current = operation;
    setOutcome(null);
    setPending(operation);
    await send(operation);
  };

  const resend = async () => {
    const operation = pendingRef.current;
    if (!operation?.body || !notFoundRef.current || checkingRef.current || postingRef.current || storageError) return;
    try { sessionStorage.setItem(PENDING_OPERATION_KEY, JSON.stringify(operation)); } catch {
      setStorageError('İşlem bilgisi saklanamadı. Yeniden gönderim yapılmadı.');
      return;
    }
    // An explicit click is required; neither polling nor an error path calls this function.
    await send(operation);
  };

  return { pending, outcome, checking, posting, notFound, storageError, locked: Boolean(pending || storageError), submit, recheck, resend };
}
