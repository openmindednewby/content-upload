# Changelog

## 1.2.0

RUPEP-5 "Upload the RuPEP file from the Jobs tab" -- resumable tus upload.

- `uploadResumable({ endpoint, file, metadata?, gzip?, chunkSize?, headers?, withCredentials?, onProgress?, signal?, uploadFactory? })`
  resolves the tus upload id (last segment of the upload URL). Built on `tus-js-client` 4 (MIT).
- 16 MiB chunks by default; cookies sent (`withCredentials`) unless `withCredentials: false`; `headers` carry the CSRF header.
- `gzip: true` compresses with `CompressionStream` as a stream and uses tus deferred length (`encoding=gzip`).
  Where `CompressionStream` is missing the file is uploaded as-is with `encoding=identity`.
- Resume: a fingerprint of endpoint + size + lastModified + metadata is stored; the newest stored upload is resumed.
  A gzip resume re-compresses from the start and skips the bytes already on the server (same engine = same bytes).
- `signal` abort terminates the server upload (tus termination) and rejects with `UploadErrorKind.Aborted`.
- Progress for gzip uploads counts source bytes read and holds at 99 until the upload finishes.

## 1.1.0

RUPEP-5 "Upload the RuPEP file from the Jobs tab".

- `uploadFormWithProgress({ url, parts, headers?, onProgress?, signal?, withCredentials?, fetchImpl?, xhrFactory? })`:
  generic multipart POST with progress; resolves parsed JSON (`null` for an empty 2xx body).
  Credentials default to `include`; any Content-Type header is dropped; CSRF goes in `headers`.
- `buildFormRequest(options)` to pin the write shape.
- `UploadError.body` carries the raw response body of an `Http` failure (both transports).
- `uploadImage` now shares the transport selection (`sendUploadRequest`); behaviour unchanged.

## 1.0.0

Initial release (KEFI-PEOPLE-1 "Organizer people editor", task T3).

- `uploadImage(file, options)`: multipart POST to a consumer-supplied endpoint; CSRF header,
  credentials, client-side validation (empty / `maxBytes` / `allowedTypes`), abort, progress over
  XMLHttpRequest, typed `UploadError` with `UploadErrorKind`.
- `buildUploadRequest` for pinning the write shape (no Content-Type on FormData).
- `blobFromUri(uri)`.
- `useImageUpload(options)` hook: `UploadStatus` idle / uploading / error / done, progress,
  supersede-on-new-upload, abort on reset and unmount.
