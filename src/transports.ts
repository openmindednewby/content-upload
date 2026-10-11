import { UploadError } from './UploadError';
import { UploadErrorKind } from './UploadErrorKind';

import type { ProgressListener } from './types';

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX_EXCLUSIVE = 300;
export const PERCENT_COMPLETE = 100;

/** A fully built multipart upload, independent of the transport that sends it. */
export interface UploadRequest {
  url: string;
  /** Never contains Content-Type: the runtime sets the multipart boundary for a FormData body. */
  headers: Record<string, string>;
  form: FormData;
  credentials: RequestCredentials;
  signal: AbortSignal | undefined;
}

function isOk(status: number): boolean {
  return status >= HTTP_OK_MIN && status < HTTP_OK_MAX_EXCLUSIVE;
}

function httpError(status: number, body: string): UploadError {
  return new UploadError(UploadErrorKind.Http, `Upload failed (${String(status)}).`, status, body);
}

async function readBodySafely(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function abortedError(): UploadError {
  return new UploadError(UploadErrorKind.Aborted, 'Upload was cancelled.');
}

/** POST with fetch; resolves to the raw response text of a 2xx. */
export async function sendWithFetch(request: UploadRequest, fetchImpl: typeof fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      credentials: request.credentials,
      headers: request.headers,
      body: request.form,
      signal: request.signal,
    });
  } catch (cause) {
    if (request.signal?.aborted === true) {
      throw abortedError();
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new UploadError(UploadErrorKind.Network, detail);
  }
  if (!isOk(response.status)) {
    throw httpError(response.status, await readBodySafely(response));
  }
  return response.text();
}

function reportProgress(event: ProgressEvent, onProgress: ProgressListener): void {
  if (event.lengthComputable && event.total > 0) {
    onProgress(Math.round((event.loaded / event.total) * PERCENT_COMPLETE));
  }
}

/** POST with XMLHttpRequest so upload progress can be observed. */
export function sendWithXhr(
  request: UploadRequest,
  createXhr: () => XMLHttpRequest,
  onProgress: ProgressListener,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { signal } = request;
    if (signal?.aborted === true) {
      reject(abortedError());
      return;
    }
    const xhr = createXhr();
    xhr.upload.addEventListener('progress', (event) => reportProgress(event, onProgress));
    xhr.addEventListener('load', () => {
      if (isOk(xhr.status)) {
        resolve(xhr.responseText);
      } else {
        reject(httpError(xhr.status, xhr.responseText));
      }
    });
    xhr.addEventListener('error', () => reject(new UploadError(UploadErrorKind.Network, 'Upload failed (network error).')));
    xhr.addEventListener('abort', () => reject(abortedError()));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.open('POST', request.url);
    xhr.withCredentials = request.credentials === 'include';
    Object.entries(request.headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.send(request.form);
  });
}

/** Transport selection knobs shared by every upload entry point. */
export interface TransportOptions {
  /** When set (and no `fetchImpl`), the upload goes over XMLHttpRequest to report progress. */
  onProgress?: ProgressListener;
  /** Custom fetch (tests, SSR). Forces the fetch transport. */
  fetchImpl?: typeof fetch;
  /** Custom XMLHttpRequest factory (tests). */
  xhrFactory?: () => XMLHttpRequest;
}

function resolveXhrFactory(options: TransportOptions): (() => XMLHttpRequest) | undefined {
  if (options.fetchImpl !== undefined) {
    return undefined;
  }
  if (options.xhrFactory !== undefined) {
    return options.xhrFactory;
  }
  return typeof XMLHttpRequest === 'undefined' ? undefined : (): XMLHttpRequest => new XMLHttpRequest();
}

/** Send over XMLHttpRequest when progress is wanted and available, else over fetch. */
export async function sendUploadRequest(request: UploadRequest, options: TransportOptions): Promise<string> {
  const { onProgress } = options;
  const createXhr = onProgress === undefined ? undefined : resolveXhrFactory(options);
  if (createXhr !== undefined && onProgress !== undefined) {
    return sendWithXhr(request, createXhr, onProgress);
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return sendWithFetch(request, fetchImpl);
}
