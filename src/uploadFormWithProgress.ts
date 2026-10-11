import { sendUploadRequest } from './transports';
import { UploadError } from './UploadError';
import { UploadErrorKind } from './UploadErrorKind';

import type { UploadRequest } from './transports';
import type { UploadFormOptions } from './types';

const CONTENT_TYPE_HEADER = 'content-type';
const ACCEPT_HEADER = 'accept';

function buildHeaders(extra: Record<string, string> | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  Object.entries(extra ?? {}).forEach(([name, value]) => {
    if (name.toLowerCase() !== CONTENT_TYPE_HEADER) {headers[name] = value;}
  });
  const hasAccept = Object.keys(headers).some((name) => name.toLowerCase() === ACCEPT_HEADER);
  if (!hasAccept) {headers.Accept = 'application/json';}
  return headers;
}

function buildForm(parts: Record<string, Blob | string>): FormData {
  const form = new FormData();
  Object.entries(parts).forEach(([name, value]) => form.append(name, value));
  return form;
}

/** Build the transport-independent request. Exported so consumers can pin the write shape. */
export function buildFormRequest(options: UploadFormOptions): UploadRequest {
  return {
    url: options.url,
    headers: buildHeaders(options.headers),
    form: buildForm(options.parts),
    credentials: options.withCredentials === false ? 'same-origin' : 'include',
    signal: options.signal,
  };
}

function parseJson<T>(text: string): T | null {
  if (text.trim() === '') {return null;}
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UploadError(UploadErrorKind.InvalidResponse, 'Upload response was not valid JSON.');
  }
}

/**
 * POST arbitrary multipart parts with optional upload progress; resolves the parsed JSON body
 * (`null` for an empty 2xx body).
 *
 * @throws {UploadError} `Http` carries `status` and the raw `body`; switch on `error.kind`.
 */
export async function uploadFormWithProgress<T = unknown>(options: UploadFormOptions): Promise<T | null> {
  const text = await sendUploadRequest(buildFormRequest(options), options);
  return parseJson<T>(text);
}
