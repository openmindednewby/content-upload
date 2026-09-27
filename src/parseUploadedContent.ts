import { UploadError } from './UploadError';
import { UploadErrorKind } from './UploadErrorKind';

import type { UploadedContent } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): UploadError {
  return new UploadError(UploadErrorKind.InvalidResponse, message);
}

/** Parse the upload endpoint's JSON body into `UploadedContent`, or throw `InvalidResponse`. */
export function parseUploadedContent(text: string, requireUrl: boolean): UploadedContent {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw invalid('Upload response was not JSON.');
  }
  // `status` is optional: ContentService sends it, the Dloizides.Content.Upload.AspNetCore
  // proxy (`ContentUploadResponse(ContentId, Url)`) does not. Present-but-not-a-string is still malformed.
  const hasBadStatus = isRecord(payload) && payload.status !== undefined && typeof payload.status !== 'string';
  if (!isRecord(payload) || typeof payload.contentId !== 'string' || hasBadStatus) {
    throw invalid('Upload response shape was invalid.');
  }
  const status = typeof payload.status === 'string' ? payload.status : undefined;
  const url = typeof payload.url === 'string' && payload.url !== '' ? payload.url : undefined;
  if (requireUrl && url === undefined) {
    throw invalid('Upload response did not include a public URL.');
  }
  return { contentId: payload.contentId, status, url };
}
