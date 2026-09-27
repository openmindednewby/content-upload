import { parseUploadedContent } from './parseUploadedContent';
import { sendWithFetch, sendWithXhr } from './transports';
import { UploadError } from './UploadError';
import { UploadErrorKind } from './UploadErrorKind';

import type { UploadRequest } from './transports';
import type { CsrfHeader, UploadedContent, UploadImageOptions } from './types';

/** The Bff.AspNetCore anti-forgery convention: header presence, any value. */
export const DEFAULT_CSRF_HEADER: CsrfHeader = { name: 'X-BFF-Csrf', value: '1' };

const DEFAULT_CATEGORY = 'Image';
const DEFAULT_FILE_NAME = 'upload';
const FILE_FIELD = 'File';
const CATEGORY_FIELD = 'Category';
const IS_PUBLIC_FIELD = 'IsPublic';

function validationError(message: string): UploadError {
  return new UploadError(UploadErrorKind.Validation, message);
}

/** Client-side checks that must fail before a byte leaves the device. */
function validate(file: Blob, options: UploadImageOptions): void {
  if (file.size === 0) {
    throw validationError('File is empty.');
  }
  if (options.maxBytes !== undefined && file.size > options.maxBytes) {
    throw validationError(`File is ${String(file.size)} bytes; the limit is ${String(options.maxBytes)}.`);
  }
  if (options.allowedTypes !== undefined && !options.allowedTypes.includes(file.type)) {
    throw validationError(`File type "${file.type}" is not allowed.`);
  }
}

function resolveFileName(file: Blob, explicit: string | undefined): string {
  if (explicit !== undefined && explicit !== '') {
    return explicit;
  }
  if ('name' in file && typeof file.name === 'string' && file.name !== '') {
    return file.name;
  }
  return DEFAULT_FILE_NAME;
}

function buildHeaders(csrf: CsrfHeader | null | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const header = csrf === undefined ? DEFAULT_CSRF_HEADER : csrf;
  if (header !== null) {
    headers[header.name] = header.value;
  }
  return headers;
}

/** Build the transport-independent request. Exported so consumers can pin the write shape. */
export function buildUploadRequest(file: Blob, options: UploadImageOptions): UploadRequest {
  const form = new FormData();
  form.append(FILE_FIELD, file, resolveFileName(file, options.fileName));
  form.append(CATEGORY_FIELD, options.category ?? DEFAULT_CATEGORY);
  form.append(IS_PUBLIC_FIELD, String(options.isPublic ?? true));
  return {
    url: options.endpoint,
    headers: buildHeaders(options.csrf),
    form,
    credentials: options.credentials ?? 'include',
    signal: options.signal,
  };
}

function resolveXhrFactory(options: UploadImageOptions): (() => XMLHttpRequest) | undefined {
  if (options.fetchImpl !== undefined) {
    return undefined;
  }
  if (options.xhrFactory !== undefined) {
    return options.xhrFactory;
  }
  return typeof XMLHttpRequest === 'undefined' ? undefined : (): XMLHttpRequest => new XMLHttpRequest();
}

async function send(request: UploadRequest, options: UploadImageOptions): Promise<string> {
  const { onProgress } = options;
  const createXhr = onProgress === undefined ? undefined : resolveXhrFactory(options);
  if (createXhr !== undefined && onProgress !== undefined) {
    return sendWithXhr(request, createXhr, onProgress);
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return sendWithFetch(request, fetchImpl);
}

/**
 * Upload one image as multipart/form-data (`File`, `Category`, `IsPublic`) to a
 * consumer-supplied endpoint and return the parsed `{ contentId, status?, url }`.
 *
 * Never sets Content-Type: the runtime adds the multipart boundary, and a JSON content type
 * on a FormData body is a 415 (see `@dloizides/bff-web-client` writeContentTypeGuard).
 *
 * @throws {UploadError} for every failure; switch on `error.kind`.
 */
export async function uploadImage(file: Blob, options: UploadImageOptions): Promise<UploadedContent> {
  validate(file, options);
  const request = buildUploadRequest(file, options);
  const text = await send(request, options);
  return parseUploadedContent(text, options.requireUrl ?? options.isPublic ?? true);
}
