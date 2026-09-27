/** Why an upload failed. Consumers map this to translated copy; `message` is developer-facing only. */
export const enum UploadErrorKind {
  /** Rejected client-side before any request: empty file, too large, disallowed MIME type. */
  Validation = 'validation',
  /** The request never produced an HTTP response (offline, DNS, CORS). */
  Network = 'network',
  /** The server answered outside 2xx; `status` carries the code. */
  Http = 'http',
  /** The caller aborted (AbortSignal / hook reset). */
  Aborted = 'aborted',
  /** 2xx, but the body was not `{ contentId, status, url? }` (or lacked a required url). */
  InvalidResponse = 'invalid-response',
}
