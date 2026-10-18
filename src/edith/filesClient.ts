import { ownerMutationFetch } from './ownerMutationClient';
import { parseFileTransferDescriptorV2, type FileTransferDescriptorV2 } from './contracts';

export type FilesSurfaceState = 'loading' | 'ready' | 'empty' | 'error' | 'degraded' | 'configuration_required';
export interface FileEntry { id: string; root: 'workspace' | 'artifacts'; relativePath: string; name: string; size: number; modifiedAt: string; readable: boolean }
export interface FilesStatus { state: 'available' | 'configuration_required'; search: boolean; read: boolean; actions: { open: string; send: string; summarize: string } }
export interface FileContent { id: string; root: string; relativePath: string; bytes: number; text: string; truncated: false }
export class FilesClientError extends Error { constructor(readonly code: string, readonly status = 0) { super(`Dosya işlemi tamamlanamadı (${code}).`); } }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const relative = (v: unknown): v is string => typeof v === 'string' && !!v && !v.startsWith('/') && !v.includes('\\') && !v.includes(':') && !v.split('/').some(p => !p || p === '..' || p === '.');
const id = (v: string) => { if (!/^[a-f0-9]{64}$/.test(v)) throw new FilesClientError('FILE_ID_INVALID'); return v; };
export function parseFileEntry(v: unknown): FileEntry {
  if (!object(v) || !/^[a-f0-9]{64}$/.test(v.id) || !['workspace', 'artifacts'].includes(v.root) || !relative(v.relativePath)
    || typeof v.name !== 'string' || v.name !== v.relativePath.split('/').at(-1) || !Number.isSafeInteger(v.size) || v.size < 0
    || !Number.isFinite(Date.parse(v.modifiedAt)) || typeof v.readable !== 'boolean') throw new FilesClientError('FILES_RESPONSE_INVALID');
  return { id: v.id, root: v.root, relativePath: v.relativePath, name: v.name, size: v.size, modifiedAt: v.modifiedAt, readable: v.readable };
}
async function json(response: Response): Promise<Record<string, any>> {
  const row = await response.json().catch(() => null);
  if (!response.ok || !object(row) || row.success !== true) throw new FilesClientError(object(row) && typeof row.errorCode === 'string' && /^[A-Z0-9_]+$/.test(row.errorCode) ? row.errorCode : `FILES_HTTP_${response.status}`, response.status);
  return row;
}
export async function fetchFilesStatus(signal?: AbortSignal): Promise<FilesStatus> {
  const row = await json(await fetch('/api/files/status', { credentials: 'include', signal }));
  if (!['available', 'configuration_required'].includes(row.state) || typeof row.search !== 'boolean' || typeof row.read !== 'boolean' || !object(row.actions)
    || ['open', 'send', 'summarize'].some(k => typeof row.actions[k] !== 'string')) throw new FilesClientError('FILES_STATUS_INVALID');
  return { state: row.state, search: row.search, read: row.read, actions: { open: row.actions.open, send: row.actions.send, summarize: row.actions.summarize } };
}
export async function searchFiles(query: string, signal?: AbortSignal): Promise<{ files: FileEntry[]; truncated: boolean }> {
  if (typeof query !== 'string' || query.length > 160) throw new FilesClientError('FILES_QUERY_INVALID');
  const row = await json(await fetch(`/api/files/search?q=${encodeURIComponent(query)}&limit=100`, { credentials: 'include', signal }));
  if (!Array.isArray(row.files) || row.files.length > 100 || typeof row.truncated !== 'boolean') throw new FilesClientError('FILES_RESPONSE_INVALID');
  return { files: row.files.map(parseFileEntry), truncated: row.truncated };
}
export async function readFileContent(fileId: string, signal?: AbortSignal): Promise<FileContent> {
  const row = await json(await fetch(`/api/files/${id(fileId)}/content`, { credentials: 'include', signal }));
  if (row.id !== fileId || !relative(row.relativePath) || !['workspace', 'artifacts'].includes(row.root) || row.encoding !== 'utf-8'
    || typeof row.text !== 'string' || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > 262144 || row.truncated !== false) throw new FilesClientError('FILES_CONTENT_INVALID');
  return { id: row.id, root: row.root, relativePath: row.relativePath, bytes: row.bytes, text: row.text, truncated: false };
}
export interface NativeFileOpenReceipt {
  operationId: string; fileId: string; ownerBindingId: string; source: 'native_operator';
  openedProcessId: number; verifiedProcessId: number; contentSha256: string; postcondition: 'same_file_opened';
}
export function parseNativeFileOpenResult(value: unknown, requestedFileId: string, expectedDigest?: string): { success: true; completed: true; fileId: string; receipt: NativeFileOpenReceipt } {
  const keys = ['operationId','fileId','ownerBindingId','source','openedProcessId','verifiedProcessId','contentSha256','postcondition'];
  if (!object(value) || value.success !== true || value.completed !== true || value.fileId !== id(requestedFileId)
    || !object(value.receipt)) throw new FilesClientError('FILES_NATIVE_OPEN_UNVERIFIED');
  const r = value.receipt;
  if (Object.keys(r).length !== keys.length || Object.keys(r).some(key => !keys.includes(key))
    || r.fileId !== requestedFileId || r.source !== 'native_operator' || r.postcondition !== 'same_file_opened'
    || typeof r.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(r.operationId)
    || typeof r.ownerBindingId !== 'string' || !/^owner-session-[a-f0-9]{32}$/.test(r.ownerBindingId)
    || typeof r.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.contentSha256)
    || (expectedDigest !== undefined && r.contentSha256 !== expectedDigest)
    || !Number.isSafeInteger(r.openedProcessId) || r.openedProcessId <= 0
    || !Number.isSafeInteger(r.verifiedProcessId) || r.verifiedProcessId !== r.openedProcessId)
    throw new FilesClientError('FILES_NATIVE_OPEN_UNVERIFIED');
  // The server owns nonce/owner authentication and one-time replay protection.
  return { success: true, completed: true, fileId: requestedFileId, receipt: { ...r } as NativeFileOpenReceipt };
}
export interface FileSendResult { fileId: string; transferId: string; descriptor: FileTransferDescriptorV2; completed: false }
const sendIdentity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
const sendDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** Send acceptance carries a pinned descriptor, never a delivery assertion. */
export function parseFileSendDescriptor(value: unknown, requestedDeviceId: string): FileTransferDescriptorV2 {
  const parsed = parseFileTransferDescriptorV2(value);
  const allowed = ['transferId','fileName','mediaType','sizeBytes','sha256','direction','status','sourceDeviceId','targetDeviceId','chunkManifest','encryption','resume','destination','createdAt','updatedAt','contractVersion','amendment'];
  if (!sendIdentity(requestedDeviceId) || parsed.success === false || !object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new FilesClientError('FILES_SEND_DESCRIPTOR_INVALID');
  const descriptor = parsed.value, manifest = descriptor.chunkManifest;
  if (descriptor.contractVersion !== 2 || descriptor.amendment !== '2.1' || !sendIdentity(descriptor.transferId) || descriptor.direction !== 'download'
    || descriptor.targetDeviceId !== requestedDeviceId || !sendIdentity(descriptor.sourceDeviceId) || !sendDigest(descriptor.sha256)
    || descriptor.sizeBytes < 1 || descriptor.sizeBytes > 25 * 1024 * 1024 || !manifest || manifest.contractVersion !== 2 || manifest.amendment !== '2.1'
    || manifest.transferId !== descriptor.transferId || manifest.sizeBytes !== descriptor.sizeBytes || manifest.fileSha256 !== descriptor.sha256
    || manifest.chunkSizeBytes !== 53248 || manifest.totalChunks !== Math.ceil(descriptor.sizeBytes / 53248) || manifest.totalChunks > 512
    || Object.keys(manifest).some(key => !['contractVersion','amendment','transferId','sizeBytes','chunkSizeBytes','totalChunks','fileSha256','chunks','createdAt'].includes(key))
    || manifest.chunks.length !== manifest.totalChunks || manifest.chunks.some((chunk,index) => Object.keys(chunk).length !== 4 || chunk.index !== index || chunk.offsetBytes !== index * 53248
      || chunk.sizeBytes !== Math.min(53248,descriptor.sizeBytes - chunk.offsetBytes) || !sendDigest(chunk.sha256))
    || descriptor.encryption?.algorithm !== 'AES-256-GCM' || descriptor.encryption.authenticated !== true || !sendIdentity(descriptor.encryption.keyId)
    || !sendDigest(descriptor.encryption.keyFingerprint) || !descriptor.resume || !sendIdentity(descriptor.resume.resumeCheckpointId)) throw new FilesClientError('FILES_SEND_DESCRIPTOR_INVALID');
  return structuredClone(descriptor);
}
export function parseFileSendResult(value: unknown, requestedFileId: string, requestedDeviceId: string): FileSendResult {
  if (!object(value) || Object.keys(value).length !== 5 || Object.keys(value).some(key => !['success','fileId','transferId','descriptor','completed'].includes(key))
    || value.success !== true || value.fileId !== id(requestedFileId) || value.completed !== false || !sendIdentity(value.transferId)) throw new FilesClientError('FILES_SEND_RESPONSE_INVALID');
  const descriptor = parseFileSendDescriptor(value.descriptor,requestedDeviceId);
  if (descriptor.transferId !== value.transferId) throw new FilesClientError('FILES_SEND_RESPONSE_INVALID');
  return {fileId:requestedFileId,transferId:descriptor.transferId,descriptor,completed:false};
}
export async function sendFile(fileId: string, options: {deviceId: string; idempotencyKey: string; signal?: AbortSignal}): Promise<FileSendResult> {
  id(fileId);
  if (!options || !sendIdentity(options.deviceId) || !sendIdentity(options.idempotencyKey) || Object.keys(options).some(key => !['deviceId','idempotencyKey','signal'].includes(key))) throw new FilesClientError('FILES_SEND_TARGET_REQUIRED');
  const {deviceId,idempotencyKey,signal}=options;
  if (signal?.aborted) throw new DOMException('Local send view was cancelled.','AbortError');
  const response = await ownerMutationFetch(`/api/files/${fileId}/send`,{method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':idempotencyKey},body:JSON.stringify({deviceId}),signal});
  const row = await json(response);
  if (signal?.aborted) throw new DOMException('Local send view was cancelled.','AbortError');
  if (![200,202].includes(response.status)) throw new FilesClientError('FILES_SEND_RESPONSE_INVALID',response.status);
  return parseFileSendResult(row,fileId,deviceId);
}
export async function actOnFile(fileId: string, action: 'open' | 'send' | 'summarize', options: { provider?: 'ollama' | 'gemini'; allowCloud?: boolean; expectedOpenDigest?: string } = {}) {
  if (action === 'send') throw new FilesClientError('FILES_SEND_TARGET_REQUIRED');
  if (!['open', 'send', 'summarize'].includes(action) || (options.provider !== undefined && !['ollama', 'gemini'].includes(options.provider))) throw new FilesClientError('FILES_ACTION_INVALID');
  if (action === 'summarize' && options.provider === 'gemini' && options.allowCloud !== true) throw new FilesClientError('FILES_CLOUD_CONSENT_REQUIRED');
  const body = action === 'summarize' ? { provider: options.provider ?? 'ollama', ...(options.provider === 'gemini' ? { allowCloud: true } : {}) } : {};
  const row = await json(await ownerMutationFetch(`/api/files/${id(fileId)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  if (action === 'open') return parseNativeFileOpenResult(row, fileId, options.expectedOpenDigest);
  if (action === 'summarize' && (row.fileId !== fileId || row.completed !== true || typeof row.summary !== 'string' || !row.summary || row.summary.length > 16000 || !['ollama', 'gemini'].includes(row.provider))) throw new FilesClientError('FILES_SUMMARY_INVALID');
  return row;
}
export const filesErrorState = (error: unknown): FilesSurfaceState => error instanceof FilesClientError && error.code === 'FILES_CONFIGURATION_REQUIRED' ? 'configuration_required' : error instanceof FilesClientError && error.status >= 500 ? 'degraded' : 'error';

// Explorer exposes bounded public metadata and opaque operation handles only.
export interface ExplorerDirectory { id: string; rootId: 'workspace' | 'artifacts'; name: string; relativePath: string }
export interface ExplorerStatus { nativeConsumerBound: boolean; consumerState: string; physicalAcceptance: false; overwriteAllowed: false }
export interface ExplorerUndoReceipt { undoReceiptId: string; operationId: string; taskId: string; bindingId: string; expiresAt: number }
const explorerIdentity = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(v);
export function parseExplorerDirectory(v: unknown): ExplorerDirectory {
  if (!object(v) || !/^[a-f0-9]{64}$/.test(v.id) || !['workspace','artifacts'].includes(v.rootId)
    || !(v.relativePath === '.' || relative(v.relativePath)) || typeof v.name !== 'string' || !v.name || v.name.length > 255
    || /[\\/:\u0000-\u001f]/.test(v.name) || Object.keys(v).some(key=>!['id','rootId','name','relativePath'].includes(key)))
    throw new FilesClientError('EXPLORER_DIRECTORY_INVALID');
  return {id:v.id,rootId:v.rootId,name:v.name,relativePath:v.relativePath};
}
export async function fetchExplorerDirectories(query = '', signal?: AbortSignal): Promise<{directories: ExplorerDirectory[]; truncated: boolean}> {
  if (query.length > 160) throw new FilesClientError('FILES_QUERY_INVALID');
  const row = await json(await fetch('/api/files/explorer/directories?q='+encodeURIComponent(query)+'&limit=100',{credentials:'include',signal}));
  if (!Array.isArray(row.directories) || row.directories.length > 100 || typeof row.truncated !== 'boolean') throw new FilesClientError('EXPLORER_DIRECTORY_INVALID');
  const directories = row.directories.map(parseExplorerDirectory);
  if (new Set(directories.map(d=>d.id)).size !== directories.length) throw new FilesClientError('EXPLORER_DIRECTORY_INVALID');
  return {directories,truncated:row.truncated};
}
export async function fetchExplorerStatus(signal?: AbortSignal): Promise<ExplorerStatus> {
  const row = await json(await fetch('/api/files/explorer/status',{credentials:'include',signal}));
  if (typeof row.nativeConsumerBound !== 'boolean' || typeof row.consumerState !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.consumerState)
    || row.physicalAcceptance !== false || row.overwriteAllowed !== false) throw new FilesClientError('EXPLORER_STATUS_INVALID');
  return {nativeConsumerBound:row.nativeConsumerBound,consumerState:row.consumerState,physicalAcceptance:false,overwriteAllowed:false};
}
export async function fetchExplorerUndoReceipt(operationId: string, expected: {undoReceiptId: string; taskId: string; bindingId: string}): Promise<ExplorerUndoReceipt> {
  if (!explorerIdentity(operationId) || Object.values(expected).some(v=>!explorerIdentity(v))) throw new FilesClientError('EXPLORER_UNDO_INVALID');
  const row = await json(await fetch('/api/files/explorer/plans/'+encodeURIComponent(operationId),{credentials:'include'}));
  if (row.operationId !== operationId || row.undoReceiptId !== expected.undoReceiptId || row.taskId !== expected.taskId || row.bindingId !== expected.bindingId
    || row.taskBinding !== 'registered' || row.taskState !== 'COMPLETED' || row.state !== 'verified' || row.completed !== true
    || row.verification !== 'independent_filesystem_readback' || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= Date.now())
    throw new FilesClientError('EXPLORER_UNDO_UNAVAILABLE');
  return {operationId,undoReceiptId:row.undoReceiptId,taskId:row.taskId,bindingId:row.bindingId,expiresAt:row.expiresAt};
}
