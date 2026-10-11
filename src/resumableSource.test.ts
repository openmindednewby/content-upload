import { Blob as NodeBlob } from 'node:buffer';
import { CompressionStream, TransformStream } from 'node:stream/web';
import { gunzipSync } from 'node:zlib';

import { UploadEncoding } from './UploadEncoding';
import { openResumableSource, resumablePercent } from './resumableSource';

import type { ByteReader, StreamRuntime } from './resumableSource';

const CSV = 'name,dob\nAlexei,1970\n'.repeat(200);
const nodeRuntime = { CompressionStream, TransformStream } as unknown as StreamRuntime;

function csvBlob(): Blob {
  return new NodeBlob([CSV]) as unknown as Blob;
}

async function drain(reader: ByteReader): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for (let next = await reader.read(); next.done !== true; next = await reader.read()) {chunks.push(next.value);}
  return Buffer.concat(chunks);
}

describe('openResumableSource', () => {
  it('with gzip on a runtime with CompressionStream, streams gzip bytes that decompress to the file', async () => {
    const source = openResumableSource(csvBlob(), true, nodeRuntime);

    const bytes = await drain(source.input as ByteReader);

    expect([source.encoding, source.lengthDeferred]).toEqual([UploadEncoding.Gzip, true]);
    expect(gunzipSync(bytes).toString()).toBe(CSV);
    expect(source.sourceBytesRead()).toBe(CSV.length);
  });

  it('with gzip on a runtime without CompressionStream, returns the file as identity', () => {
    const file = csvBlob();

    const source = openResumableSource(file, true, { TransformStream } as unknown as StreamRuntime);

    expect([source.input, source.encoding, source.lengthDeferred, source.sourceBytesRead()]).toEqual([file, UploadEncoding.Identity, false, 0]);
  });

  it('with gzip off, returns the file as identity', () => {
    const source = openResumableSource(csvBlob(), false, nodeRuntime);

    expect(source.encoding).toBe(UploadEncoding.Identity);
  });

  it('with no runtime given and no CompressionStream global, falls back to identity', () => {
    const source = openResumableSource(csvBlob(), true, {});

    expect(source.encoding).toBe(UploadEncoding.Identity);
  });
});

describe('resumablePercent', () => {
  it('with a known length, returns the floored percent of bytes sent', () => {
    const source = openResumableSource(csvBlob(), false, nodeRuntime);

    const percent = resumablePercent(source, CSV.length, 2, 3);

    expect(percent).toBe(66);
  });

  it('with a deferred length fully read, holds at 99 until success', () => {
    const source = { input: csvBlob(), encoding: UploadEncoding.Gzip, lengthDeferred: true, sourceBytesRead: (): number => 500 };

    const percent = resumablePercent(source, 500, 10, 0);

    expect(percent).toBe(99);
  });

  it('with a deferred length partly read, returns the percent of source bytes read', () => {
    const source = { input: csvBlob(), encoding: UploadEncoding.Gzip, lengthDeferred: true, sourceBytesRead: (): number => 125 };

    const percent = resumablePercent(source, 500, 10, 0);

    expect(percent).toBe(25);
  });
});
