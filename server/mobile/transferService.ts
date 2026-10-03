import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  isSafeTransferFileNameV2,
  parseFileTransferDescriptorV2,
  type FileChunkManifestV2,
  type FileTransferDescriptorV2,
} from '../../src/edith/contracts';
import { sha256 } from './crypto';
import { MobileRegistryStore } from './registryStore';
import type { MobileSessionContext, MobileTransferRecord } from './types';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024;
const MAX_CHUNKS = 512;
const ALLOWED_MEDIA = new Set(['text/plain', 'application/json', 'image/png', 'image/jpeg', 'application/pdf']);
function verifyMedia(buffer: Buffer, mediaType: string): boolean {
  if (mediaType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9;
  if (mediaType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mediaType === 'application/json') {
    try { JSON.parse(buffer.toString('utf8')); return true; } catch { return false; }
  }
  return !buffer.includes(0);
}

export class MobileTransferService {
  readonly inboxRoot: string;

  constructor(private readonly store: MobileRegistryStore, dataDir: string) {
    this.inboxRoot = path.resolve(dataDir, 'mobile-inbox');
    fs.mkdirSync(this.inboxRoot, { recursive: true });
  }

  create(context: MobileSessionContext, input: { fileName: string; mediaType: string; sizeBytes: number; sha256: string; manifest: FileChunkManifestV2; keyFingerprint: string }): FileTransferDescriptorV2 {
    if (!isSafeTransferFileNameV2(input.fileName)) throw new Error('TRANSFER_FILENAME_INVALID');
    if (!ALLOWED_MEDIA.has(input.mediaType)) throw new Error('TRANSFER_MEDIA_TYPE_BLOCKED');
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_FILE_BYTES) throw new Error('TRANSFER_SIZE_LIMIT');
    if (input.manifest.sizeBytes !== input.sizeBytes || input.manifest.chunkSizeBytes > MAX_CHUNK_BYTES || input.manifest.totalChunks > MAX_CHUNKS) throw new Error('TRANSFER_MANIFEST_LIMIT');
    const transferId = `transfer-${randomUUID()}`;
    const destinationHandle = `inbox-${randomUUID()}`;
    const now = new Date().toISOString();
    const descriptor: FileTransferDescriptorV2 = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      transferId,
      fileName: input.fileName,
      mediaType: input.mediaType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      direction: 'upload',
      status: 'pending',
      sourceDeviceId: context.device.device.deviceId,
      targetDeviceId: this.store.serverId(),
      chunkManifest: { ...input.manifest, transferId },
      encryption: {
        contractVersion: TASK_CONTRACT_VERSION,
        amendment: EDITH_CONTRACT_AMENDMENT,
        algorithm: 'AES-256-GCM',
        keyId: context.credential.sessionId,
        keyFingerprint: input.keyFingerprint,
        nonceStrategy: 'per_chunk_random',
        authenticated: true,
        aadContext: `mobile-transfer:${transferId}:${context.device.device.deviceId}`,
      },
      resume: {
        contractVersion: TASK_CONTRACT_VERSION,
        amendment: EDITH_CONTRACT_AMENDMENT,
        resumable: true,
        nextChunkIndex: 0,
        completedChunkIndexes: [],
        retryCount: 0,
        maxRetries: 5,
        acknowledgedBytes: 0,
        resumeCheckpointId: `resume-${randomUUID()}`,
      },
      destination: {
        contractVersion: TASK_CONTRACT_VERSION,
        amendment: EDITH_CONTRACT_AMENDMENT,
        handle: destinationHandle,
        scope: 'workspace',
        displayName: input.fileName,
        overwritePolicy: 'reject',
        createdAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
    const parsed = parseFileTransferDescriptorV2(descriptor);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    const internalDirectory = path.join(this.inboxRoot, destinationHandle);
    fs.mkdirSync(internalDirectory, { recursive: false });
    this.store.saveTransfer({ descriptor: parsed.value, deviceId: context.device.device.deviceId, sessionId: context.credential.sessionId, destinationHandle, completedChunkIndexes: [], createdAt: now, updatedAt: now });
    return parsed.value;
  }

  acceptChunk(context: MobileSessionContext, transferId: string, index: number, dataBase64: string): FileTransferDescriptorV2 {
    const record = this.requireTransfer(context, transferId);
    if (record.descriptor.status === 'completed') throw new Error('TRANSFER_ALREADY_COMPLETED');
    const manifest = record.descriptor.chunkManifest!;
    const chunk = manifest.chunks.find((item) => item.index === index);
    if (!chunk) throw new Error('TRANSFER_CHUNK_INDEX_INVALID');
    if (record.completedChunkIndexes.includes(index)) throw new Error('TRANSFER_CHUNK_REPLAYED');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) throw new Error('TRANSFER_CHUNK_ENCODING_INVALID');
    const data = Buffer.from(dataBase64, 'base64');
    if (data.length !== chunk.sizeBytes || data.length > MAX_CHUNK_BYTES || sha256(data) !== chunk.sha256.toLowerCase()) throw new Error('TRANSFER_CHUNK_CHECKSUM_MISMATCH');
    fs.writeFileSync(path.join(this.directory(record), `${index}.chunk`), data, { flag: 'wx', mode: 0o600 });
    record.completedChunkIndexes.push(index);
    record.completedChunkIndexes.sort((a, b) => a - b);
    record.updatedAt = new Date().toISOString();
    const acknowledgedBytes = record.completedChunkIndexes.reduce((sum, completed) => sum + manifest.chunks[completed].sizeBytes, 0);
    record.descriptor.status = 'transferring';
    record.descriptor.updatedAt = record.updatedAt;
    record.descriptor.resume = { ...record.descriptor.resume!, completedChunkIndexes: [...record.completedChunkIndexes], nextChunkIndex: this.firstMissing(manifest.totalChunks, record.completedChunkIndexes), acknowledgedBytes, lastAttemptAt: record.updatedAt };
    if (record.completedChunkIndexes.length === manifest.totalChunks) this.finalize(record);
    this.store.saveTransfer(record);
    return record.descriptor;
  }

  status(context: MobileSessionContext, transferId: string): FileTransferDescriptorV2 {
    return this.requireTransfer(context, transferId).descriptor;
  }

  private finalize(record: MobileTransferRecord): void {
    const manifest = record.descriptor.chunkManifest!;
    const directory = this.directory(record);
    const content = Buffer.concat(manifest.chunks.map((chunk) => fs.readFileSync(path.join(directory, `${chunk.index}.chunk`))));
    if (content.length !== record.descriptor.sizeBytes || sha256(content) !== record.descriptor.sha256.toLowerCase()) throw new Error('TRANSFER_FILE_CHECKSUM_MISMATCH');
    if (!verifyMedia(content, record.descriptor.mediaType)) throw new Error('TRANSFER_MEDIA_SIGNATURE_MISMATCH');
    const completed = path.join(directory, 'payload.bin');
    fs.writeFileSync(completed, content, { flag: 'wx', mode: 0o600 });
    for (const chunk of manifest.chunks) fs.rmSync(path.join(directory, `${chunk.index}.chunk`), { force: true });
    record.descriptor.status = 'completed';
    record.descriptor.updatedAt = new Date().toISOString();
  }

  private firstMissing(total: number, completed: number[]): number {
    const set = new Set(completed);
    for (let index = 0; index < total; index += 1) if (!set.has(index)) return index;
    return total;
  }

  private requireTransfer(context: MobileSessionContext, transferId: string): MobileTransferRecord {
    const record = this.store.getTransfer(transferId);
    if (!record || record.deviceId !== context.device.device.deviceId || record.sessionId !== context.credential.sessionId) throw new Error('TRANSFER_NOT_FOUND');
    this.directory(record);
    return record;
  }

  private directory(record: MobileTransferRecord): string {
    const resolved = path.resolve(this.inboxRoot, record.destinationHandle);
    if (path.dirname(resolved) !== this.inboxRoot || path.basename(resolved) !== record.destinationHandle) throw new Error('TRANSFER_DESTINATION_INVALID');
    return resolved;
  }
}
