import { Blob as NodeBlob } from 'node:buffer';
import { CompressionStream, TransformStream } from 'node:stream/web';

import { UploadEncoding } from './UploadEncoding';
import { resumeFingerprint, uploadResumable } from './uploadResumable';

import type { HttpRequest, HttpResponse, HttpStack, PreviousUpload, Upload, UrlStorage } from 'tus-js-client';

const { Upload: BrowserUpload } = jest.requireActual<{ Upload: typeof Upload }>('tus-js-client/lib.es5/browser/index.js');
const ENDPOINT = 'http://localhost/bff/api/aml/v1/ingest/uploads';
const CSV = 'name,dob\nAlexei,1970\n'.repeat(50);
const HTTP_CREATED = 201;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;

interface Exchange { method: string; storedDuring: number }

type StoredUpload = PreviousUpload & { fingerprint: string };

class MemoryUrlStorage implements UrlStorage {
  readonly entries = new Map<string, StoredUpload>();
  findAllUploads(): Promise<PreviousUpload[]> { return Promise.resolve([...this.entries.values()]); }
  findUploadsByFingerprint(fingerprint: string): Promise<PreviousUpload[]> {
    return Promise.resolve([...this.entries.values()].filter((entry) => entry.fingerprint === fingerprint));
  }
  removeUpload(urlStorageKey: string): Promise<void> { this.entries.delete(urlStorageKey); return Promise.resolve(); }
  addUpload(fingerprint: string, upload: PreviousUpload): Promise<string> {
    const key = `key-${String(this.entries.size + 1)}`;
    this.entries.set(key, { ...upload, fingerprint, urlStorageKey: key });
    return Promise.resolve(key);
  }
}

function response(status: number, headers: Record<string, string>): HttpResponse {
  return { getStatus: () => status, getHeader: (name) => headers[name], getBody: () => '', getUnderlyingObject: () => null };
}

function bodyLength(body: unknown): number {
  const sized = body as { size?: number; byteLength?: number } | null | undefined;
  return sized?.size ?? sized?.byteLength ?? 0;
}

class TusServer implements HttpStack {
  readonly log: Exchange[] = [];
  private offset = 0;
  constructor(private readonly storage: MemoryUrlStorage, private readonly length: number) {}
  getName(): string { return 'memory-tus'; }
  createRequest(method: string, url: string): HttpRequest {
    const headers: Record<string, string> = {};
    return {
      getMethod: () => method,
      getURL: () => url,
      setHeader: (name, value) => { headers[name] = value; },
      getHeader: (name) => headers[name],
      setProgressHandler: () => undefined,
      abort: () => Promise.resolve(),
      getUnderlyingObject: () => null,
      send: (body) => Promise.resolve(this.answer(method, headers, body)),
    };
  }
  private answer(method: string, headers: Record<string, string>, body: unknown): HttpResponse {
    this.log.push({ method, storedDuring: this.storage.entries.size });
    if (method === 'POST') {return response(HTTP_CREATED, { Location: `${ENDPOINT}/new-upload` });}
    if (method === 'HEAD') {return response(HTTP_OK, { 'Upload-Offset': String(this.offset), 'Upload-Length': String(this.length) });}
    this.offset = Number(headers['Upload-Offset']) + bodyLength(body);
    return response(HTTP_NO_CONTENT, { 'Upload-Offset': String(this.offset) });
  }
}

function csvBlob(): Blob {
  return new NodeBlob([CSV]) as unknown as Blob;
}

function seed(storage: MemoryUrlStorage, encoding: UploadEncoding): void {
  const fingerprint = resumeFingerprint(ENDPOINT, csvBlob(), { encoding });
  void storage.addUpload(fingerprint, { size: CSV.length, metadata: {}, creationTime: '2026-10-10', urlStorageKey: '', uploadUrl: `${ENDPOINT}/old-upload`, parallelUploadUrls: null });
}

async function runUpload(storage: MemoryUrlStorage, gzip: boolean): Promise<{ id: string; log: Exchange[] }> {
  const server = new TusServer(storage, CSV.length);
  const id = await uploadResumable({
    endpoint: ENDPOINT,
    file: csvBlob(),
    gzip,
    withCredentials: false,
    uploadFactory: (input, options) => new BrowserUpload(input, { ...options, httpStack: server, urlStorage: storage }),
  });
  return { id, log: server.log };
}

function trace(log: Exchange[]): string[] {
  return log.map((exchange) => `${exchange.method}:${String(exchange.storedDuring)}`);
}

const runtime = globalThis as unknown as Record<string, unknown>;
const saved = { CompressionStream: runtime.CompressionStream, TransformStream: runtime.TransformStream };

describe('uploadResumable with a real tus-js-client', () => {
  beforeAll(() => { Object.assign(runtime, { CompressionStream, TransformStream }); });
  afterAll(() => { Object.assign(runtime, saved); });

  it('with an identity upload, stores the fingerprint once created and clears it on success', async () => {
    const storage = new MemoryUrlStorage();

    const { id, log } = await runUpload(storage, false);

    expect([id, trace(log), storage.entries.size]).toEqual(['new-upload', ['POST:0', 'PATCH:1'], 0]);
  });

  it('with an identity upload stored before a reload, resumes the stored upload instead of creating one', async () => {
    const storage = new MemoryUrlStorage();
    seed(storage, UploadEncoding.Identity);

    const { id, log } = await runUpload(storage, false);

    expect([id, log.map((exchange) => exchange.method)]).toEqual(['old-upload', ['HEAD', 'PATCH']]);
  });

  it('with a gzip upload, never stores a fingerprint while uploading', async () => {
    const storage = new MemoryUrlStorage();

    const { log } = await runUpload(storage, true);

    expect([log[0]?.method, log.every((exchange) => exchange.storedDuring === 0), log.length > 1]).toEqual(['POST', true, true]);
  });

  it('with a gzip upload stored before a reload, ignores it and creates a fresh upload', async () => {
    const storage = new MemoryUrlStorage();
    seed(storage, UploadEncoding.Gzip);

    const { id, log } = await runUpload(storage, true);

    expect([id, log[0]?.method, log.some((exchange) => exchange.method === 'HEAD')]).toEqual(['new-upload', 'POST', false]);
  });
});
