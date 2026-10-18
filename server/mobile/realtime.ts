import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  EDITH_CONTRACT_SCHEMA,
  EDITH_CONTRACT_VERSION,
  REALTIME_EVENT_NAMES,
  parseRealtimeEnvelopeV2_1,
  parseTaskEventV2,
  type TypedTaskEventV2,
  type RealtimeEnvelopeV2_1,
  type RealtimeEventName,
  type RealtimePayloadMapV2,
} from '../../src/edith/contracts';
import type { MobileDeviceRecord, MobileEncryptedEnvelope, MobileSessionContext } from './types';
import { MobilePairingService } from './pairingService';
import { MobileCryptoService } from './crypto';
import { isSecureMobileTransport } from './middleware';

interface Connection {
  socket: WebSocket;
  context: MobileSessionContext;
}

const MAX_HISTORY = 500;

function deviceToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  const match = typeof header === 'string' ? /^Device\s+(.+)$/i.exec(header) : undefined;
  return match?.[1]?.trim();
}

export class MobileRealtimeService {
  private readonly socketServer = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly histories = new Map<string, RealtimeEnvelopeV2_1[]>();
  private readonly deviceCursors = new Map<string, number>();
  private cursor = 0;
  private readonly streamId: string;
  private readonly journalPath: string;
  private readonly unsubscribeSession: () => void;

  constructor(private readonly pairing: MobilePairingService, private readonly crypto: MobileCryptoService, serverId: string) {
    this.journalPath = path.join(path.dirname(pairing.store.filePath), 'mobile-realtime.json');
    if (fs.existsSync(this.journalPath)) {
      if (fs.statSync(this.journalPath).size > 32 * 1024 * 1024) throw new Error('REALTIME_JOURNAL_LIMIT');
      const saved = JSON.parse(fs.readFileSync(this.journalPath, 'utf8'));
      if (saved.serverId !== serverId || typeof saved.streamId !== 'string' || !saved.streamId.startsWith(`mobile-stream-${serverId}-`) || !Number.isSafeInteger(saved.cursor) || saved.cursor < 0 || !Array.isArray(saved.histories) || saved.histories.length > 1000) throw new Error('REALTIME_JOURNAL_INVALID');
      this.streamId = saved.streamId; this.cursor = saved.cursor;
      for (const [key, rows, cursor] of saved.histories) {
        if (typeof key !== 'string' || !Array.isArray(rows) || rows.length > MAX_HISTORY || !Number.isSafeInteger(cursor) || cursor < 0) throw new Error('REALTIME_JOURNAL_INVALID');
        let previous = rows.length ? rows[0].cursor - 1 : 0;
        for (const row of rows) {
          if (!parseRealtimeEnvelopeV2_1(row).success || row.cursor !== previous + 1 || row.cursor > cursor || row.sequence !== row.cursor || row.streamId !== `${this.streamId}:${key.slice(key.lastIndexOf(':') + 1)}`) throw new Error('REALTIME_JOURNAL_INVALID');
          previous = row.cursor;
        }
        if (previous !== cursor || this.histories.has(key)) throw new Error('REALTIME_JOURNAL_INVALID');
        this.histories.set(key, rows); this.deviceCursors.set(key, cursor);
      }
    } else { this.streamId = `mobile-stream-${serverId}-${randomUUID()}`; }
    this.unsubscribeSession = pairing.onSessionReplaced((deviceId, priorSessionId) => this.resetSession(deviceId, priorSessionId));
    this.socketServer.on('connection', (socket: WebSocket, request: IncomingMessage, context: MobileSessionContext) => {
      const connection = { socket, context };
      this.connections.set(socket, connection);
      socket.on('message', (raw) => this.handleMessage(connection, raw.toString('utf8')));
      socket.on('close', () => this.connections.delete(socket));
      socket.on('error', () => this.connections.delete(socket));
    });
  }

  handleUpgrade(server: Server): void {
    server.on('upgrade', (request, socket, head) => {
      const pathname = request.url?.split('?')[0];
      if (pathname !== '/api/mobile/realtime') return;
      try {
        if (!isSecureMobileTransport(request)) {
          socket.write('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        const token = deviceToken(request);
        if (!token) throw new Error('DEVICE_AUTH_REQUIRED');
        const context = this.pairing.authenticate(token);
        if (!context.device.device.capabilities?.realtime) throw new Error('REALTIME_CAPABILITY_NOT_ALLOWED');
        this.socketServer.handleUpgrade(request, socket, head, (webSocket) => {
          this.socketServer.emit('connection', webSocket, request, context);
        });
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
      }
    });
  }

  publish<K extends RealtimeEventName>(event: K, payload: RealtimePayloadMapV2[K], correlationId = `corr-${randomUUID()}`): RealtimeEnvelopeV2_1<RealtimePayloadMapV2[K]> {
    const previousCursor = this.cursor;
    const previousHistories = new Map([...this.histories].map(([key, rows]) => [key, [...rows]]));
    const previousDeviceCursors = new Map(this.deviceCursors);
    const cursor = ++this.cursor;
    const envelope: RealtimeEnvelopeV2_1<RealtimePayloadMapV2[K]> = {
      schema: EDITH_CONTRACT_SCHEMA,
      version: EDITH_CONTRACT_VERSION,
      event,
      eventId: `mobile-event-${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      sequence: cursor,
      streamId: this.streamId,
      cursor,
      correlationId,
      replayed: false,
      payload,
    };
    const parsed = parseRealtimeEnvelopeV2_1(envelope);
    if (parsed.success === false) { this.cursor = previousCursor; throw new Error(parsed.errorCode); }
    for (const device of this.pairing.store.listDevices()) {
      if (device.trust.status !== 'trusted' || !this.canReceive(device, envelope)) continue;
      const deviceId = device.device.deviceId;
      const credential = this.pairing.store.listCredentials().find((item) => item.deviceId === deviceId && !item.revokedAt && Date.parse(item.expiresAt) > Date.now());
      if (!credential) continue;
      try { this.pairing.revalidateContext({ credential, device }); } catch { continue; }
      const historyKey = `${deviceId}:${credential.sessionId}`;
      const deviceCursor = (this.deviceCursors.get(historyKey) ?? 0) + 1;
      this.deviceCursors.set(historyKey, deviceCursor);
      const scoped = { ...envelope, streamId: `${this.streamId}:${credential.sessionId}`, sequence: deviceCursor, cursor: deviceCursor } as RealtimeEnvelopeV2_1;
      const history = this.histories.get(historyKey) ?? [];
      history.push(scoped);
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
      this.histories.set(historyKey, history);
    }
    try { this.persist(); }
    catch (error) {
      this.cursor = previousCursor; this.histories.clear(); this.deviceCursors.clear();
      for (const [key,rows] of previousHistories) this.histories.set(key,rows);
      for (const [key,cursor] of previousDeviceCursors) this.deviceCursors.set(key,cursor);
      throw error;
    }
    for (const connection of this.connections.values()) {
      const key = `${connection.context.device.device.deviceId}:${connection.context.credential.sessionId}`;
      const scoped = this.histories.get(key)?.at(-1);
      if (scoped?.eventId === envelope.eventId) this.send(connection, scoped);
    }
    return envelope;
  }

  /** Publish the already persisted, validated event without reconstructing task counters or identity. */
  publishPersistedTaskEvent(event: TypedTaskEventV2): void {
    const parsed = parseTaskEventV2(event);
    if (!parsed.success) throw new Error('PERSISTED_TASK_EVENT_INVALID');
    this.publish(REALTIME_EVENT_NAMES.TASK_EVENT, parsed.value, parsed.value.context.correlationId);
  }

  publishTaskCreated(taskId: string, status: any, revision = 1, correlationId = `corr-${randomUUID()}`): void {
    this.publish(REALTIME_EVENT_NAMES.TASK_EVENT, {
      contractVersion: 2,
      taskId,
      eventId: `task-event-${randomUUID()}`,
      sequence: 1,
      revision,
      type: 'task.created',
      occurredAt: new Date().toISOString(),
      context: { correlationId, idempotencyKey: `mobile-task-create-${taskId}` },
      payload: { status },
    }, correlationId);
  }

  publishTaskStatus(taskId: string, fromStatus: any, toStatus: any, revision: number, reasonCode?: string, correlationId = `corr-${randomUUID()}`): void {
    this.publish(REALTIME_EVENT_NAMES.TASK_EVENT, {
      contractVersion: 2,
      taskId,
      eventId: `task-event-${randomUUID()}`,
      sequence: Math.max(1, revision),
      revision: Math.max(1, revision),
      type: 'task.status_changed',
      occurredAt: new Date().toISOString(),
      context: { correlationId, idempotencyKey: `mobile-task-status-${taskId}-${revision}`, fromStatus, toStatus },
      payload: { fromStatus, toStatus, reasonCode },
    }, correlationId);
  }

  disconnectDevice(deviceId: string): void {
    for (const connection of this.connections.values()) {
      if (connection.context.device.device.deviceId === deviceId) connection.socket.close(4003, 'device_revoked');
    }
    for (const key of [...this.histories.keys()]) if (key.slice(0, key.lastIndexOf(':')) === deviceId) this.histories.delete(key);
    for (const key of [...this.deviceCursors.keys()]) if (key.slice(0, key.lastIndexOf(':')) === deviceId) this.deviceCursors.delete(key);
    this.persist();
  }

  disconnectOwner(bindingId: string, deviceIds: readonly string[]): void {
    const affected = new Set(deviceIds);
    let failed = false, firstError: unknown;
    const attempt = (work: () => void) => { try { work(); } catch (error) { if (!failed) firstError = error; failed = true; } };
    for (const [socket, connection] of this.connections) {
      if (connection.context.device.ownerBinding.ownerSessionId !== bindingId && !affected.has(connection.context.device.device.deviceId)) continue;
      affected.add(connection.context.device.device.deviceId);
      this.connections.delete(socket);
      try { connection.socket.close(4003, 'device_revoked'); }
      catch (error) {
        if (!failed) firstError = error;
        failed = true;
        attempt(() => connection.socket.terminate());
      }
    }
    for (const key of [...this.histories.keys()]) if (affected.has(key.slice(0, key.lastIndexOf(':')))) this.histories.delete(key);
    for (const key of [...this.deviceCursors.keys()]) if (affected.has(key.slice(0, key.lastIndexOf(':')))) this.deviceCursors.delete(key);
    attempt(() => this.persist());
    if (failed) throw firstError;
  }

  private resetSession(deviceId: string, priorSessionId: string): void {
    for (const connection of this.connections.values()) if (connection.context.device.device.deviceId === deviceId && connection.context.credential.sessionId === priorSessionId) connection.socket.close(4003, 'session_replaced');
    const currentSessionId = this.pairing.store.getCredential(this.pairing.store.getDevice(deviceId)?.trust.reconnectCredentialId ?? '')?.sessionId;
    for (const key of this.histories.keys()) if (key.slice(0, key.lastIndexOf(':')) === deviceId && key !== `${deviceId}:${currentSessionId}`) this.histories.delete(key);
    for (const key of this.deviceCursors.keys()) if (key.slice(0, key.lastIndexOf(':')) === deviceId && key !== `${deviceId}:${currentSessionId}`) this.deviceCursors.delete(key);
    this.persist();
  }

  status(): { connectedDevices: number; cursor: number; retainedEvents: number; streamId: string } {
    return { connectedDevices: new Set([...this.connections.values()].map((item) => item.context.device.device.deviceId)).size, cursor: this.cursor, retainedEvents: [...this.histories.values()].reduce((sum, rows) => sum + rows.length, 0), streamId: this.streamId };
  }

  shutdown(): void {
    this.unsubscribeSession();
    for (const connection of this.connections.values()) connection.socket.close(1001, 'server_shutdown');
    this.connections.clear();
    this.socketServer.close();
  }

  private handleMessage(connection: Connection, raw: string): void {
    try {
      connection.context = this.pairing.revalidateContext(connection.context);
      const envelope = JSON.parse(raw) as MobileEncryptedEnvelope;
      const command = this.crypto.decrypt<{ type: string; afterCursor?: number }>(connection.context.credential.sessionId, envelope, 'realtime.command', 'client_to_server', 'realtime');
      if (command.type !== 'resume' || !Number.isSafeInteger(command.afterCursor) || Number(command.afterCursor) < 0) throw new Error('REALTIME_COMMAND_INVALID');
      this.resume(connection, Number(command.afterCursor));
    } catch (error) {
      connection.socket.close(1008, error instanceof Error ? error.message.slice(0, 120) : 'invalid_message');
    }
  }

  private resume(connection: Connection, afterCursor: number): void {
    connection.context = this.pairing.revalidateContext(connection.context);
    const deviceId = connection.context.device.device.deviceId;
    const historyKey = `${deviceId}:${connection.context.credential.sessionId}`;
    let history = this.histories.get(historyKey) ?? [];
    if (!history.length && afterCursor === 0) {
      this.publish(REALTIME_EVENT_NAMES.DEVICE_STATUS, { deviceId, status: connection.context.device.trust.status });
      if (this.connections.has(connection.socket)) return;
      history = this.histories.get(historyKey) ?? [];
    }
    const deviceCursor = this.deviceCursors.get(historyKey) ?? 0;
    const windowStartCursor = history[0]?.cursor ?? deviceCursor;
    const windowEndCursor = history.at(-1)?.cursor ?? deviceCursor;
    if (afterCursor > windowEndCursor || (history.length === MAX_HISTORY && afterCursor < windowStartCursor - 1)) throw new Error('REPLAY_RESET_REQUIRED');
    const rows = history.filter((event) => event.cursor > afterCursor);
    for (const row of rows) {
      const replayed: RealtimeEnvelopeV2_1 = {
        ...row,
        replayed: true,
        replay: { requestedAfterCursor: afterCursor, windowStartCursor, windowEndCursor, truncated: history.length === MAX_HISTORY },
      };
      this.send(connection, replayed);
    }
  }

  private send(connection: Connection, envelope: RealtimeEnvelopeV2_1): void {
    if (connection.socket.readyState !== WebSocket.OPEN) return;
    try {
      connection.context = this.pairing.revalidateContext(connection.context);
      connection.socket.send(JSON.stringify(this.crypto.encrypt(connection.context.credential.sessionId, 'realtime.event', envelope, 'server_to_client', 'realtime')));
    } catch {
      connection.socket.close(4003, 'device_authority_expired');
    }
  }

  private canReceive(device: MobileDeviceRecord, envelope: RealtimeEnvelopeV2_1): boolean {
    const commands = new Set(device.allowedCommands);
    const payload = envelope.payload as any;
    if (envelope.event === REALTIME_EVENT_NAMES.EMERGENCY_STOP_ACTIVATED) return commands.has('emergency_stop') && payload.deviceId === device.device.deviceId && payload.workspaceId === device.ownerBinding.workspaceId;
    if (envelope.event === REALTIME_EVENT_NAMES.FILE_TRANSFER_STATUS) {
      const transfer = this.pairing.store.getTransfer(String(payload.transferId ?? ''));
      return commands.has('file.upload') && transfer?.deviceId === device.device.deviceId;
    }
    if (envelope.event === REALTIME_EVENT_NAMES.DEVICE_STATUS) return payload.deviceId === device.device.deviceId;
    if (envelope.event === REALTIME_EVENT_NAMES.PAIRING_STATUS) return this.pairing.store.getPairing(String(payload.pairingId ?? ''))?.device.deviceId === device.device.deviceId;
    const crossDeviceCommand: Partial<Record<RealtimeEventName, string[]>> = {
      [REALTIME_EVENT_NAMES.CROSS_DEVICE_TRANSFER_STATUS]: ['file.upload', 'file.download'],
      [REALTIME_EVENT_NAMES.CROSS_DEVICE_CLIPBOARD_STATUS]: ['clipboard.publish', 'clipboard.consume'],
      [REALTIME_EVENT_NAMES.CROSS_DEVICE_LIVE_VIEW_STATUS]: ['live_view.start', 'live_view.stop'],
      [REALTIME_EVENT_NAMES.CROSS_DEVICE_LIVE_VIEW_FRAME_METADATA]: ['live_view.start'],
      [REALTIME_EVENT_NAMES.CROSS_DEVICE_WAKE_READY_STATUS]: ['wake.request'],
      [REALTIME_EVENT_NAMES.CROSS_DEVICE_OFFLINE_QUEUE_STATUS]: ['offline_queue.manage'],
      [REALTIME_EVENT_NAMES.CROSS_DEVICE_HANDOFF_STATUS]: ['handoff.manage'],
      [REALTIME_EVENT_NAMES.CROSS_DEVICE_RESULT_CARD_UPDATED]: ['result_card.read'],
      [REALTIME_EVENT_NAMES.CROSS_DEVICE_AUDIO_HANDOFF_STATUS]: ['audio_handoff.manage'],
      [REALTIME_EVENT_NAMES.CROSS_DEVICE_PC_STATUS_UPDATED]: ['pc_status.read'],
    };
    const required = crossDeviceCommand[envelope.event];
    if (required) return required.some((command) => commands.has(command as any))
      && payload.workspaceId === device.ownerBinding.workspaceId
      && payload.ownerSessionBindingId === device.ownerBinding.ownerSessionId
      && payload.sessionId === this.pairing.store.listCredentials().find((item) => item.deviceId === device.device.deviceId && !item.revokedAt)?.sessionId
      && [payload.sourceDeviceId, payload.targetDeviceId].includes(device.device.deviceId);
    if ([REALTIME_EVENT_NAMES.CAPSULE_UPDATED, REALTIME_EVENT_NAMES.MISSION_UPDATED].includes(envelope.event as any)) return commands.has('task.list');
    if (envelope.event.startsWith('task.')) {
      const workspaceId = payload?.context?.workspaceId;
      return (commands.has('task.list') || commands.has('task.detail') || commands.has('task.activity')) && (workspaceId === undefined || workspaceId === device.ownerBinding.workspaceId);
    }
    return false;
  }

  private persist(): void {
    const document = { serverId: this.pairing.store.serverId(), streamId: this.streamId, cursor: this.cursor,
      histories: [...this.histories].map(([key, rows]) => [key, rows, this.deviceCursors.get(key) ?? 0]) };
    const temporary = `${this.journalPath}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(document), { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temporary, this.journalPath); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
}
