import { UploadError } from './UploadError';
import { UploadErrorKind } from './UploadErrorKind';

/**
 * Read a local URI (`blob:`, `data:`, or an RN image-picker `file:` URI) into a Blob so it
 * can be passed to `uploadImage`.
 *
 * @throws {UploadError} `Validation` when the URI cannot be read.
 */
export async function blobFromUri(uri: string, fetchImpl?: typeof fetch): Promise<Blob> {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await doFetch(uri);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new UploadError(UploadErrorKind.Validation, `Could not read file: ${detail}`);
  }
  if (!response.ok) {
    throw new UploadError(UploadErrorKind.Validation, `Could not read file (${String(response.status)}).`);
  }
  return response.blob();
}
