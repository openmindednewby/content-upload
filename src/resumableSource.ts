import { UploadEncoding } from './UploadEncoding';

const PERCENT_SCALE = 100;
const MAX_PERCENT_BEFORE_SUCCESS = 99;

/** The read side of a byte stream, as tus-js-client accepts it. */
export type ByteReader = Pick<ReadableStreamDefaultReader<Uint8Array>, 'read'>;

/** The stream constructors gzip needs; `CompressionStream` is absent on older runtimes. */
export interface StreamRuntime {
  CompressionStream?: typeof CompressionStream;
  TransformStream?: typeof TransformStream;
}

/** What tus-js-client uploads, and how its progress maps back to the source file. */
export interface ResumableSource {
  input: Blob | ByteReader;
  encoding: UploadEncoding;
  lengthDeferred: boolean;
  sourceBytesRead: () => number;
}

function identitySource(file: Blob): ResumableSource {
  return { input: file, encoding: UploadEncoding.Identity, lengthDeferred: false, sourceBytesRead: () => 0 };
}

interface GzipStreams {
  Compression: typeof CompressionStream;
  Transform: typeof TransformStream;
}

function gzipStreams(gzip: boolean, runtime: StreamRuntime): GzipStreams | undefined {
  const Compression = runtime.CompressionStream;
  const Transform = runtime.TransformStream;
  if (!gzip || Compression === undefined || Transform === undefined) {return undefined;}
  return { Compression, Transform };
}

/** True when an interrupted upload can resume after a page reload: identity only, never a gzip stream. */
export function isResumableAcrossReload(gzip = false, runtime: StreamRuntime = globalThis): boolean {
  return gzipStreams(gzip, runtime) === undefined;
}

/** Gzip the file as a stream when asked and supported; otherwise upload it as-is (identity). */
export function openResumableSource(file: Blob, gzip: boolean, runtime: StreamRuntime = globalThis): ResumableSource {
  const streams = gzipStreams(gzip, runtime);
  if (streams === undefined) {return identitySource(file);}
  const { Compression, Transform } = streams;
  let read = 0;
  const counter = new Transform<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
    transform(chunk, controller): void {
      read += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const reader = file.stream().pipeThrough(counter).pipeThrough(new Compression('gzip')).getReader();
  return { input: reader, encoding: UploadEncoding.Gzip, lengthDeferred: true, sourceBytesRead: () => read };
}

/** Whole-number percent; a deferred-length (gzip) upload counts source bytes read and holds at 99 until success. */
export function resumablePercent(source: ResumableSource, fileSize: number, bytesSent: number, bytesTotal: number): number {
  if (!source.lengthDeferred) {return Math.floor((bytesSent * PERCENT_SCALE) / Math.max(bytesTotal, 1));}
  const percent = Math.floor((source.sourceBytesRead() * PERCENT_SCALE) / Math.max(fileSize, 1));
  return Math.min(percent, MAX_PERCENT_BEFORE_SUCCESS);
}
