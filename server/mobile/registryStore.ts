import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MobileCredentialRecord, MobileDeviceRecord, MobilePairingRecord, MobileRegistryDocument, MobileTransferRecord } from './types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MobileRegistryStore {
  readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.resolve(dataDir, 'mobile-registry.json');
  }

  initialize(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) this.write(this.empty());
    else this.write(this.normalize(this.readRaw()));
  }

  serverId(): string { return this.read().serverId; }
  listPairings(): MobilePairingRecord[] { return clone(this.read().pairings); }
  getPairing(id: string): MobilePairingRecord | undefined { return this.listPairings().find((item) => item.pairingId === id); }
  savePairing(record: MobilePairingRecord): void { this.update((doc) => { doc.pairings = [record, ...doc.pairings.filter((item) => item.pairingId !== record.pairingId)].slice(0, 500); }); }
  listDevices(): MobileDeviceRecord[] { return clone(this.read().devices); }
  getDevice(id: string): MobileDeviceRecord | undefined { return this.listDevices().find((item) => item.device.deviceId === id); }
  saveDevice(record: MobileDeviceRecord): void { this.update((doc) => { doc.devices = [record, ...doc.devices.filter((item) => item.device.deviceId !== record.device.deviceId)]; }); }
  listCredentials(): MobileCredentialRecord[] { return clone(this.read().credentials); }
  getCredential(id: string): MobileCredentialRecord | undefined { return this.listCredentials().find((item) => item.credentialId === id); }
  saveCredential(record: MobileCredentialRecord): void { this.update((doc) => { doc.credentials = [record, ...doc.credentials.filter((item) => item.credentialId !== record.credentialId)].slice(0, 2_000); }); }
  listTransfers(): MobileTransferRecord[] { return clone(this.read().transfers); }
  getTransfer(id: string): MobileTransferRecord | undefined { return this.listTransfers().find((item) => item.descriptor.transferId === id); }
  saveTransfer(record: MobileTransferRecord): void { this.update((doc) => { doc.transfers = [record, ...doc.transfers.filter((item) => item.descriptor.transferId !== record.descriptor.transferId)].slice(0, 1_000); }); }

  private empty(): MobileRegistryDocument {
    return { schemaVersion: 1, serverId: `edith-server-${randomUUID()}`, pairings: [], devices: [], credentials: [], transfers: [] };
  }

  private normalize(value: unknown): MobileRegistryDocument {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return this.empty();
    const row = value as Partial<MobileRegistryDocument>;
    const pairings = Array.isArray(row.pairings) ? row.pairings.map((record) => ({ ...record, cryptoSuite: record.cryptoSuite ?? 'ED25519_X25519_HKDF_SHA256_AES256_GCM' as const })) : [];
    const devices = Array.isArray(row.devices) ? row.devices.map((record) => ({ ...record, cryptoSuite: record.cryptoSuite ?? 'ED25519_X25519_HKDF_SHA256_AES256_GCM' as const })) : [];
    const transfers = Array.isArray(row.transfers) ? row.transfers.map((record) => {
      const { internalDirectory: _privatePath, ...safeRecord } = record as MobileTransferRecord & { internalDirectory?: string };
      return safeRecord;
    }) : [];
    return {
      schemaVersion: 1,
      serverId: typeof row.serverId === 'string' && row.serverId ? row.serverId : `edith-server-${randomUUID()}`,
      pairings,
      devices,
      credentials: Array.isArray(row.credentials) ? row.credentials : [],
      transfers,
    };
  }

  private readRaw(): unknown {
    try { return JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } catch { return undefined; }
  }

  private read(): MobileRegistryDocument {
    if (!fs.existsSync(this.filePath)) this.initialize();
    return this.normalize(this.readRaw());
  }

  private update(mutator: (document: MobileRegistryDocument) => void): void {
    const document = this.read();
    mutator(document);
    this.write(document);
  }

  private write(document: MobileRegistryDocument): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }
}
