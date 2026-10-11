import { Upload } from 'tus-js-client';

import { openResumableSource, resumablePercent } from './resumableSource';
import { PERCENT_COMPLETE } from './transports';
import { UploadError, toUploadError } from './UploadError';
import { UploadErrorKind } from './UploadErrorKind';

import type { HttpRequest, PreviousUpload, UploadOptions } from 'tus-js-client';
import type { ResumableSource } from './resumableSource';
import type { ResumableUploadOptions, TusUpload, TusUploadFactory } from './resumableTypes';
import type { UploadEncoding } from './UploadEncoding';

const MEBIBYTE = 1024 * 1024;
const DEFAULT_CHUNK_MEBIBYTES = 16;
export const DEFAULT_RESUMABLE_CHUNK_SIZE = DEFAULT_CHUNK_MEBIBYTES * MEBIBYTE;

export const createTusUpload: TusUploadFactory = (input, options) => new Upload(input, options);

interface UploadCallbacks {
  onProgress: (bytesSent: number, bytesTotal: number) => void;
  onSuccess: () => void;
  onError: (error: Error) => void;
}

interface TusResponse {
  getStatus(): number;
  getBody(): string;
}

/** Upload-Metadata sent on creation: `filename` from the File unless given, `encoding` always from the source. */
export function buildResumableMetadata(file: Blob, metadata: Record<string, string> | undefined, encoding: UploadEncoding): Record<string, string> {
  const defaults: Record<string, string> = file instanceof File ? { filename: file.name } : {};
  return { ...defaults, ...metadata, encoding };
}

/** Stable resume key: the same endpoint, file identity and metadata resume the same tus upload. */
export function resumeFingerprint(endpoint: string, file: Blob, metadata: Record<string, string>): string {
  const lastModified = file instanceof File ? file.lastModified : 0;
  const entries = Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`);
  return ['content-upload', endpoint, String(file.size), String(lastModified), entries.join('&')].join('|');
}

function sendCookies(request: HttpRequest): void {
  const underlying = request.getUnderlyingObject() as { withCredentials?: boolean } | null;
  if (underlying !== null && typeof underlying === 'object') {underlying.withCredentials = true;}
}

/** The tus-js-client options for one upload. Exported so consumers can pin the request shape. */
export function buildTusOptions(options: ResumableUploadOptions, source: ResumableSource, callbacks: UploadCallbacks): UploadOptions {
  const metadata = buildResumableMetadata(options.file, options.metadata, source.encoding);
  const fingerprint = resumeFingerprint(options.endpoint, options.file, metadata);
  return {
    endpoint: options.endpoint,
    chunkSize: options.chunkSize ?? DEFAULT_RESUMABLE_CHUNK_SIZE,
    metadata,
    headers: { ...options.headers },
    uploadLengthDeferred: source.lengthDeferred,
    fingerprint: () => Promise.resolve(fingerprint),
    storeFingerprintForResuming: !source.lengthDeferred,
    removeFingerprintOnSuccess: true,
    onBeforeRequest: options.withCredentials === false ? undefined : sendCookies,
    ...callbacks,
  };
}

/** The upload id is the last path segment of the tus upload URL (the BFF-rewritten Location). */
export function uploadIdFromUrl(url: string | null): string {
  const path = (url ?? '').split('?', 1).join('');
  const id = path.split('/').filter((segment) => segment !== '').pop();
  if (id === undefined) {throw new UploadError(UploadErrorKind.InvalidResponse, 'tus upload finished without an upload URL.');}
  return id;
}

/** Map a tus-js-client failure to `UploadError`: a server answer is `Http`, anything else `Network`. */
export function toResumableError(error: Error): UploadError {
  const response = (error as { originalResponse?: TusResponse | null }).originalResponse;
  if (response === undefined || response === null) {return toUploadError(error);}
  const status = response.getStatus();
  return new UploadError(UploadErrorKind.Http, `Upload failed (${String(status)}).`, status, response.getBody());
}

/** The previous upload with the newest `creationTime`, if any. */
export function newestPreviousUpload(previous: PreviousUpload[]): PreviousUpload | undefined {
  return [...previous].sort((a, b) => b.creationTime.localeCompare(a.creationTime))[0];
}

async function startOrResume(upload: TusUpload, source: ResumableSource): Promise<void> {
  if (!source.lengthDeferred) {
    const previous = newestPreviousUpload(await upload.findPreviousUploads());
    if (previous !== undefined) {upload.resumeFromPreviousUpload(previous);}
  }
  upload.start();
}

function abortedError(): UploadError {
  return new UploadError(UploadErrorKind.Aborted, 'Upload was cancelled.');
}

/** tus 1.0 upload (16 MiB chunks, optional streamed gzip); identity resumes across reloads, gzip only in-session. */
export function uploadResumable(options: ResumableUploadOptions): Promise<string> {
  if (options.signal?.aborted === true) {return Promise.reject(abortedError());}
  const source = openResumableSource(options.file, options.gzip === true);
  const factory = options.uploadFactory ?? createTusUpload;
  return new Promise<string>((resolve, reject) => {
    const settle = (finish: () => void): void => {
      options.signal?.removeEventListener('abort', onAbort);
      finish();
    };
    const upload = factory(source.input, buildTusOptions(options, source, {
      onProgress: (sent, total) => options.onProgress?.(resumablePercent(source, options.file.size, sent, total)),
      onSuccess: () => settle(() => {
        options.onProgress?.(PERCENT_COMPLETE);
        try { resolve(uploadIdFromUrl(upload.url)); } catch (error) { reject(error); }
      }),
      onError: (error) => settle(() => reject(toResumableError(error))),
    }));
    function onAbort(): void {
      settle(() => reject(abortedError()));
      upload.abort(true).catch(() => undefined);
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    startOrResume(upload, source).catch((error: unknown) => settle(() => reject(toUploadError(error))));
  });
}
