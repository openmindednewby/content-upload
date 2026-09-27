# Changelog

## 1.0.0

Initial release (KEFI-PEOPLE-1 "Organizer people editor", task T3).

- `uploadImage(file, options)`: multipart POST to a consumer-supplied endpoint; CSRF header,
  credentials, client-side validation (empty / `maxBytes` / `allowedTypes`), abort, progress over
  XMLHttpRequest, typed `UploadError` with `UploadErrorKind`.
- `buildUploadRequest` for pinning the write shape (no Content-Type on FormData).
- `blobFromUri(uri)`.
- `useImageUpload(options)` hook: `UploadStatus` idle / uploading / error / done, progress,
  supersede-on-new-upload, abort on reset and unmount.
