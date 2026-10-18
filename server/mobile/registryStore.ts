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
  /** Synchronous single-runtime compare and atomic document publication. No callbacks enter this window. */
  commitAuthority(expectedDevice: MobileDeviceRecord | undefined, device: MobileDeviceRecord, credential: MobileRegistryDocument['credentials'][number], pairing?: { expected: MobilePairingRecord; next: MobilePairingRecord }): void {
    const doc = this.read();
    const current = doc.devices.find(row => row.device.deviceId === device.device.deviceId);
    if (JSON.stringify(current) !== JSON.stringify(expectedDevice)) throw new Error('RECONNECT_AUTHORITY_CHANGED');
    if (pairing && JSON.stringify(doc.pairings.find(row => row.pairingId === pairing.expected.pairingId)) !== JSON.stringify(pairing.expected)) throw new Error('PAIRING_ALREADY_CHANGED');
    const now = new Date().toISOString();
    doc.credentials = [credential, ...doc.credentials.map(row => row.deviceId === device.device.deviceId && !row.revokedAt ? { ...row, revokedAt: now } : row)].slice(0, 2000);
    doc.devices = [device, ...doc.devices.filter(row => row.device.deviceId !== device.device.deviceId)];
    if (pairing) doc.pairings = doc.pairings.map(row => row.pairingId === pairing.expected.pairingId ? pairing.next : row);
    this.write(doc);
  }

  revokeAuthority(device: MobileDeviceRecord): void {
    const doc = this.read();
    doc.devices = doc.devices.map(row => row.device.deviceId === device.device.deviceId ? device : row);
    doc.credentials = doc.credentials.map(row => row.deviceId === device.device.deviceId && !row.revokedAt ? { ...row, revokedAt: device.updatedAt } : row);
    this.write(doc);
  }
  getTransfer(id: string): MobileTransferRecord | undefined { return this.listTransfers().find((item) => item.descriptor.transferId === id); }
  saveTransfer(record: MobileTransferRecord): void {
    const doc=this.read();doc.transfers=[record,...doc.transfers.filter(item=>item.descriptor.transferId!==record.descriptor.transferId)].slice(0,1000);
    const temp=`${this.filePath}.${randomUUID()}.transfer.tmp`;let fd:number|undefined;
    try{fd=fs.openSync(temp,'wx',0o600);const bytes=Buffer.from(`${JSON.stringify(doc,null,2)}\n`);let offset=0;while(offset<bytes.length){const written=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);if(written<=0)throw Error('TRANSFER_CHECKPOINT_WRITE_FAILED');offset+=written;}fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,this.filePath);}
    finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }

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
    const temp = `${this.filePath}.${randomUUID()}.tmp`;
    const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
    let fd: number | undefined;
    let ownsTemp = false;
    let failed = false;
    let primaryError: unknown;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      ownsTemp = true;
      let offset = 0;
      while (offset < bytes.length) {
        const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (written <= 0) throw Object.assign(new Error('MOBILE_REGISTRY_WRITE_FAILED'), { code: 'EIO' });
        offset += written;
      }
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      const delays = [10, 20, 40];
      let firstRenameError: unknown;
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(temp, this.filePath); break; }
        catch (error) {
          if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException)?.code ?? '')) throw error;
          firstRenameError ??= error;
          if (attempt === delays.length) throw firstRenameError;
          // Stay synchronous: no authority-changing callback enters compare/publication.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
        }
      }
    } catch (error) { failed = true; primaryError = error; throw error; }
    finally {
      let cleanupFailed = false;
      let cleanupError: unknown;
      if (fd !== undefined) {
        try { fs.closeSync(fd); }
        catch (error) { cleanupFailed = true; cleanupError = error; }
      }
      try { if (ownsTemp) fs.unlinkSync(temp); }
      catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          if (!cleanupFailed) cleanupError = error;
          cleanupFailed = true;
        }
      }
      if (cleanupFailed) {
        if (!failed) throw cleanupError;
        // Preserve even a frozen primary error; cleanup metadata must never mask it.
        try {
          if (primaryError !== null && typeof primaryError === 'object') {
            Object.defineProperty(primaryError, 'registryCleanupErrorCode', { value: (cleanupError as NodeJS.ErrnoException)?.code ?? 'UNKNOWN', configurable: true });
          }
        } catch { /* The original operation error remains authoritative. */ }
      }
    }
  }
}
