import { buildTusOptions, retryAndNotify } from './uploadResumable';

import type { ResumableSource } from './resumableSource';

function failure(status: number | null): Error {
  const error = new Error('failed') as Error & { originalResponse: { getStatus: () => number; getBody: () => string } | null };
  error.originalResponse = status === null ? null : { getStatus: () => status, getBody: () => '' };
  return error;
}

describe('retryAndNotify', () => {
  it('with a network failure and no response, retries and reports it', () => {
    const onRetry = jest.fn();
    const shouldRetry = retryAndNotify(onRetry);

    const retry = shouldRetry(failure(null));

    expect([retry, onRetry.mock.calls.length]).toEqual([true, 1]);
  });

  it('with a 403, does not retry and reports nothing', () => {
    const onRetry = jest.fn();
    const shouldRetry = retryAndNotify(onRetry);

    const retry = shouldRetry(failure(403));

    expect([retry, onRetry.mock.calls.length]).toEqual([false, 0]);
  });

  it('with a 409 conflict, retries', () => {
    const onRetry = jest.fn();
    const shouldRetry = retryAndNotify(onRetry);

    const retry = shouldRetry(failure(409));

    expect(retry).toBe(true);
  });

  it('with a 503, retries', () => {
    const onRetry = jest.fn();
    const shouldRetry = retryAndNotify(onRetry);

    const retry = shouldRetry(failure(503));

    expect(retry).toBe(true);
  });
});

describe('buildTusOptions', () => {
  it('with onRetry, passes an onShouldRetry to tus', () => {
    const file = new Blob(['a']);
    const source = { input: file, encoding: 'identity', lengthDeferred: false } as unknown as ResumableSource;
    const callbacks = { onProgress: jest.fn(), onSuccess: jest.fn(), onError: jest.fn() };

    const tus = buildTusOptions({ endpoint: '/uploads', file, onRetry: jest.fn() }, source, callbacks);

    expect(typeof tus.onShouldRetry).toBe('function');
  });

  it('without onRetry, leaves the tus default retry rule', () => {
    const file = new Blob(['a']);
    const source = { input: file, encoding: 'identity', lengthDeferred: false } as unknown as ResumableSource;
    const callbacks = { onProgress: jest.fn(), onSuccess: jest.fn(), onError: jest.fn() };

    const tus = buildTusOptions({ endpoint: '/uploads', file }, source, callbacks);

    expect(tus.onShouldRetry).toBeUndefined();
  });
});
