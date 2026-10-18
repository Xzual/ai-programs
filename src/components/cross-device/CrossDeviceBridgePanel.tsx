import React from 'react';
import type { SharedResultCardV2 } from '../../edith/contracts';
import {
  Activity,
  Eye,
  FileCheck2,
  MonitorSmartphone,
  RadioTower,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Square,
  Trash2,
  WifiOff,
} from 'lucide-react';
import {
  CrossDeviceBridgeError,
  CrossDeviceDesktopBridge,
  type CrossDeviceBridgeSnapshot,
  type CrossDeviceCapabilityState,
  type CrossDeviceFrame,
  type ResultCardSourceReference,
} from '../../edith/crossDeviceDesktopBridge';

export interface ResearchSharedResultPanelProps {
  sourceReference: { type: 'research'; id: string };
  onOpenSource?: (id: string) => void;
}

export function researchCardPublicationScope(snapshot: CrossDeviceBridgeSnapshot | null, target: string, source: string, now = Date.now()): string {
  const device = snapshot?.devices.find(row => row.deviceId === target);
  if (!source || !target || !snapshot?.ownerAuthorized || snapshot.killSwitchActive !== false || snapshot.capabilities.resultCards !== 'available' || !device || device.trustStatus !== 'trusted' || !device.ownerSessionBindingId || !(Date.parse(device.ownerBindingExpiresAt ?? '') > now)) return '';
  return JSON.stringify([source, target, device.ownerSessionBindingId, device.workspaceId, device.ownerBindingExpiresAt]);
}

// The same gate drives the mounted component and its bounded transport fixtures.
export class ResearchCardPublicationGate {
  private epoch = 0;
  private scope = '';
  private pending = false;
  private identity = '';
  card: SharedResultCardV2 | null = null;
  setScope(scope: string) {
    if (scope !== this.scope) { this.clear(); this.scope = scope; this.identity = ''; }
  }
  clear() { this.epoch += 1; this.card = null; }
  get busy() { return this.pending; }
  async publish(bridge: Pick<CrossDeviceDesktopBridge, 'publishResultCard'>, target: string, sourceId: string, owner?: { ownerSessionBindingId?: string; workspaceId?: string }): Promise<'accepted' | 'stale' | 'busy'> {
    if (this.pending) return 'busy';
    if (!this.scope || !target || !sourceId) throw new Error('RESULT_CARD_SCOPE_REQUIRED');
    const epoch = this.epoch;
    this.identity ||= `research-card-${crypto.randomUUID()}`;
    const reference: ResultCardSourceReference = { cardId: this.identity, source: { type: 'research', id: sourceId } };
    this.pending = true;
    this.card = null;
    try {
      const { shared } = await bridge.publishResultCard(target, reference);
      if (epoch !== this.epoch) return 'stale';
      if (shared.cardId !== reference.cardId || shared.targetDeviceId !== target || shared.provenance.sourceType !== 'research' || shared.provenance.sourceId !== sourceId) throw new Error('RESULT_CARD_CORRELATION_INVALID');
      if (owner && (shared.ownerSessionBindingId !== owner.ownerSessionBindingId || (owner.workspaceId && shared.workspaceId !== owner.workspaceId))) throw new Error('RESULT_CARD_OWNER_CHANGED');
      this.card = shared;
      return 'accepted';
    } catch (error) { if (epoch !== this.epoch) return 'stale'; throw error; }
    finally { this.pending = false; }
  }
}

export function ResearchPublishedCard({ card, onOpen, onDismiss }: { card: SharedResultCardV2; onOpen?: () => void; onDismiss: () => void }) {
  const canOpen = card.actions.some(action => action.action === 'open' && action.available && !action.requiresApproval);
  return <article aria-label="Published research result card" className="mt-3 rounded-lg border border-cyan-400/25 p-3 text-xs text-slate-200">
    <p role="status">Backend publication accepted (201). Phone delivery is unverified.</p>
    <h4 className="mt-2 font-semibold">{card.title}</h4>
    <p className="whitespace-pre-wrap break-words">{card.summary}</p>
    <p>Outcome: {card.outcome} · Provenance: {card.provenance.verified ? 'verified' : 'unverified'} · Revision: {card.revision}</p>
    <p className="break-all">Source: {card.provenance.sourceId} · Target: {card.targetDeviceId}</p>
    <div className="mt-2 flex gap-2"><ControlButton disabled={!canOpen || !onOpen} onClick={() => onOpen?.()}>Open local research</ControlButton><ControlButton onClick={onDismiss}>Dismiss card</ControlButton></div>
  </article>;
}

export function ResearchSharedResultPanel({ sourceReference, onOpenSource }: ResearchSharedResultPanelProps) {
  // Card publication is HTTP-only; diagnostics must not bootstrap unrelated native producers.
  const bridge = React.useMemo(() => new CrossDeviceDesktopBridge({ tauriAvailable: () => false }), []);
  const gate = React.useMemo(() => new ResearchCardPublicationGate(), []);
  const [snapshot, setSnapshot] = React.useState<CrossDeviceBridgeSnapshot | null>(null);
  const [target, setTarget] = React.useState('');
  const [card, setCard] = React.useState<SharedResultCardV2 | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('Select a device explicitly. Device eligibility is checked by the backend.');
  const alive = React.useRef(false);
  const refreshEpoch = React.useRef(0);
  const selection = React.useRef('');
  const source = sourceReference.id;
  const device = snapshot?.devices.find(row => row.deviceId === target);
  const scope = researchCardPublicationScope(snapshot, target, source);
  const eligible = Boolean(scope);
  gate.setScope(scope);
  const visibleCard = gate.card === card && (!card?.expiresAt || Date.parse(card.expiresAt) > Date.now()) ? card : null;
  React.useEffect(() => {
    alive.current = true;
    const clear = () => { refreshEpoch.current += 1; gate.clear(); selection.current = ''; setTarget(''); setSnapshot(null); setCard(null); setNotice('Publication scope cleared. Refresh devices before publishing.'); };
    const refresh = async () => {
      const epoch = ++refreshEpoch.current;
      try {
        const next = await bridge.refresh();
        if (!alive.current || epoch !== refreshEpoch.current) return;
        setSnapshot(next);
        if (!next.devices.some(row => row.deviceId === selection.current)) { selection.current = ''; setTarget(''); gate.clear(); setCard(null); }
      } catch { if (alive.current && epoch === refreshEpoch.current) clear(); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const events = ['edith-owner-logout', 'edith-cross-device-stop', 'edith-computer-stop', 'pagehide'];
    events.forEach(event => window.addEventListener(event, clear));
    return () => { alive.current = false; refreshEpoch.current += 1; gate.clear(); window.clearInterval(timer); events.forEach(event => window.removeEventListener(event, clear)); };
  }, [bridge, gate, source]);
  React.useEffect(() => {
    setCard(null);
  }, [scope]);
  React.useEffect(() => {
    const expiry = Math.min(Date.parse(device?.ownerBindingExpiresAt ?? '') || Infinity, Date.parse(card?.expiresAt ?? '') || Infinity);
    if (!Number.isFinite(expiry)) return;
    const timer = window.setTimeout(() => { gate.clear(); setCard(null); setSnapshot(null); }, Math.max(0, expiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [scope, gate, card?.expiresAt]);
  const publish = async () => {
    if (!eligible || gate.busy) return;
    setBusy(true); setNotice('Publishing the selected persisted research result…');
    try {
      const result = await gate.publish(bridge, target, source, device);
      if (alive.current && result === 'accepted') { setCard(gate.card); setNotice('Backend publication accepted; phone delivery is unverified.'); }
    } catch { if (alive.current) { gate.clear(); setCard(null); setNotice('Publication was not accepted. No delivery is claimed.'); } }
    finally { if (alive.current) setBusy(false); }
  };
  return <section aria-label="Share selected research result" className="mt-4 rounded-lg border border-white/10 bg-slate-950/35 p-3">
    <h3 className="text-sm font-semibold text-slate-100">Share selected research result</h3>
    <label className="mt-2 block text-xs text-slate-300">Mobile target<select aria-label="Research result mobile target" value={target} disabled={busy || !snapshot?.devices.length} onChange={event => { gate.clear(); setCard(null); selection.current = event.target.value; setTarget(event.target.value); }} className="ml-2 rounded bg-slate-900 p-2">
      <option value="">{snapshot?.devices.length ? 'Select a device' : 'No device available'}</option>
      {snapshot?.devices.map(row => <option key={row.deviceId} value={row.deviceId}>{row.displayName} ({row.trustStatus})</option>)}
    </select></label>
    <div className="mt-2"><ControlButton disabled={busy || !eligible || Boolean(visibleCard)} onClick={() => void publish()}>Publish research card</ControlButton></div>
    <p role="status" className="mt-2 text-xs text-slate-400">{notice}</p>
    {visibleCard && <ResearchPublishedCard card={visibleCard} onOpen={onOpenSource && visibleCard.provenance.sourceId === source ? () => onOpenSource(source) : undefined} onDismiss={() => { gate.clear(); setCard(null); }} />}
  </section>;
}

type Tone = 'success' | 'warning' | 'danger' | 'muted';

function toneForCapability(state: CrossDeviceCapabilityState): Tone {
  return state === 'available' ? 'success' : state === 'unsupported' ? 'danger' : state === 'configuration_required' ? 'warning' : 'muted';
}

function Status({ label, value, tone }: { label: string; value?: string; tone: Tone }) {
  const className = {
    success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    warning: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    danger: 'border-red-400/30 bg-red-400/10 text-red-200',
    muted: 'border-slate-500/25 bg-slate-500/10 text-slate-300',
  }[tone];
  return (
    <span className={`inline-flex min-h-7 items-center gap-2 rounded-md border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      <span>{label}</span>
      {value && <span className="font-mono opacity-70">{value}</span>}
    </span>
  );
}

function CapabilityRow({ label, state, detail }: { label: string; state: CrossDeviceCapabilityState; detail: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/35 p-3">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-slate-200">{label}</div>
        <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{detail}</div>
      </div>
      <Status label={state.replaceAll('_', ' ')} tone={toneForCapability(state)} />
    </div>
  );
}

function ControlButton({ children, onClick, disabled, title, tone = 'default' }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string; tone?: 'default' | 'danger' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tone === 'danger' ? 'border-red-400/30 bg-red-400/10 text-red-100 hover:bg-red-400/15' : 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15'}`}
    >
      {children}
    </button>
  );
}

export function CrossDeviceBridgePanel() {
  const bridge = React.useMemo(() => new CrossDeviceDesktopBridge(), []);
  const [snapshot, setSnapshot] = React.useState<CrossDeviceBridgeSnapshot | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = React.useState('');
  const [frame, setFrame] = React.useState<CrossDeviceFrame | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ tone: Tone; text: string } | null>(null);

  const refresh = React.useCallback(async () => {
    setBusy('refresh');
    try {
      const next = await bridge.refresh();
      setSnapshot(next);
      setSelectedDeviceId((current) => current && next.devices.some((device) => device.deviceId === current) ? current : next.devices[0]?.deviceId ?? '');
      if (next.killSwitchActive) {
        setFrame(null);
        setNotice({ tone: 'danger', text: 'Emergency Stop is active. Cross-device leases and private frame data were cleared.' });
      }
    } catch {
      setNotice({ tone: 'warning', text: 'Cross-device diagnostics could not be refreshed. No capability is assumed available.' });
    } finally {
      setBusy(null);
    }
  }, [bridge]);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const emergencyStop = () => {
      setFrame(null);
      setNotice({ tone: 'danger', text: 'Emergency Stop cleared the active cross-device session.' });
      void bridge.emergencyStop();
    };
    const ownerLogout = () => {
      setFrame(null);
      void bridge.revokeCurrentOwner('LOGOUT');
    };
    window.addEventListener('edith-cross-device-stop', emergencyStop);
    window.addEventListener('edith-owner-logout', ownerLogout);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('edith-cross-device-stop', emergencyStop);
      window.removeEventListener('edith-owner-logout', ownerLogout);
      setFrame(null);
      void bridge.stopLiveView();
    };
  }, [bridge, refresh]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (error) {
      const code = error instanceof CrossDeviceBridgeError ? error.code : 'CROSS_DEVICE_REQUEST_FAILED';
      setFrame(null);
      setNotice({ tone: code.includes('KILL_SWITCH') ? 'danger' : 'warning', text: `${code}: Operation was not completed.` });
    } finally {
      setBusy(null);
    }
  };

  const selectedDevice = snapshot?.devices.find((device) => device.deviceId === selectedDeviceId);
  const liveViewActive = Boolean(bridge.activeLiveView);
  const liveViewReady = snapshot?.capabilities.liveView === 'available' && Boolean(selectedDeviceId) && !snapshot.killSwitchActive;
  const cleanupReady = snapshot?.capabilities.retentionCleanup === 'available' && Boolean(selectedDevice?.ownerSessionBindingId) && !snapshot.killSwitchActive;
  const frameSource = frame ? `data:${frame.transport.mimeType};base64,${frame.transport.bytesBase64}` : undefined;

  return (
    <section className="edith-os-panel mt-4" aria-labelledby="cross-device-bridge-title">
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="edith-icon-cell"><MonitorSmartphone className="h-4 w-4" /></div>
          <div className="min-w-0">
            <div className="edith-eyebrow">PHASE 6F / OWNER CONTROL</div>
            <h3 id="cross-device-bridge-title" className="text-sm font-semibold text-slate-100">Cross-Device Desktop Bridge</h3>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Status label="Tauri" value={snapshot?.tauriAvailable ? 'available' : 'absent'} tone={snapshot?.tauriAvailable ? 'success' : 'warning'} />
          <Status label="Control plane" value={snapshot?.native?.controlPlaneConnected ? 'connected' : 'not connected'} tone={snapshot?.native?.controlPlaneConnected ? 'success' : 'warning'} />
          <Status label="Remote control" value="blocked" tone="danger" />
        </div>
      </div>

      <div className="relative z-10 space-y-4 p-4">
        <div className={`rounded-lg border p-3 text-xs leading-relaxed ${snapshot?.killSwitchActive ? 'border-red-400/35 bg-red-500/10 text-red-100' : 'border-cyan-400/20 bg-cyan-400/[0.06] text-slate-300'}`}>
          <div className="flex items-start gap-2">
            {snapshot?.killSwitchActive ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" /> : <RadioTower className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />}
            <span>{snapshot?.safeMessage ?? 'Capability truth is being checked. Controls remain unavailable until verification completes.'}</span>
          </div>
        </div>

        {notice && (
          <div role="status" className={`rounded-lg border p-3 text-xs ${notice.tone === 'danger' ? 'border-red-400/30 bg-red-500/10 text-red-100' : notice.tone === 'success' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100' : 'border-amber-400/30 bg-amber-500/10 text-amber-100'}`}>
            {notice.text}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <CapabilityRow label="Live View" state={snapshot?.capabilities.liveView ?? 'unverified'} detail="Owner-approved, pull-only capture. Maximum 2 FPS; no remote control." />
              <CapabilityRow label="PC telemetry" state={snapshot?.capabilities.pcStatus ?? 'unverified'} detail="Native sampling exists; backend publication remains unavailable until producer wiring exists." />
              <CapabilityRow label="PC to mobile" state={snapshot?.capabilities.pcToMobileTransfer ?? 'unverified'} detail="Opaque handles and checksum validation only. No path or secret is exposed." />
              <CapabilityRow label="Mobile inbox" state={snapshot?.capabilities.mobileToPcInbox ?? 'unverified'} detail="Destination approval and bounded retention are required." />
              <CapabilityRow label="Wake-on-LAN" state={snapshot?.capabilities.wakeOnLan ?? 'unverified'} detail="No packet is sent while configuration is incomplete." />
              <CapabilityRow label="Audio handoff" state={snapshot?.capabilities.audioHandoff ?? 'unverified'} detail="Exclusive lease only; fixture verification is not presented as live audio." />
            </div>

            <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-200">Trusted mobile target</div>
                  <div className="mt-1 text-[11px] text-slate-500">Only backend-reported trusted devices are selectable.</div>
                </div>
                <select
                  aria-label="Trusted mobile target"
                  value={selectedDeviceId}
                  onChange={(event) => setSelectedDeviceId(event.target.value)}
                  disabled={!snapshot?.devices.length || Boolean(busy)}
                  className="min-h-9 max-w-full rounded-md border border-white/10 bg-slate-950 px-3 text-xs text-slate-200 outline-none focus:border-cyan-400/40 disabled:opacity-50"
                >
                  {!snapshot?.devices.length && <option value="">No trusted device</option>}
                  {snapshot?.devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.displayName} / {device.platform} / {device.trustStatus}</option>)}
                </select>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <ControlButton
                  onClick={() => void run('live-start', async () => {
                    const session = await bridge.startLiveView(selectedDeviceId);
                    if (session.status === 'configuration_required') {
                      setNotice({ tone: 'warning', text: `${session.errorCode ?? 'CONFIGURATION_REQUIRED'}: Live View was not started.` });
                      return;
                    }
                    setNotice({ tone: 'warning', text: 'Native lease opened. Live View remains unverified until backend producer ingest accepts a frame.' });
                  })}
                  disabled={!liveViewReady || liveViewActive || Boolean(busy)}
                  title={liveViewReady ? 'Request owner-approved Live View' : 'Live View control plane is not available'}
                >
                  <Eye className="h-3.5 w-3.5" /> Start Live View
                </ControlButton>
                <ControlButton
                  onClick={() => void run('frame', async () => {
                    setFrame(await bridge.pullLiveViewFrame());
                    setNotice({ tone: 'success', text: 'Frame metadata was accepted by the authenticated backend producer path. Pixels remain local and ephemeral.' });
                  })}
                  disabled={!liveViewActive || Boolean(busy)}
                  title="Pull one frame; automatic streaming is disabled"
                >
                  <Activity className="h-3.5 w-3.5" /> Pull frame
                </ControlButton>
                <ControlButton
                  onClick={() => void run('live-stop', async () => { await bridge.stopLiveView(); setFrame(null); })}
                  disabled={!liveViewActive || Boolean(busy)}
                  tone="danger"
                >
                  <Square className="h-3.5 w-3.5" /> Stop
                </ControlButton>
                <ControlButton
                  onClick={() => void run('cleanup', async () => {
                    const result = await bridge.cleanupRetention(selectedDevice!.ownerSessionBindingId!);
                    setNotice({ tone: 'success', text: `Retention cleanup removed ${result.removedArtifacts} expired artifact(s); ${result.preservedActiveOrPending} active or pending item(s) preserved.` });
                  })}
                  disabled={!cleanupReady || Boolean(busy)}
                  title={cleanupReady ? 'Remove expired inbox artifacts' : 'Owner-bound native cleanup is unavailable'}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Retention cleanup
                </ControlButton>
                <ControlButton onClick={() => void refresh()} disabled={Boolean(busy)}>
                  <RefreshCw className={`h-3.5 w-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} /> Refresh
                </ControlButton>
              </div>
            </div>

            {frameSource && frame && (
              <figure className="overflow-hidden rounded-lg border border-cyan-400/20 bg-black">
                <img src={frameSource} alt="Owner-approved desktop Live View frame" className="aspect-video w-full object-contain" />
                <figcaption className="flex flex-wrap justify-between gap-2 border-t border-white/10 px-3 py-2 font-mono text-[10px] text-slate-500">
                  <span>Frame {frame.metadata.sequence} / {frame.metadata.width}x{frame.metadata.height}</span>
                  <span>{new Date(frame.metadata.observedAt).toLocaleTimeString()}</span>
                </figcaption>
              </figure>
            )}
          </div>

          <aside className="space-y-3">
            <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200"><Smartphone className="h-4 w-4 text-cyan-300" /> Control-plane state</div>
              <dl className="mt-3 space-y-2 text-[11px]">
                {[
                  ['Owner session', snapshot?.ownerAuthorized ? 'authorized' : 'required'],
                  ['Trusted devices', String(snapshot?.devices.length ?? 0)],
                  ['Live View leases', String(snapshot?.counts.liveViews ?? 0)],
                  ['Transfer intents', String(snapshot?.counts.transferIntents ?? 0)],
                  ['Result cards', String(snapshot?.counts.resultCards ?? 0)],
                  ['Audio leases', String(snapshot?.counts.audioLeases ?? 0)],
                  ['Producer configured', snapshot?.producer.configured ? 'yes' : 'no'],
                  ['Producer sessions', String(snapshot?.producer.activeSessions ?? 0)],
                  ['Accepted frame metadata', String(snapshot?.producer.retainedFrameMetadata ?? 0)],
                ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3"><dt className="text-slate-500">{label}</dt><dd className="font-mono text-slate-300">{value}</dd></div>)}
              </dl>
            </div>

            <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-100"><FileCheck2 className="h-4 w-4" /> Integrity and privacy</div>
              <ul className="mt-3 space-y-2 text-[11px] leading-relaxed text-slate-400">
                <li>Frame pixels stay in memory and are cleared on stop, error, expiry, logout or Emergency Stop.</li>
                <li>Automatic capture and remote input are disabled.</li>
                <li>Transfers require bounded chunks, opaque handles and SHA-256 integrity.</li>
                <li>Private paths, frame bytes and credentials are never shown in diagnostics.</li>
              </ul>
            </div>

            {!snapshot?.tauriAvailable && (
              <div className="rounded-lg border border-white/10 bg-slate-950/35 p-4 text-center">
                <WifiOff className="mx-auto h-5 w-5 text-slate-500" />
                <div className="mt-2 text-xs font-semibold text-slate-300">Native invoke unavailable</div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Browser mode can inspect backend truth, but native controls remain disabled.</p>
              </div>
            )}
          </aside>
        </div>

        <div className="text-right font-mono text-[10px] text-slate-600">
          Last checked: {snapshot?.checkedAt ? new Date(snapshot.checkedAt).toLocaleTimeString() : 'pending'}
        </div>
      </div>
    </section>
  );
}
