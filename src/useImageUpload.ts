import { useCallback, useEffect, useReducer, useRef } from 'react';

import { PERCENT_COMPLETE } from './transports';
import { toUploadError } from './UploadError';
import { uploadImage } from './uploadImage';
import { UploadStatus } from './UploadStatus';

import type { UploadedContent, UploadImageOptions } from './types';
import type { UploadError } from './UploadError';

/** Options for `useImageUpload`: everything `uploadImage` takes except the per-call wiring. */
export interface UseImageUploadOptions extends Omit<UploadImageOptions, 'signal' | 'onProgress'> {
  onSuccess?: (content: UploadedContent) => void;
  onError?: (error: UploadError) => void;
}

export interface ImageUploadState {
  status: UploadStatus;
  /** 0-100. Stays 0 while uploading when the transport cannot report progress (fetch). */
  progress: number;
  error: UploadError | null;
  result: UploadedContent | null;
}

export interface UseImageUploadResult extends ImageUploadState {
  /** Start an upload (aborting any in-flight one). Resolves to the content, or null on error/abort. */
  upload: (file: Blob, fileName?: string) => Promise<UploadedContent | null>;
  /** Abort any in-flight upload and return to idle. */
  reset: () => void;
}

const IDLE: ImageUploadState = { status: UploadStatus.Idle, progress: 0, error: null, result: null };
const UPLOADING: ImageUploadState = { status: UploadStatus.Uploading, progress: 0, error: null, result: null };

type Action =
  | { type: 'start' }
  | { type: 'progress'; percent: number }
  | { type: 'done'; result: UploadedContent }
  | { type: 'fail'; error: UploadError }
  | { type: 'reset' };

function reducer(state: ImageUploadState, action: Action): ImageUploadState {
  switch (action.type) {
    case 'start':
      return UPLOADING;
    case 'progress':
      return { ...state, progress: action.percent };
    case 'done':
      return { status: UploadStatus.Done, progress: PERCENT_COMPLETE, error: null, result: action.result };
    case 'fail':
      return { ...state, status: UploadStatus.Error, error: action.error };
    default:
      return IDLE;
  }
}

/**
 * One image-upload slot: idle -> uploading -> done | error. Progress is reported when the
 * XMLHttpRequest transport is available (browser, React Native) and no `fetchImpl` is set.
 * A newer `upload()` or `reset()` supersedes the previous request; its late result is dropped.
 * Unmount aborts the in-flight request.
 */
export function useImageUpload(options: UseImageUploadOptions): UseImageUploadResult {
  const [state, dispatch] = useReducer(reducer, IDLE);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const abortInFlight = useCallback((): void => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    requestIdRef.current += 1;
  }, []);

  useEffect(() => abortInFlight, [abortInFlight]);

  const upload = useCallback(async (file: Blob, fileName?: string): Promise<UploadedContent | null> => {
    abortInFlight();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = requestIdRef.current;
    const isCurrent = (): boolean => requestId === requestIdRef.current;
    const { onSuccess, onError, ...uploadOptions } = optionsRef.current;
    dispatch({ type: 'start' });
    try {
      const result = await uploadImage(file, {
        ...uploadOptions,
        fileName: fileName ?? uploadOptions.fileName,
        signal: controller.signal,
        onProgress: (percent) => {
          if (isCurrent()) {
            dispatch({ type: 'progress', percent });
          }
        },
      });
      if (!isCurrent()) {
        return null;
      }
      dispatch({ type: 'done', result });
      onSuccess?.(result);
      return result;
    } catch (cause) {
      if (!isCurrent()) {
        return null;
      }
      const error = toUploadError(cause);
      dispatch({ type: 'fail', error });
      onError?.(error);
      return null;
    }
  }, [abortInFlight]);

  const reset = useCallback((): void => {
    abortInFlight();
    dispatch({ type: 'reset' });
  }, [abortInFlight]);

  return { ...state, upload, reset };
}
