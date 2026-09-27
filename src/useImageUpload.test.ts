import { act, renderHook } from '@testing-library/react';

import { FakeXhr, OK_BODY, fakeResponse, imageFile } from '../test/doubles';
import { UploadErrorKind } from './UploadErrorKind';
import { UploadStatus } from './UploadStatus';
import { useImageUpload } from './useImageUpload';

import type { UseImageUploadOptions } from './useImageUpload';

const ENDPOINT = '/upload';

function xhrQueue(): { factory: () => XMLHttpRequest; created: FakeXhr[] } {
  const created: FakeXhr[] = [];
  return {
    created,
    factory: () => {
      const xhr = new FakeXhr();
      created.push(xhr);
      return xhr as unknown as XMLHttpRequest;
    },
  };
}

describe('useImageUpload', () => {
  it('goes idle -> uploading (with progress) -> done and calls onSuccess', async () => {
    const { factory, created } = xhrQueue();
    const onSuccess = jest.fn();
    const { result } = renderHook(() => useImageUpload({ endpoint: ENDPOINT, xhrFactory: factory, onSuccess }));
    expect(result.current.status).toBe(UploadStatus.Idle);

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.upload(imageFile(), 'named.png');
    });
    expect(result.current.status).toBe(UploadStatus.Uploading);
    act(() => created[0].progress(1, 2));
    expect(result.current.progress).toBe(50);

    await act(async () => {
      created[0].respond(200, OK_BODY);
      await pending;
    });
    expect(result.current.status).toBe(UploadStatus.Done);
    expect(result.current.progress).toBe(100);
    expect(result.current.result).toMatchObject({ contentId: 'c-1' });
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'c-1' }));
    expect(await pending).toMatchObject({ contentId: 'c-1' });
  });

  it('goes to error, resolves null and calls onError with the typed error', async () => {
    const onError = jest.fn();
    const fetchImpl = jest.fn(() => Promise.resolve(fakeResponse(413, '')));
    const { result } = renderHook(() => useImageUpload({ endpoint: ENDPOINT, fetchImpl, onError }));
    let value: unknown = 'unset';
    await act(async () => {
      value = await result.current.upload(imageFile());
    });
    expect(value).toBeNull();
    expect(result.current.status).toBe(UploadStatus.Error);
    expect(result.current.error).toMatchObject({ kind: UploadErrorKind.Http, status: 413 });
    expect(onError).toHaveBeenCalledWith(result.current.error);
  });

  it('works without callbacks', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeResponse(200, OK_BODY)));
    const { result } = renderHook(() => useImageUpload({ endpoint: ENDPOINT, fetchImpl }));
    await act(async () => {
      await result.current.upload(imageFile());
    });
    expect(result.current.status).toBe(UploadStatus.Done);
    const failing = renderHook(() => useImageUpload({ endpoint: ENDPOINT, fetchImpl, maxBytes: 1 }));
    await act(async () => {
      await failing.result.current.upload(imageFile());
    });
    expect(failing.result.current.error?.kind).toBe(UploadErrorKind.Validation);
  });

  it('reset aborts the in-flight upload, returns to idle and drops its late result', async () => {
    const { factory, created } = xhrQueue();
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const { result } = renderHook(() => useImageUpload({ endpoint: ENDPOINT, xhrFactory: factory, onSuccess, onError }));
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.upload(imageFile());
    });
    await act(async () => {
      result.current.reset();
      expect(await pending).toBeNull();
    });
    expect(result.current.status).toBe(UploadStatus.Idle);
    expect(onError).not.toHaveBeenCalled();
    act(() => created[0].progress(1, 1));
    expect(result.current.progress).toBe(0);
  });

  it('a second upload supersedes the first; the first late success is ignored', async () => {
    const { factory, created } = xhrQueue();
    const onSuccess = jest.fn();
    const { result } = renderHook(() => useImageUpload({ endpoint: ENDPOINT, xhrFactory: factory, onSuccess }));
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.upload(imageFile());
    });
    act(() => {
      second = result.current.upload(imageFile());
    });
    await act(async () => {
      expect(await first).toBeNull();
      created[1].respond(200, OK_BODY);
      await second;
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe(UploadStatus.Done);
  });

  it('drops a success that lands after reset', async () => {
    let resolveFetch: (r: Response) => void = () => undefined;
    const fetchImpl = jest.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const onSuccess = jest.fn();
    const { result } = renderHook(() => useImageUpload({ endpoint: ENDPOINT, fetchImpl, onSuccess }));
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.upload(imageFile());
    });
    act(() => result.current.reset());
    await act(async () => {
      resolveFetch(fakeResponse(200, OK_BODY));
      expect(await pending).toBeNull();
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.status).toBe(UploadStatus.Idle);
  });

  it('reads the latest options at upload time and aborts on unmount', async () => {
    const { factory, created } = xhrQueue();
    const initial: UseImageUploadOptions = { endpoint: '/old', xhrFactory: factory };
    const { result, rerender, unmount } = renderHook((props: UseImageUploadOptions) => useImageUpload(props), { initialProps: initial });
    rerender({ endpoint: '/new', xhrFactory: factory });
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.upload(imageFile());
    });
    expect(created[0].url).toBe('/new');
    unmount();
    expect(await pending).toBeNull();
  });
});
