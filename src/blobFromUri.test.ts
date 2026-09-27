import { fakeResponse } from '../test/doubles';
import { blobFromUri } from './blobFromUri';
import { UploadError } from './UploadError';
import { UploadErrorKind } from './UploadErrorKind';
import { toUploadError } from './UploadError';

describe('blobFromUri', () => {
  it('returns the blob of a readable uri', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeResponse(200, 'abc')));
    const blob = await blobFromUri('blob:x', fetchImpl);
    expect(blob.size).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith('blob:x');
  });

  it('maps an unreadable uri (throw or non-ok) to Validation', async () => {
    const thrown = await blobFromUri('file:x', jest.fn(() => Promise.reject(new Error('gone')))).catch((e: unknown) => e);
    expect((thrown as UploadError).kind).toBe(UploadErrorKind.Validation);
    const thrownString = await blobFromUri('file:x', jest.fn(() => Promise.reject('gone'))).catch((e: unknown) => e);
    expect((thrownString as UploadError).message).toContain('gone');
    const notOk = await blobFromUri('file:x', jest.fn(() => Promise.resolve(fakeResponse(404, '')))).catch((e: unknown) => e);
    expect((notOk as UploadError).kind).toBe(UploadErrorKind.Validation);
  });

  it('uses the global fetch by default', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = jest.fn(() => Promise.resolve(fakeResponse(200, 'a'))) as unknown as typeof fetch;
    try {
      await expect(blobFromUri('data:x')).resolves.toBeDefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('toUploadError', () => {
  it('passes UploadError through and wraps anything else as Network', () => {
    const own = new UploadError(UploadErrorKind.Http, 'x', 500);
    expect(toUploadError(own)).toBe(own);
    expect(toUploadError(new Error('e'))).toMatchObject({ kind: UploadErrorKind.Network, message: 'e', status: undefined });
    expect(toUploadError('s')).toMatchObject({ kind: UploadErrorKind.Network, message: 's', name: 'UploadError' });
  });
});
