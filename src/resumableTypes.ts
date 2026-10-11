import type { PreviousUpload, UploadOptions } from 'tus-js-client';
import type { ByteReader } from './resumableSource';
import type { ProgressListener } from './types';

/** The part of a tus-js-client `Upload` that `uploadResumable` drives. */
export interface TusUpload {
  url: string | null;
  start(): void;
  abort(shouldTerminate?: boolean): Promise<void>;
  findPreviousUploads(): Promise<PreviousUpload[]>;
  resumeFromPreviousUpload(previousUpload: PreviousUpload): void;
}

/** Builds the tus upload; injectable for tests. */
export type TusUploadFactory = (input: Blob | ByteReader, options: UploadOptions) => TusUpload;

/** Options for `uploadResumable`. Only `endpoint` and `file` are required. */
export interface ResumableUploadOptions {
  /** tus creation endpoint, e.g. `/bff/api/aml/v1/ingest/uploads`. */
  endpoint: string;
  file: Blob;
  /** tus Upload-Metadata; `filename` defaults to `File.name`; `encoding` is always set by the client. */
  metadata?: Record<string, string>;
  /** Gzip the file as a stream (deferred length); falls back to identity when `CompressionStream` is missing. */
  gzip?: boolean;
  /** PATCH body size in bytes. Default 16 MiB (under the BFF 30 MB body limit). */
  chunkSize?: number;
  /** Extra request headers, e.g. the BFF CSRF header. */
  headers?: Record<string, string>;
  /** Send cookies (BFF session). Default `true`. */
  withCredentials?: boolean;
  onProgress?: ProgressListener;
  /** Aborts and terminates the upload; the promise rejects with `UploadErrorKind.Aborted`. */
  signal?: AbortSignal;
  uploadFactory?: TusUploadFactory;
}
