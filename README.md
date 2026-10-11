# @dloizides/content-upload

Image upload for the dloizides.com RN-web portals: one multipart POST to the ContentService
through a same-origin BFF proxy, plus a React hook with `idle / uploading / error / done` states.
Merged from kefi-web `uploadContent.ts` and katalogos-web `useUploadContent.ts`.

## Install

```bash
npm install @dloizides/content-upload
```

Peer dependency: `react >= 18` (only for the hook).

## Client

```ts
import { uploadImage, UploadError, UploadErrorKind } from '@dloizides/content-upload';

const content = await uploadImage(file, {
  endpoint: '/bff/api/content/api/v1/content/upload', // consumer-supplied
  maxBytes: 5 * 1024 * 1024,
  allowedTypes: ['image/png', 'image/jpeg', 'image/webp'],
});
// content = { contentId, status, url }
```

The request is `multipart/form-data` with fields `File`, `Category` (default `Image`) and
`IsPublic` (default `true`), `credentials: 'include'` and the `X-BFF-Csrf: 1` anti-forgery header
(`csrf: null` disables it, `csrf: { name, value }` replaces it). **No Content-Type is ever set**:
the runtime adds the multipart boundary, and a JSON content type on a FormData body is a 415 (the
same rule `@dloizides/bff-web-client`'s `writeContentTypeGuard` enforces for axios).

Every failure throws `UploadError` with a `kind`: `Validation`, `Network`, `Http` (`status` set),
`Aborted`, `InvalidResponse`. Map `kind` to translated copy; `message` is developer-facing.

Transport: with `onProgress` and no `fetchImpl`, the upload uses `XMLHttpRequest` (the only
transport that reports upload progress, available in browsers and React Native). Otherwise it
uses `fetch`. `signal` aborts either.

`blobFromUri(uri)` reads a `blob:` / `data:` / RN picker `file:` URI into a `Blob`.

## Generic multipart upload with progress

```ts
import { uploadFormWithProgress, UploadError, UploadErrorKind } from '@dloizides/content-upload';

const result = await uploadFormWithProgress<{ jobId: string }>({
  url: '/bff/api/aml/admin/jobs/rupep/upload',
  parts: { file },
  headers: { 'X-BFF-Csrf': '1' },
  onProgress: (pct) => setPct(pct),
  signal: controller.signal,
});
```

Cookies are sent by default (`withCredentials: false` to opt out). A Content-Type header is
dropped. An `Http` failure carries `error.status` and the raw `error.body`; an empty 2xx body
resolves `null`.

## Hook

```ts
import { useImageUpload, UploadStatus } from '@dloizides/content-upload';

const { status, progress, error, result, upload, reset } = useImageUpload({
  endpoint: '/bff/api/content/api/v1/content/upload',
  onSuccess: (content) => setAvatarUrl(content.url),
});

await upload(file); // resolves to the content, or null on error / abort
```

- A new `upload()` or `reset()` aborts the in-flight request; its late result is dropped.
- Unmount aborts the in-flight request.
- Options are read at call time, so an inline options object is fine.

## Scripts

`npm run lint` · `npm run typecheck` · `npm run test:coverage` (100% threshold) · `npm run build`.
Publish only via `./publish.ps1 -Bump <patch|minor|major>`.

## Resumable upload (tus)

```ts
const id = await uploadResumable({
  endpoint: '/bff/api/aml/v1/ingest/uploads',
  file,
  metadata: { part: 'persons' },
  gzip: true,
  headers: { 'X-BFF-Csrf': '1' },
  onProgress: setPercent,
  signal: controller.signal,
});
```

- tus 1.0 via `tus-js-client`; 16 MiB chunks; cookies sent by default.
- `gzip: true` streams through `CompressionStream` with deferred length (`encoding=gzip`); without
  `CompressionStream` the file goes up uncompressed (`encoding=identity`). The server reads `encoding`.
- Identity uploads interrupted by a reload resume from a stored fingerprint on the next call with the same
  file and metadata. Gzip uploads do not (re-compressed bytes are not guaranteed identical); they retry failed
  chunks in-session only. `isResumableAcrossReload(gzip)` tells a UI which applies.
- Aborting terminates the server-side upload.
