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
