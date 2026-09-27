import { UploadErrorKind } from './UploadErrorKind';

/** The single error type thrown by `uploadImage` and surfaced by `useImageUpload`. */
export class UploadError extends Error {
  readonly kind: UploadErrorKind;
  /** HTTP status for `UploadErrorKind.Http`; undefined otherwise. */
  readonly status: number | undefined;

  constructor(kind: UploadErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'UploadError';
    this.kind = kind;
    this.status = status;
  }
}

/** Normalise anything thrown into an `UploadError` (unknown throws become `Network`). */
export function toUploadError(cause: unknown): UploadError {
  if (cause instanceof UploadError) {
    return cause;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return new UploadError(UploadErrorKind.Network, message);
}
