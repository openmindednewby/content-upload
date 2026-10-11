import type { TransportOptions } from './transports';

/** A header the BFF anti-forgery middleware requires on mutating requests. */
export interface CsrfHeader {
  name: string;
  value: string;
}

/** Body returned by the ContentService upload endpoint. */
export interface UploadedContent {
  /** Stable id of the persisted content row. */
  contentId: string;
  /** Server status (e.g. "Active"); absent from the Dloizides.Content.Upload.AspNetCore proxy body. */
  status?: string;
  /** Public download URL; present when the upload was public. */
  url?: string;
}

/** Receives whole-number upload progress, 0-100. */
export type ProgressListener = (percent: number) => void;

/** Options for `uploadImage`. Only `endpoint` is required. */
export interface UploadImageOptions extends TransportOptions {
  /** Same-origin URL of the upload endpoint, e.g. `/bff/api/content/api/v1/content/upload`. */
  endpoint: string;
  /** Filename sent with the file part. Defaults to `File.name`, else `"upload"`. */
  fileName?: string;
  /** ContentService `Category` form field. Default `"Image"`. */
  category?: string;
  /** ContentService `IsPublic` form field. Default `true`. */
  isPublic?: boolean;
  /** Reject a 2xx body without `url`. Defaults to the value of `isPublic`. */
  requireUrl?: boolean;
  /** Anti-forgery header. Default `X-BFF-Csrf: 1`; pass `null` to send none. */
  csrf?: CsrfHeader | null;
  /** Fetch credentials mode. Default `"include"` (BFF session cookie). */
  credentials?: RequestCredentials;
  /** Reject files larger than this many bytes before sending. */
  maxBytes?: number;
  /** Reject files whose MIME type is not in this list before sending. */
  allowedTypes?: readonly string[];
  /** Aborts the request; the promise rejects with `UploadErrorKind.Aborted`. */
  signal?: AbortSignal;
}

/** Options for `uploadFormWithProgress`. Only `url` and `parts` are required. */
export interface UploadFormOptions extends TransportOptions {
  /** Upload endpoint, e.g. a same-origin BFF route. */
  url: string;
  /** Multipart fields in insertion order; a Blob/File becomes a file part. */
  parts: Record<string, Blob | string>;
  /** Extra headers (e.g. a CSRF header). Any Content-Type is dropped: the runtime sets the boundary. */
  headers?: Record<string, string>;
  /** Send cookies (BFF session). Default `true`. */
  withCredentials?: boolean;
  /** Aborts the request; the promise rejects with `UploadErrorKind.Aborted`. */
  signal?: AbortSignal;
}
