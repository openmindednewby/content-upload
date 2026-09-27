/** A header the BFF anti-forgery middleware requires on mutating requests. */
export interface CsrfHeader {
  name: string;
  value: string;
}

/** Body returned by the ContentService upload endpoint. */
export interface UploadedContent {
  /** Stable id of the persisted content row. */
  contentId: string;
  /** Server status (e.g. "Active"). */
  status: string;
  /** Public download URL; present when the upload was public. */
  url?: string;
}

/** Receives whole-number upload progress, 0-100. */
export type ProgressListener = (percent: number) => void;

/** Options for `uploadImage`. Only `endpoint` is required. */
export interface UploadImageOptions {
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
  /**
   * Progress listener. When set (and no `fetchImpl` is given) the upload goes over
   * XMLHttpRequest, the only browser/RN transport that reports upload progress.
   */
  onProgress?: ProgressListener;
  /** Custom fetch (tests, SSR). Forces the fetch transport. */
  fetchImpl?: typeof fetch;
  /** Custom XMLHttpRequest factory (tests). */
  xhrFactory?: () => XMLHttpRequest;
}
