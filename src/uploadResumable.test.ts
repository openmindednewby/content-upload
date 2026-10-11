import { Upload } from 'tus-js-client';

import { UploadError } from './UploadError';
import { UploadErrorKind } from './UploadErrorKind';
import { UploadEncoding } from './UploadEncoding';
import {
  DEFAULT_RESUMABLE_CHUNK_SIZE,
  buildResumableMetadata,
  createTusUpload,
  newestPreviousUpload,
  resumeFingerprint,
  toResumableError,
  uploadIdFromUrl,
  uploadResumable,
} from './uploadResumable';

import type { HttpRequest, PreviousUpload, UploadOptions } from 'tus-js-client';
import type { ResumableUploadOptions, TusUpload } from './resumableTypes';

const ENDPOINT = '/bff/api/aml/v1/ingest/uploads';
const CSRF = { 'X-BFF-Csrf': '1' };

class FakeUpload implements TusUpload {
  url: string | null = null;
  options: UploadOptions | null = null;
  input: unknown = null;
  previous: PreviousUpload[] = [];
  resumedFrom: PreviousUpload | null = null;
  started = false;
  abort = jest.fn((_terminate?: boolean) => Promise.resolve());
  start(): void { this.started = true; }
  findPreviousUploads(): Promise<PreviousUpload[]> { return Promise.resolve(this.previous); }
  resumeFromPreviousUpload(previousUpload: PreviousUpload): void { this.resumedFrom = previousUpload; }
}

function rupepFile(): File {
  return new File(['name,dob\nA,1970'], 'persons.csv', { type: 'text/csv', lastModified: 42 });
}

function previousUpload(creationTime: string): PreviousUpload {
  return { size: 1, metadata: {}, creationTime, urlStorageKey: creationTime, uploadUrl: `${ENDPOINT}/${creationTime}`, parallelUploadUrls: null };
}

function start(fake: FakeUpload, extra: Partial<ResumableUploadOptions> = {}): Promise<string> {
  return uploadResumable({
    endpoint: ENDPOINT,
    file: rupepFile(),
    metadata: { part: 'persons' },
    headers: CSRF,
    uploadFactory: (input, options) => { fake.input = input; fake.options = options; return fake; },
    ...extra,
  });
}

async function started(fake: FakeUpload): Promise<UploadOptions> {
  await Promise.resolve();
  await Promise.resolve();
  expect(fake.options).not.toBeNull();
  return fake.options as UploadOptions;
}

async function caught(promise: Promise<unknown>): Promise<UploadError> {
  const error: unknown = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(UploadError);
  return error as UploadError;
}

describe('uploadResumable', () => {
  it('with default options, sends 16 MiB chunks, identity metadata with the filename and the csrf header', async () => {
    const fake = new FakeUpload();

    void start(fake);

    const options = await started(fake);
    expect(options.chunkSize).toBe(DEFAULT_RESUMABLE_CHUNK_SIZE);
    expect(options.metadata).toEqual({ filename: 'persons.csv', part: 'persons', encoding: UploadEncoding.Identity });
    expect(options.headers).toEqual(CSRF);
    expect(options.uploadLengthDeferred).toBe(false);
    expect(fake.started).toBe(true);
  });

  it('with gzip on a runtime without CompressionStream, falls back to identity and uploads the file itself', async () => {
    const fake = new FakeUpload();
    const file = rupepFile();

    void start(fake, { gzip: true, file });

    const options = await started(fake);
    expect(options.metadata?.encoding).toBe(UploadEncoding.Identity);
    expect(fake.input).toBe(file);
  });

  it('with a successful upload, reports 100 and resolves the last segment of the upload url', async () => {
    const fake = new FakeUpload();
    const onProgress = jest.fn();
    const promise = start(fake, { onProgress });
    const options = await started(fake);
    fake.url = `${ENDPOINT}/abc123`;

    options.onSuccess?.({ lastResponse: null as never });

    await expect(promise).resolves.toBe('abc123');
    expect(onProgress).toHaveBeenLastCalledWith(100);
  });

  it('with progress from tus, reports whole-number percent of the total', async () => {
    const fake = new FakeUpload();
    const onProgress = jest.fn();
    void start(fake, { onProgress });
    const options = await started(fake);

    options.onProgress?.(1, 3);

    expect(onProgress).toHaveBeenCalledWith(33);
  });

  it('with progress from tus and no listener, keeps uploading', async () => {
    const fake = new FakeUpload();
    void start(fake);
    const options = await started(fake);

    const result = options.onProgress?.(1, 3);

    expect(result).toBeUndefined();
  });

  it('with a success but no upload url, rejects with InvalidResponse', async () => {
    const fake = new FakeUpload();
    const promise = start(fake);
    const options = await started(fake);

    options.onSuccess?.({ lastResponse: null as never });

    expect((await caught(promise)).kind).toBe(UploadErrorKind.InvalidResponse);
  });

  it('with a server error from tus, rejects with Http carrying status and body', async () => {
    const fake = new FakeUpload();
    const promise = start(fake);
    const options = await started(fake);
    const error = Object.assign(new Error('tus failed'), { originalResponse: { getStatus: () => 403, getBody: () => 'csrf' } });

    options.onError?.(error);

    const result = await caught(promise);
    expect([result.kind, result.status, result.body]).toEqual([UploadErrorKind.Http, 403, 'csrf']);
  });

  it('with a stored previous upload, resumes the newest one before starting', async () => {
    const fake = new FakeUpload();
    fake.previous = [previousUpload('2026-10-10'), previousUpload('2026-10-11')];

    void start(fake);

    await started(fake);
    expect(fake.resumedFrom?.creationTime).toBe('2026-10-11');
  });

  it('with a lookup failure while resuming, rejects with Network', async () => {
    const fake = new FakeUpload();
    fake.findPreviousUploads = (): Promise<PreviousUpload[]> => Promise.reject(new Error('storage'));

    const result = await caught(start(fake));

    expect(result.kind).toBe(UploadErrorKind.Network);
  });

  it('with the signal aborted mid-upload, terminates the tus upload and rejects with Aborted', async () => {
    const fake = new FakeUpload();
    const controller = new AbortController();
    const promise = start(fake, { signal: controller.signal });
    await started(fake);

    controller.abort();

    expect((await caught(promise)).kind).toBe(UploadErrorKind.Aborted);
    expect(fake.abort).toHaveBeenCalledWith(true);
  });

  it('with a termination request that fails, still rejects with Aborted', async () => {
    const fake = new FakeUpload();
    fake.abort.mockImplementation(() => Promise.reject(new Error('offline')));
    const controller = new AbortController();
    const promise = start(fake, { signal: controller.signal });
    await started(fake);

    controller.abort();

    expect((await caught(promise)).kind).toBe(UploadErrorKind.Aborted);
  });

  it('with no factory given, drives a real tus-js-client upload that the signal can cancel', async () => {
    const controller = new AbortController();
    const promise = uploadResumable({ endpoint: 'http://127.0.0.1:9/uploads', file: new Blob(['a']), signal: controller.signal });

    controller.abort();

    expect((await caught(promise)).kind).toBe(UploadErrorKind.Aborted);
  });

  it('with an already-aborted signal, rejects without creating an upload', async () => {
    const factory = jest.fn();
    const controller = new AbortController();
    controller.abort();

    const result = await caught(uploadResumable({ endpoint: ENDPOINT, file: rupepFile(), signal: controller.signal, uploadFactory: factory }));

    expect([result.kind, factory.mock.calls.length]).toEqual([UploadErrorKind.Aborted, 0]);
  });

  it('with default credentials, sets withCredentials on the underlying request', async () => {
    const fake = new FakeUpload();
    void start(fake);
    const options = await started(fake);
    const xhr = { withCredentials: false };

    await options.onBeforeRequest?.({ getUnderlyingObject: () => xhr } as unknown as HttpRequest);

    expect(xhr.withCredentials).toBe(true);
  });

  it('with an underlying request that is not an object, leaves it alone', async () => {
    const fake = new FakeUpload();
    void start(fake);
    const options = await started(fake);

    const result = options.onBeforeRequest?.({ getUnderlyingObject: () => null } as unknown as HttpRequest);

    expect(result).toBeUndefined();
  });

  it('with withCredentials false and a custom chunk size, installs no request hook and uses that size', async () => {
    const fake = new FakeUpload();

    void start(fake, { withCredentials: false, chunkSize: 1024 });

    const options = await started(fake);
    expect([options.onBeforeRequest, options.chunkSize]).toEqual([undefined, 1024]);
  });

  it('with an identity source, stores the fingerprint for resuming after a reload', async () => {
    const fake = new FakeUpload();

    void start(fake);

    const options = await started(fake);
    expect([options.storeFingerprintForResuming, options.removeFingerprintOnSuccess]).toEqual([true, true]);
  });

  it('with a fingerprint request, resolves the stable resume key', async () => {
    const fake = new FakeUpload();
    void start(fake);
    const options = await started(fake);

    const fingerprint = await options.fingerprint?.(rupepFile(), options);

    expect(fingerprint).toBe(`content-upload|${ENDPOINT}|15|42|encoding=identity&filename=persons.csv&part=persons`);
  });
});

describe('resumeFingerprint', () => {
  it('with different encodings for the same file, returns different keys', () => {
    const file = rupepFile();

    const keys = [UploadEncoding.Gzip, UploadEncoding.Identity].map((encoding) => resumeFingerprint(ENDPOINT, file, { encoding }));

    expect(keys[0]).not.toBe(keys[1]);
  });

  it('with a plain Blob, uses zero as the modification time', () => {
    const key = resumeFingerprint(ENDPOINT, new Blob(['ab']), { encoding: 'identity' });

    expect(key).toBe(`content-upload|${ENDPOINT}|2|0|encoding=identity`);
  });
});

describe('buildResumableMetadata', () => {
  it('with a plain Blob and no metadata, sends only the encoding', () => {
    const metadata = buildResumableMetadata(new Blob(['a']), undefined, UploadEncoding.Gzip);

    expect(metadata).toEqual({ encoding: 'gzip' });
  });

  it('with a caller filename and encoding, keeps the filename and overrides the encoding', () => {
    const metadata = buildResumableMetadata(rupepFile(), { filename: 'x.csv', encoding: 'other' }, UploadEncoding.Identity);

    expect(metadata).toEqual({ filename: 'x.csv', encoding: 'identity' });
  });
});

describe('uploadIdFromUrl', () => {
  it('with a trailing slash and query string, returns the last path segment', () => {
    const id = uploadIdFromUrl(`https://app.example${ENDPOINT}/xyz/?token=1`);

    expect(id).toBe('xyz');
  });

  it('with an empty url, throws InvalidResponse', () => {
    const act = (): string => uploadIdFromUrl('');

    expect(act).toThrow(UploadError);
  });
});

describe('toResumableError', () => {
  it('with no server response, returns Network', () => {
    const error = toResumableError(Object.assign(new Error('offline'), { originalResponse: null }));

    expect([error.kind, error.message]).toEqual([UploadErrorKind.Network, 'offline']);
  });
});

describe('newestPreviousUpload', () => {
  it('with no previous uploads, returns undefined', () => {
    const result = newestPreviousUpload([]);

    expect(result).toBeUndefined();
  });
});

describe('createTusUpload', () => {
  it('with a blob and an endpoint, builds a tus-js-client Upload', () => {
    const upload = createTusUpload(new Blob(['a']), { endpoint: ENDPOINT });

    expect(upload).toBeInstanceOf(Upload);
  });
});
