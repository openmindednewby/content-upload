import { FakeXhr, OK_BODY, fakeResponse, imageFile } from '../test/doubles';
import { UploadError } from './UploadError';
import { UploadErrorKind } from './UploadErrorKind';
import { DEFAULT_CSRF_HEADER, buildUploadRequest, uploadImage } from './uploadImage';

const ENDPOINT = '/bff/api/content/api/v1/content/upload';

function okFetch(body = OK_BODY): jest.Mock {
  return jest.fn(() => Promise.resolve(fakeResponse(200, body)));
}

async function expectKind(promise: Promise<unknown>, kind: UploadErrorKind): Promise<UploadError> {
  const error: unknown = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(UploadError);
  expect((error as UploadError).kind).toBe(kind);
  return error as UploadError;
}

describe('buildUploadRequest (write shape)', () => {
  it('sends multipart FormData and never a Content-Type header (a JSON type on FormData is a 415)', () => {
    const request = buildUploadRequest(imageFile(), { endpoint: ENDPOINT });
    expect(request.form).toBeInstanceOf(FormData);
    const headerNames = Object.keys(request.headers).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain('content-type');
    expect(request.headers[DEFAULT_CSRF_HEADER.name]).toBe('1');
    expect(request.credentials).toBe('include');
  });

  it('defaults Category=Image, IsPublic=true and the File name', () => {
    const { form } = buildUploadRequest(imageFile('a.png'), { endpoint: ENDPOINT });
    expect(form.get('Category')).toBe('Image');
    expect(form.get('IsPublic')).toBe('true');
    expect((form.get('File') as File).name).toBe('a.png');
  });

  it('honours explicit category, isPublic, fileName, credentials and a custom csrf header', () => {
    const { form, headers, credentials } = buildUploadRequest(imageFile(), {
      endpoint: ENDPOINT,
      category: 'Document',
      isPublic: false,
      fileName: 'renamed.png',
      credentials: 'same-origin',
      csrf: { name: 'X-Other', value: 'yes' },
    });
    expect(form.get('Category')).toBe('Document');
    expect(form.get('IsPublic')).toBe('false');
    expect((form.get('File') as File).name).toBe('renamed.png');
    expect(credentials).toBe('same-origin');
    expect(headers['X-Other']).toBe('yes');
    expect(headers[DEFAULT_CSRF_HEADER.name]).toBeUndefined();
  });

  it('sends no csrf header when csrf is null, and names a nameless Blob "upload"', () => {
    const { form, headers } = buildUploadRequest(new Blob(['x'], { type: 'image/png' }), { endpoint: ENDPOINT, csrf: null });
    expect(Object.keys(headers)).toEqual(['Accept']);
    expect((form.get('File') as File).name).toBe('upload');
  });
});

describe('uploadImage validation', () => {
  it('rejects an empty file before any request', async () => {
    const fetchImpl = okFetch();
    await expectKind(uploadImage(imageFile('e.png', 'image/png', ''), { endpoint: ENDPOINT, fetchImpl }), UploadErrorKind.Validation);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a file over maxBytes', async () => {
    const fetchImpl = okFetch();
    await expectKind(uploadImage(imageFile(), { endpoint: ENDPOINT, fetchImpl, maxBytes: 2 }), UploadErrorKind.Validation);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a disallowed MIME type and accepts an allowed one', async () => {
    const fetchImpl = okFetch();
    await expectKind(
      uploadImage(imageFile('a.gif', 'image/gif'), { endpoint: ENDPOINT, fetchImpl, allowedTypes: ['image/png'] }),
      UploadErrorKind.Validation,
    );
    await expect(uploadImage(imageFile(), { endpoint: ENDPOINT, fetchImpl, allowedTypes: ['image/png'], maxBytes: 10 })).resolves.toMatchObject({ contentId: 'c-1' });
  });
});

describe('uploadImage over fetch', () => {
  it('POSTs to the consumer endpoint and returns the parsed content', async () => {
    const fetchImpl = okFetch();
    const result = await uploadImage(imageFile(), { endpoint: ENDPOINT, fetchImpl });
    expect(result).toEqual({ contentId: 'c-1', status: 'Active', url: 'https://cdn.example/c-1.png' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('maps a non-2xx to Http with the status', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeResponse(415, '')));
    const error = await expectKind(uploadImage(imageFile(), { endpoint: ENDPOINT, fetchImpl }), UploadErrorKind.Http);
    expect(error.status).toBe(415);
  });

  it('maps a thrown fetch to Network, or to Aborted when the signal fired', async () => {
    const failing = jest.fn(() => Promise.reject(new TypeError('offline')));
    const network = await expectKind(uploadImage(imageFile(), { endpoint: ENDPOINT, fetchImpl: failing }), UploadErrorKind.Network);
    expect(network.message).toBe('offline');
    const rejectString = jest.fn(() => Promise.reject('boom'));
    await expectKind(uploadImage(imageFile(), { endpoint: ENDPOINT, fetchImpl: rejectString }), UploadErrorKind.Network);
    const controller = new AbortController();
    controller.abort();
    await expectKind(uploadImage(imageFile(), { endpoint: ENDPOINT, fetchImpl: failing, signal: controller.signal }), UploadErrorKind.Aborted);
  });

  it('requires a url for public uploads but not for private ones', async () => {
    const noUrl = JSON.stringify({ contentId: 'c-2', status: 'Active' });
    await expectKind(uploadImage(imageFile(), { endpoint: ENDPOINT, fetchImpl: okFetch(noUrl) }), UploadErrorKind.InvalidResponse);
    await expect(uploadImage(imageFile(), { endpoint: ENDPOINT, fetchImpl: okFetch(noUrl), isPublic: false })).resolves.toEqual({ contentId: 'c-2', status: 'Active', url: undefined });
    await expect(uploadImage(imageFile(), { endpoint: ENDPOINT, fetchImpl: okFetch(noUrl), requireUrl: false })).resolves.toMatchObject({ contentId: 'c-2' });
  });

  it('uses fetch even with onProgress when fetchImpl is supplied', async () => {
    const fetchImpl = okFetch();
    const xhrFactory = jest.fn();
    await uploadImage(imageFile(), { endpoint: ENDPOINT, fetchImpl, xhrFactory, onProgress: jest.fn() });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(xhrFactory).not.toHaveBeenCalled();
  });

  it('falls back to the global fetch when no fetchImpl is given', async () => {
    const original = globalThis.fetch;
    const globalFetch = okFetch();
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    try {
      await uploadImage(imageFile(), { endpoint: ENDPOINT });
      expect(globalFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('uploadImage over XMLHttpRequest (progress)', () => {
  it('reports rounded progress and resolves on a 2xx load', async () => {
    const xhr = new FakeXhr();
    const onProgress = jest.fn();
    const promise = uploadImage(imageFile(), { endpoint: ENDPOINT, onProgress, xhrFactory: () => xhr as unknown as XMLHttpRequest });
    xhr.progress(1, 3);
    xhr.progress(5, 0);
    xhr.progress(1, 2, false);
    xhr.respond(201, OK_BODY);
    await expect(promise).resolves.toMatchObject({ contentId: 'c-1' });
    expect(onProgress.mock.calls).toEqual([[33]]);
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(ENDPOINT);
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.body).toBeInstanceOf(FormData);
    expect(Object.keys(xhr.headers).map((h) => h.toLowerCase())).not.toContain('content-type');
  });

  it('does not send credentials unless credentials is include', async () => {
    const xhr = new FakeXhr();
    const promise = uploadImage(imageFile(), { endpoint: ENDPOINT, credentials: 'omit', onProgress: jest.fn(), xhrFactory: () => xhr as unknown as XMLHttpRequest });
    xhr.respond(200, OK_BODY);
    await promise;
    expect(xhr.withCredentials).toBe(false);
  });

  it('maps non-2xx, network error and abort', async () => {
    const httpXhr = new FakeXhr();
    const http = uploadImage(imageFile(), { endpoint: ENDPOINT, onProgress: jest.fn(), xhrFactory: () => httpXhr as unknown as XMLHttpRequest });
    httpXhr.respond(500, '');
    expect((await expectKind(http, UploadErrorKind.Http)).status).toBe(500);

    const netXhr = new FakeXhr();
    const net = uploadImage(imageFile(), { endpoint: ENDPOINT, onProgress: jest.fn(), xhrFactory: () => netXhr as unknown as XMLHttpRequest });
    netXhr.emit('error');
    await expectKind(net, UploadErrorKind.Network);

    const controller = new AbortController();
    const abortXhr = new FakeXhr();
    const aborted = uploadImage(imageFile(), { endpoint: ENDPOINT, signal: controller.signal, onProgress: jest.fn(), xhrFactory: () => abortXhr as unknown as XMLHttpRequest });
    controller.abort();
    await expectKind(aborted, UploadErrorKind.Aborted);
  });

  it('rejects immediately when the signal is already aborted, without opening a request', async () => {
    const controller = new AbortController();
    controller.abort();
    const xhrFactory = jest.fn();
    await expectKind(uploadImage(imageFile(), { endpoint: ENDPOINT, signal: controller.signal, onProgress: jest.fn(), xhrFactory }), UploadErrorKind.Aborted);
    expect(xhrFactory).not.toHaveBeenCalled();
  });

  it('uses the global XMLHttpRequest by default, and fetch when none exists', async () => {
    const originalXhr = globalThis.XMLHttpRequest;
    const created: FakeXhr[] = [];
    globalThis.XMLHttpRequest = jest.fn(() => {
      const xhr = new FakeXhr();
      created.push(xhr);
      return xhr;
    }) as unknown as typeof XMLHttpRequest;
    try {
      const promise = uploadImage(imageFile(), { endpoint: ENDPOINT, onProgress: jest.fn() });
      created[0].respond(200, OK_BODY);
      await expect(promise).resolves.toMatchObject({ contentId: 'c-1' });

      Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
      const originalFetch = globalThis.fetch;
      const globalFetch = okFetch();
      globalThis.fetch = globalFetch as unknown as typeof fetch;
      try {
        await uploadImage(imageFile(), { endpoint: ENDPOINT, onProgress: jest.fn() });
        expect(globalFetch).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      globalThis.XMLHttpRequest = originalXhr;
    }
  });
});
