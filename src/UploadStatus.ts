/** Lifecycle of a single `useImageUpload` slot. */
export const enum UploadStatus {
  Idle = 'idle',
  Uploading = 'uploading',
  Error = 'error',
  Done = 'done',
}
