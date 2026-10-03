import React from 'react';
import { BookOpenCheck, FolderOpen, LockKeyhole, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import type { ObsidianProviderPublicStatusV1 } from '../../edith/contracts';
import {
  fetchObsidianProviderStatus,
  isObsidianProviderReady,
  obsidianProviderErrorMessage,
  requestObsidianProviderSelection,
  revokeObsidianProvider,
  type ObsidianProviderAction,
} from '../../edith/obsidianProviderClient';

type PendingAction = ObsidianProviderAction | 'revoke' | 'refresh';
type Notice = 'cancelled' | 'submitted' | 'configuration_required' | 'revoked';

const reasonCopy: Record<ObsidianProviderPublicStatusV1['reasonCode'], string> = {
  VAULT_SELECTION_REQUIRED: 'Choose an existing Obsidian folder to enable the knowledge provider.',
  VAULT_SELECTION_REVOKED: 'The previous folder authorization was revoked. Select again only when you are ready.',
  VAULT_UNAVAILABLE: 'The configured vault is unavailable. Other E.D.I.T.H. services remain available.',
  VAULT_READY: 'The selected vault is available to the knowledge provider.',
  TEST_SANDBOX_REQUIRED: 'A test-only sandbox is required by the current runtime.',
  TEST_SANDBOX_READY: 'The test-only sandbox provider is ready.',
  CONFIG_INVALID: 'The saved provider configuration is invalid and is not being used.',
};

const noticeCopy: Record<Notice, string> = {
  cancelled: 'Folder selection cancelled. No Obsidian configuration changed.',
  submitted: 'Native selection submitted. Provider status was checked again.',
  configuration_required: 'Native verification is unavailable. Obsidian remains unconnected.',
  revoked: 'Obsidian folder authorization revoked. Provider status was checked again.',
};

export function ObsidianProviderPanel() {
  const [status, setStatus] = React.useState<ObsidianProviderPublicStatusV1>();
  const [pending, setPending] = React.useState<PendingAction>();
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState<Notice>();
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    setPending('refresh');
    setError('');
    try {
      setStatus(await fetchObsidianProviderStatus(signal));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(obsidianProviderErrorMessage(cause));
    } finally {
      setPending((current) => current === 'refresh' ? undefined : current);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  React.useEffect(() => {
    if (confirmRevoke) confirmRef.current?.focus();
  }, [confirmRevoke]);

  const selectFolder = async (action: ObsidianProviderAction) => {
    if (pending) return;
    setPending(action);
    setError('');
    setNotice(undefined);
    setConfirmRevoke(false);
    try {
      const result = await requestObsidianProviderSelection(action);
      setStatus(result.status);
      if (result.result !== 'already_ready') setNotice(result.result);
    } catch (cause) {
      setError(obsidianProviderErrorMessage(cause));
    } finally {
      setPending(undefined);
    }
  };

  const revoke = async () => {
    if (pending) return;
    setPending('revoke');
    setError('');
    setNotice(undefined);
    try {
      setStatus(await revokeObsidianProvider());
      setNotice('revoked');
      setConfirmRevoke(false);
    } catch (cause) {
      setError(obsidianProviderErrorMessage(cause));
    } finally {
      setPending(undefined);
    }
  };

  const ready = isObsidianProviderReady(status);
  const firstRun = status?.state === 'FIRST_RUN_REQUIRED';
  const degraded = status?.state === 'DEGRADED' || (status?.state === 'READY' && !status.writable);
  const stateLabel = ready ? 'READY' : status?.state ?? (pending === 'refresh' ? 'CHECKING' : 'UNAVAILABLE');

  return (
    <section className="rounded-lg border border-cyan-300/15 bg-slate-950/45 p-4" aria-labelledby="obsidian-provider-title" data-testid="obsidian-provider-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-cyan-300">
            <BookOpenCheck className="h-4 w-4" />
            <h3 id="obsidian-provider-title" className="text-sm font-semibold text-white">Obsidian knowledge provider</h3>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">Knowledge-only access. No execution authority, autonomous sync, or background picker.</p>
        </div>
        <span className={`rounded border px-2 py-1 font-mono text-[10px] font-semibold ${ready ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : degraded ? 'border-amber-300/30 bg-amber-300/10 text-amber-100' : 'border-slate-400/20 bg-slate-400/8 text-slate-300'}`}>
          {stateLabel}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <ProviderFact label="Reason" value={status?.reasonCode ?? 'STATUS_UNAVAILABLE'} />
        <ProviderFact label="Configured" value={status?.configured ? 'yes' : 'no'} />
        <ProviderFact label="Available" value={status?.available ? 'yes' : 'no'} />
        <ProviderFact label="Writable" value={status?.writable ? 'yes' : 'no'} />
        <ProviderFact label="Authority" value="knowledge only" />
      </div>

      <div className="mt-3 rounded-md border border-white/10 bg-white/[0.025] p-3 text-xs leading-5 text-slate-400" aria-live="polite">
        {status?.state === 'READY' && !status.writable
          ? 'The provider reported READY without write access. E.D.I.T.H. keeps this connection unavailable until a writable status is verified.'
          : status ? reasonCopy[status.reasonCode] : error || 'Reading protected provider status.'}
      </div>
      {notice && <p className="mt-2 text-xs text-cyan-200" role="status">{noticeCopy[notice]}</p>}
      {error && status && <p className="mt-2 text-xs text-amber-200" role="alert">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {firstRun && (
          <button type="button" onClick={() => void selectFolder('activate')} disabled={Boolean(pending)} className="inline-flex items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/60 disabled:opacity-50">
            <FolderOpen className="h-3.5 w-3.5" /> Obsidian klasörü seç
          </button>
        )}
        {(ready || degraded) && (
          <button type="button" onClick={() => void selectFolder('change')} disabled={Boolean(pending)} className="inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/[0.06] px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/50 disabled:opacity-50">
            <FolderOpen className="h-3.5 w-3.5" /> Obsidian klasörünü değiştir
          </button>
        )}
        <button type="button" onClick={() => void refresh()} disabled={Boolean(pending)} className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-white/20 disabled:opacity-50" aria-label="Obsidian provider durumunu yenile">
          <RefreshCw className={`h-3.5 w-3.5 ${pending === 'refresh' ? 'animate-spin motion-reduce:animate-none' : ''}`} /> Refresh status
        </button>
        {(ready || degraded) && !confirmRevoke && (
          <button type="button" onClick={() => setConfirmRevoke(true)} disabled={Boolean(pending)} className="inline-flex items-center gap-2 rounded-md border border-red-300/20 bg-red-300/[0.04] px-3 py-2 text-xs font-semibold text-red-200 transition hover:border-red-300/40 disabled:opacity-50">
            <Unplug className="h-3.5 w-3.5" /> Revoke access
          </button>
        )}
      </div>

      {confirmRevoke && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-red-300/20 bg-red-300/[0.05] p-3" role="group" aria-label="Confirm Obsidian access revocation">
          <LockKeyhole className="h-4 w-4 text-red-200" />
          <p className="min-w-[12rem] flex-1 text-xs text-red-100">Revoke this local folder authorization? No folder path is displayed or retained by this UI.</p>
          <button ref={confirmRef} type="button" onClick={() => void revoke()} disabled={Boolean(pending)} className="rounded-md border border-red-300/35 bg-red-300/10 px-3 py-2 text-xs font-semibold text-red-100 disabled:opacity-50">Confirm revoke</button>
          <button type="button" onClick={() => setConfirmRevoke(false)} disabled={Boolean(pending)} className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 disabled:opacity-50">Cancel</button>
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 border-t border-white/10 pt-3 text-[11px] leading-5 text-slate-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
        Folder paths, native handles, selection IDs, device IDs, and credentials are never shown or stored by this screen.
      </div>
    </section>
  );
}

function ProviderFact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-md border border-white/10 bg-slate-950/45 p-2.5"><div className="font-mono text-[9px] uppercase text-slate-500">{label}</div><div className="mt-1 break-words text-xs text-slate-200">{value}</div></div>;
}
