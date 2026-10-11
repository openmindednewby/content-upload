import { FakeXhr, fakeResponse, imageFile } from '../test/doubles';
import { UploadError } from './UploadError';
import { UploadErrorKind } from './UploadErrorKind';
import { buildFormRequest, uploadFormWithProgress } from './uploadFormWithProgress';

const URL = '/bff/api/aml/admin/jobs/rupep/upload';

async function caught(promise: Promise<unknown>): Promise<UploadError> {
  const error: unknown = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(UploadError);
  return error as UploadError;
}

function xhrOptions(xhr: FakeXhr): { xhrFactory: () => XMLHttpRequest } {
  return { xhrFactory: () => xhr as unknown as XMLHttpRequest };
}

describe('buildFormRequest', () => {
  it('with a file and string parts, appends every part in order', () => {
    const file = imageFile('rupep.zip', 'application/zip');

    const { form } = buildFormRequest({ url: URL, parts: { file, mode: 'full' } });

    expect([...form.keys()]).toEqual(['file', 'mode']);
    expect((form.get('file') as File).name).toBe('rupep.zip');
    expect(form.get('mode')).toBe('full');
  });

  it('with a Content-Type in headers, drops it and keeps the csrf header', () => {
    const headers = { 'content-type': 'application/json', 'X-BFF-Csrf': '1' };

    const request = buildFormRequest({ url: URL, parts: {}, headers });

    expect(request.headers).toEqual({ 'X-BFF-Csrf': '1', Accept: 'application/json' });
  });

  it('with a caller Accept header, does not add a second one', () => {
    const request = buildFormRequest({ url: URL, parts: {}, headers: { accept: 'text/plain' } });

    expect(request.headers).toEqual({ accept: 'text/plain' });
  });

  it('with no withCredentials, includes credentials', () => {
    const request = buildFormRequest({ url: URL, parts: {} });

    expect(request.credentials).toBe('include');
  });

  it('with withCredentials false, uses same-origin', () => {
    const request = buildFormRequest({ url: URL, parts: {}, withCredentials: false });

    expect(request.credentials).toBe('same-origin');
  });
});

describe('uploadFormWithProgress', () => {
  it('with a 2xx JSON body over XHR, reports progress, sends cookies and resolves the parsed body', async () => {
    const xhr = new FakeXhr();
    const onProgress = jest.fn();
    const promise = uploadFormWithProgress<{ jobId: string }>({ url: URL, parts: { file: imageFile() }, onProgress, ...xhrOptions(xhr) });
    xhr.progress(1, 3);

    xhr.respond(202, JSON.stringify({ jobId: 'j-1' }));

    await expect(promise).resolves.toEqual({ jobId: 'j-1' });
    expect(onProgress).toHaveBeenCalledWith(33);
    expect(xhr.withCredentials).toBe(true);
  });

  it('with an empty 2xx body, resolves null', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeResponse(204, '')));

    const result = await uploadFormWithProgress({ url: URL, parts: { a: 'b' }, fetchImpl });

    expect(result).toBeNull();
  });

  it('with a non-JSON 2xx body, rejects InvalidResponse', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeResponse(200, '<html>')));

    const error = await caught(uploadFormWithProgress({ url: URL, parts: {}, fetchImpl }));

    expect(error.kind).toBe(UploadErrorKind.InvalidResponse);
  });

  it('with a non-2xx over fetch, rejects Http with status and body', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeResponse(413, '{"error":"too large"}')));

    const error = await caught(uploadFormWithProgress({ url: URL, parts: {}, fetchImpl }));

    expect([error.kind, error.status, error.body]).toEqual([UploadErrorKind.Http, 413, '{"error":"too large"}']);
  });

  it('with a non-2xx over XHR, rejects Http with status and body', async () => {
    const xhr = new FakeXhr();
    const promise = uploadFormWithProgress({ url: URL, parts: {}, onProgress: jest.fn(), ...xhrOptions(xhr) });

    xhr.respond(400, 'bad file');

    const error = await caught(promise);
    expect([error.kind, error.status, error.body]).toEqual([UploadErrorKind.Http, 400, 'bad file']);
  });

  it('with an aborted signal mid-upload, rejects Aborted', async () => {
    const xhr = new FakeXhr();
    const controller = new AbortController();
    const promise = uploadFormWithProgress({ url: URL, parts: {}, signal: controller.signal, onProgress: jest.fn(), ...xhrOptions(xhr) });

    controller.abort();

    expect((await caught(promise)).kind).toBe(UploadErrorKind.Aborted);
  });
});

describe('sendWithFetch', () => {
  it('with an error status whose body cannot be read, rejects with Http and an empty body', async () => {
    const response = { status: 500, text: () => Promise.reject(new Error('stream')) } as unknown as Response;
    const fetchImpl = jest.fn(() => Promise.resolve(response));

    const error = await caught(uploadFormWithProgress({ url: URL, parts: {}, fetchImpl }));

    expect([error.kind, error.status, error.body]).toEqual([UploadErrorKind.Http, 500, '']);
  });
});
